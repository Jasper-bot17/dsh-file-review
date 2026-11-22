/**
 * dsh-file-review · Host 半
 *
 * 职责：为客户端浮层提供工作区文件 API（列目录 / 读文件 / 写回 / 校验 / 导出批注）。
 * 安全边界：所有路径都解析到「当前会话的工作区目录」内，realpath 校验，禁止 `..`、
 * 绝对路径、盘符与系统目录；写回前先备份 `<文件>.bak`，再原子替换。
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { inflateRawSync } from 'node:zlib';
export const name = 'dsh-file-review';
export const inject = ['webServer', 'sessions', 'sessionController'];
const API_PREFIX = '/plugins/dsh-file-review/api';
const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
/** 单条批注消息上限（字符数） */
const MAX_SEND_CHARS = 100_000;
/** 宿主时钟时区，随 prompt 一起下发（与桌面端一致） */
const CLIENT_TIME_ZONE = 'Asia/Shanghai';
/** S2 预览：单文件上限、渲染 DPI、单次最多渲染页数、渲染超时 */
const MAX_PREVIEW_BYTES = 30 * 1024 * 1024;
const PREVIEW_DPI = 120;
const MAX_PREVIEW_PAGES = 30;
const PREVIEW_TIMEOUT_MS = 120_000;
const PREVIEW_CACHE_ROOT = path.join(os.tmpdir(), 'dsh-file-review-preview');
/** 转换后的 PDF 上限（防止异常文档把缓存撑爆） */
const MAX_PDF_BYTES = 60 * 1024 * 1024;
/** S1 可预览/可编辑的文本类扩展名 */
const TEXT_EXTENSIONS = new Set([
    '.md', '.markdown', '.mdx', '.txt', '.log', '.csv', '.tsv', '.json', '.jsonl',
    '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.properties',
    '.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue', '.svelte',
    '.html', '.htm', '.css', '.scss', '.less', '.xml', '.svg', '.sql',
    '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmake', '.gradle', '.java',
    '.c', '.h', '.cpp', '.hpp', '.cc', '.rs', '.go', '.rb', '.php', '.lua',
    '.r', '.m', '.swift', '.kt', '.scala', '.tex', '.gitignore', '.editorconfig',
]);
/** S2 可走 Host 侧渲染的文档（LibreOffice Kit / pdfium）；xlsx 走 DOM 表格，不进这条链路 */
const PAGE_EXTENSIONS = new Set(['.docx', '.pptx', '.pdf']);
/** xlsx 走 Host 解析 + 前端 DOM 表格（行号列标/网格线/原生选字） */
const SHEET_EXTENSIONS = new Set(['.xlsx']);
/** S2 可直接展示的图片 */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const IMAGE_MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
};
/** 树里默认不展示的目录/文件 */
const HIDDEN_NAMES = new Set(['node_modules', '.git', '.svn', '.hg', '.DS_Store', 'Thumbs.db']);
/** 每个目录最多返回多少条 */
const MAX_TREE_ENTRIES = 500;
// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------
class ReviewError extends Error {
    code;
    status;
    reason;
    constructor(code, message, status = 400, reason) {
        super(message);
        this.name = 'ReviewError';
        this.code = code;
        this.status = status;
        this.reason = reason;
    }
}
function writeJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body),
    });
    res.end(body);
}
function writeError(res, error) {
    const reviewError = error instanceof ReviewError
        ? error
        : new ReviewError('INTERNAL', error instanceof Error ? error.message : String(error), 500);
    writeJson(res, reviewError.status, {
        ok: false,
        error: {
            code: reviewError.code,
            message: reviewError.message,
            ...(reviewError.reason ? { reason: reviewError.reason } : {}),
        },
    });
}
// ---------------------------------------------------------------------------
// 信任栅栏：只接受本机 GUI 的请求
// ---------------------------------------------------------------------------
function isLoopback(address) {
    if (!address)
        return true;
    const host = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
    return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}
function isTrustedRequest(ctx, req) {
    if (req.headers['sec-fetch-site'] === 'cross-site')
        return false;
    const remote = req.socket?.remoteAddress;
    if (isLoopback(remote))
        return true;
    const trustedHosts = ctx.webRuntime?.trustedHosts ?? [];
    const hostHeader = String(req.headers.host ?? '');
    return trustedHosts.some((trusted) => hostHeader === trusted || hostHeader.startsWith(`${trusted}:`));
}
// ---------------------------------------------------------------------------
// 路径栅栏：所有路径必须落在会话工作区目录内
// ---------------------------------------------------------------------------
function assertUsableWorkspace(workspace) {
    const resolved = path.resolve(workspace);
    // 工作区本身不能是盘根，避免把整盘暴露出去（tree 的根分支也必须过这一关）
    if (resolved === path.resolve(path.parse(resolved).root)) {
        throw new ReviewError('BAD_WORKSPACE', '工作区不能是磁盘根目录', 403);
    }
    return resolved;
}
async function sessionWorkspace(ctx, sessionId) {
    // 2026-11-20 安全修复：不再采信客户端自报的 cwd（会绕过工作区栅栏）。
    // 工作区只能来自 Host 侧可解析的会话；无 sessionId 或解析不到一律 400 NO_SESSION。
    const session = sessionId ? ctx.sessions.get(sessionId) : undefined;
    const cwd = session?.header?.cwd;
    if (!cwd) {
        throw new ReviewError('NO_SESSION', '找不到会话工作区：请从小窗的会话入口打开', 400);
    }
    // 8.3 短路径（如 RUNNER~1）或符号链接下的 cwd 与 realpath 不同：
    // 统一成真实根，后续解析、相对路径和展示路径才基于同一套字符串。
    const real = await fsp.realpath(cwd).catch(() => cwd);
    return assertUsableWorkspace(real);
}
function isWithin(root, target) {
    const normalize = (value) => {
        const resolved = path.resolve(value);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const rel = path.relative(normalize(root), normalize(target));
    if (rel === '')
        return true;
    if (rel.startsWith('..'))
        return false;
    return !path.isAbsolute(rel);
}
/** 把客户端传来的工作区相对路径解析成绝对路径，并做越界校验 */
async function resolveWorkspacePath(workspace, relPath, options) {
    const raw = String(relPath ?? '').trim();
    if (!raw)
        throw new ReviewError('BAD_PATH', '缺少 path 参数', 400);
    if (raw.includes('\0'))
        throw new ReviewError('BAD_PATH', '非法路径', 400);
    const normalized = raw.replace(/\\/g, '/');
    if (path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
        throw new ReviewError('BAD_PATH', '只接受工作区相对路径', 400);
    }
    if (normalized.split('/').includes('..')) {
        throw new ReviewError('BAD_PATH', '路径不允许包含 ..', 400);
    }
    // 工作区本身不能是盘根，避免把整盘暴露出去
    const workspaceRoot = path.parse(workspace).root;
    if (path.resolve(workspace) === path.resolve(workspaceRoot)) {
        throw new ReviewError('BAD_WORKSPACE', '工作区不能是磁盘根目录', 403);
    }
    // 会话里给的工作区可能是 8.3 短路径（如 RUNNER~1）或经过符号链接，
    // 与 realpath(目标) 直接比较会把合法文件误判成越界，这里统一取真实根。
    const workspaceReal = await fsp.realpath(workspace).catch(() => workspace);
    const absolute = path.resolve(workspace, normalized);
    if (!isWithin(workspace, absolute))
        throw new ReviewError('OUTSIDE_WORKSPACE', '路径越出工作区', 403);
    if (options.mustExist) {
        // 文件已存在时用 realpath 防止符号链接逃逸
        const stat = await fsp.stat(absolute).catch(() => null);
        if (!stat)
            throw new ReviewError('NOT_FOUND', `文件不存在：${normalized}`, 404);
        const real = await fsp.realpath(absolute);
        if (!isWithin(workspace, real) && !isWithin(workspaceReal, real)) {
            throw new ReviewError('OUTSIDE_WORKSPACE', '路径越出工作区', 403);
        }
        return real;
    }
    // 新建/写回：校验父目录的 realpath
    const parent = path.dirname(absolute);
    const parentReal = await fsp.realpath(parent).catch(() => {
        throw new ReviewError('NOT_FOUND', `目录不存在：${path.relative(workspace, parent) || '.'}`, 404);
    });
    if (!isWithin(workspace, parentReal) && !isWithin(workspaceReal, parentReal)) {
        throw new ReviewError('OUTSIDE_WORKSPACE', '路径越出工作区', 403);
    }
    return path.join(parentReal, path.basename(absolute));
}
function relativeToWorkspace(workspace, absolute) {
    return path.relative(workspace, absolute).replace(/\\/g, '/');
}
// ---------------------------------------------------------------------------
// 文件工具
// ---------------------------------------------------------------------------
function sha1(content) {
    return createHash('sha1').update(content).digest('hex');
}
function isTextPath(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (TEXT_EXTENSIONS.has(ext))
        return true;
    const base = path.basename(filePath).toLowerCase();
    return base.startsWith('dockerfile') || base === 'makefile' || base === 'readme';
}
/** 判断文件应该走哪种预览：文本 / 图片 / 分页渲染 / 表格 / 不支持 */
function previewKindOf(filePath) {
    if (isTextPath(filePath))
        return 'text';
    const ext = path.extname(filePath).toLowerCase();
    if (SHEET_EXTENSIONS.has(ext))
        return 'sheet';
    if (IMAGE_EXTENSIONS.has(ext))
        return 'image';
    if (PAGE_EXTENSIONS.has(ext))
        return 'pages';
    return 'unsupported';
}
/** 流式计算 sha256（预览缓存键；不把大文件整体读进内存） */
function sha256Stream(filePath) {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}
/** 流式计算 sha1（文件指纹；大文件退回 size+mtime，避免读整份文件） */
function fileFingerprint(filePath, stat) {
    if (stat.size > MAX_PREVIEW_BYTES)
        return Promise.resolve(sha1(`${stat.size}:${Math.round(stat.mtimeMs)}`));
    return new Promise((resolve, reject) => {
        const hash = createHash('sha1');
        const stream = createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}
const sha256Cache = new Map();
/** sha256 记忆化：同一路径 + size + mtime 只算一次， /render 多次取图不重复扫文件 */
async function sha256ForFile(filePath, stat) {
    const cacheKey = `${filePath}:${stat.size}:${Math.round(stat.mtimeMs)}`;
    const cached = sha256Cache.get(cacheKey);
    if (cached)
        return cached;
    const digest = await sha256Stream(filePath);
    if (sha256Cache.size >= 32) {
        const oldest = sha256Cache.keys().next().value;
        if (typeof oldest === 'string')
            sha256Cache.delete(oldest);
    }
    sha256Cache.set(cacheKey, digest);
    return digest;
}
async function readJsonBody(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.byteLength;
        if (total > MAX_JSON_BYTES)
            throw new ReviewError('BODY_TOO_LARGE', '请求体过大', 413);
        chunks.push(buffer);
    }
    if (total === 0)
        return {};
    try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new ReviewError('BAD_BODY', '请求体必须是 JSON 对象', 400);
        }
        return parsed;
    }
    catch (error) {
        if (error instanceof ReviewError)
            throw error;
        throw new ReviewError('BAD_BODY', '请求体不是合法 JSON', 400);
    }
}
/** 定位内置 Kit 的 CLI 与独立 Node；优先环境变量，其次 Electron resourcesPath */
function resolveKitCommand() {
    const resources = process.env.DSH_RESOURCES ??
        process.resourcesPath ??
        (process.execPath ? path.join(path.dirname(process.execPath), 'resources') : '');
    const cliCandidates = [];
    if (process.env.DSH_LIBREOFFICE_KIT_CLI)
        cliCandidates.push(process.env.DSH_LIBREOFFICE_KIT_CLI);
    if (resources) {
        cliCandidates.push(path.join(resources, 'app.asar.unpacked', 'dsh', 'node_modules', '@deepseek-ai', 'libreoffice-kit', 'lib', 'cli.js'));
    }
    const cli = cliCandidates.find((candidate) => existsSync(candidate));
    if (!cli)
        return null;
    const nodeCandidates = [];
    if (process.env.DSH_NODE_BIN)
        nodeCandidates.push(process.env.DSH_NODE_BIN);
    if (resources) {
        nodeCandidates.push(path.join(resources, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'));
    }
    const node = nodeCandidates.find((candidate) => existsSync(candidate)) ?? process.execPath;
    return { node, cli };
}
function runKit(command, args, timeoutMessage = `渲染超时（${PREVIEW_TIMEOUT_MS / 1000} 秒）`) {
    return new Promise((resolve, reject) => {
        const child = spawn(command.node, [command.cli, ...args], {
            windowsHide: true,
            env: {
                ...process.env,
                ...(command.node === process.execPath ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
            },
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timer = null;
        const finish = (fn) => {
            if (settled)
                return;
            settled = true;
            if (timer !== null)
                clearTimeout(timer);
            fn();
        };
        timer = setTimeout(() => {
            child.kill();
            finish(() => reject(new ReviewError('ERR_CONVERT_TIMEOUT', timeoutMessage, 504)));
        }, PREVIEW_TIMEOUT_MS);
        child.stdout?.on('data', (chunk) => {
            stdout = (stdout + chunk.toString('utf8')).slice(-64_000);
        });
        child.stderr?.on('data', (chunk) => {
            stderr = (stderr + chunk.toString('utf8')).slice(-64_000);
        });
        child.on('error', (error) => finish(() => reject(error)));
        child.on('close', (code) => finish(() => resolve({ code: code ?? -1, stdout, stderr })));
    });
}
function planFromManifest(manifest, outDir, mode) {
    const images = Array.isArray(manifest.images) ? manifest.images : [];
    const pages = [];
    for (const image of images) {
        const imagePath = typeof image.path === 'string' && image.path.length > 0 ? path.resolve(outDir, image.path) : '';
        if (!imagePath || !isWithin(outDir, imagePath))
            continue;
        const index = typeof image.index === 'number' ? image.index : pages.length + 1;
        const page = typeof image.page === 'number' ? image.page : undefined;
        const sheet = typeof image.sheet === 'string' ? image.sheet : undefined;
        const range = typeof image.range === 'string' ? image.range : undefined;
        const label = mode === 'xlsx' ? `工作表「${sheet ?? '未命名'}」${range ? ` ${range}` : ''}` : `第${page ?? index}页`;
        pages.push({
            index,
            ...(page !== undefined ? { page } : {}),
            ...(sheet !== undefined ? { sheet } : {}),
            ...(range !== undefined ? { range } : {}),
            label,
            width: typeof image.width === 'number' ? image.width : 0,
            height: typeof image.height === 'number' ? image.height : 0,
            filePath: imagePath,
        });
    }
    const pageCount = typeof manifest.pageCount === 'number' && manifest.pageCount > 0 ? manifest.pageCount : pages.length;
    return {
        pageCount,
        truncated: pages.length < pageCount,
        dpi: typeof manifest.dpi === 'number' ? manifest.dpi : PREVIEW_DPI,
        missingFonts: Array.isArray(manifest.missingFonts)
            ? manifest.missingFonts.filter((item) => typeof item === 'string')
            : [],
        images: pages,
    };
}
function createPreviewRenderer(command) {
    const locks = new Map();
    let pruned = false;
    const pruneOldCaches = () => {
        if (pruned)
            return;
        pruned = true;
        void prunePreviewCacheRoot();
    };
    const readPlan = async (outDir, input) => {
        let raw;
        try {
            raw = await fsp.readFile(path.join(outDir, 'manifest.json'), 'utf8');
        }
        catch {
            return null;
        }
        let manifest;
        try {
            manifest = JSON.parse(raw);
        }
        catch {
            return null;
        }
        if (typeof manifest.sourceSha256 === 'string' && manifest.sourceSha256 !== input.sha256)
            return null;
        if (typeof manifest.inputPath === 'string' && path.resolve(manifest.inputPath) !== path.resolve(input.absolutePath)) {
            return null;
        }
        const plan = planFromManifest(manifest, outDir, input.mode);
        for (const image of plan.images) {
            const exists = await fsp.stat(image.filePath).then((stat) => stat.isFile(), () => false);
            if (!exists)
                return null;
        }
        return plan;
    };
    const renderTo = async (input, outDir, pageMode) => {
        await fsp.mkdir(path.dirname(outDir), { recursive: true });
        await fsp.rm(outDir, { recursive: true, force: true }).catch(() => undefined);
        const args = [
            'render',
            '--input',
            input.absolutePath,
            '--output-dir',
            outDir,
            '--dpi',
            String(PREVIEW_DPI),
            '--max-pages',
            String(MAX_PREVIEW_PAGES),
        ];
        if (input.mode === 'xlsx') {
            // xlsx 的渲染单位是可见工作表，CLI 不接受 --pages
        }
        else if (pageMode === 'first') {
            args.push('--pages', '1');
        }
        else if (pageMode === 'list') {
            args.push('--pages', Array.from({ length: MAX_PREVIEW_PAGES }, (_, index) => index + 1).join(','));
        }
        else {
            args.push('--pages', 'all');
        }
        const result = await runKit(command, args);
        if (result.code !== 0) {
            const detail = (result.stderr || result.stdout).replace(/\s+/g, ' ').trim().slice(0, 300);
            await fsp.rm(outDir, { recursive: true, force: true }).catch(() => undefined);
            throw new ReviewError('RENDER_FAILED', `渲染失败（exit ${result.code}）${detail ? `：${detail}` : ''}`, 500);
        }
        const plan = await readPlan(outDir, input);
        if (!plan) {
            await fsp.rm(outDir, { recursive: true, force: true }).catch(() => undefined);
            throw new ReviewError('RENDER_FAILED', '渲染结果不完整', 500);
        }
        return plan;
    };
    const render = async (input) => {
        const outDir = path.join(PREVIEW_CACHE_ROOT, `${input.sha256}-${PREVIEW_DPI}`);
        const cached = await readPlan(outDir, input);
        if (cached)
            return cached;
        pruneOldCaches();
        const pending = locks.get(input.sha256);
        if (pending)
            return pending;
        const task = (async () => {
            try {
                return await renderTo(input, outDir, 'all');
            }
            catch (error) {
                if (input.mode === 'xlsx')
                    throw error;
                // 页数超过 max-pages 时 CLI 会整体失败：先渲染第 1 页拿总页数，再渲染前 30 页。
                const probeDir = path.join(PREVIEW_CACHE_ROOT, `${input.sha256}-${PREVIEW_DPI}-probe`);
                try {
                    const probe = await renderTo(input, probeDir, 'first');
                    if (probe.pageCount <= MAX_PREVIEW_PAGES) {
                        return await renderTo(input, outDir, 'all');
                    }
                    return await renderTo(input, outDir, 'list');
                }
                catch {
                    throw error;
                }
                finally {
                    await fsp.rm(probeDir, { recursive: true, force: true }).catch(() => undefined);
                }
            }
        })().finally(() => locks.delete(input.sha256));
        locks.set(input.sha256, task);
        return task;
    };
    return { render };
}
let cachedPreviewRenderer = null;
function resolvePreviewRenderer(ctx) {
    // 不能直接读 ctx.previewRenderer：Cordis 对未在 inject 里声明的属性会抛
    // `cannot get property "previewRenderer" without inject`。可选依赖按官方建议
    // 走 ctx.get()，未注册时返回 undefined，再退回内置 LibreOffice Kit。
    const injected = typeof ctx.get === 'function' ? ctx.get('previewRenderer') : undefined;
    if (injected && typeof injected.render === 'function')
        return injected;
    if (cachedPreviewRenderer)
        return cachedPreviewRenderer;
    const command = resolveKitCommand();
    if (!command)
        throw new ReviewError('NO_RENDERER', '宿主没有可用的 LibreOffice Kit，无法预览 Office/PDF', 503);
    cachedPreviewRenderer = createPreviewRenderer(command);
    return cachedPreviewRenderer;
}
// ---------------------------------------------------------------------------
// S3 文字层：Office 先转 PDF，再从 PDF 抽文字块；页图与文字层同一坐标系
// ---------------------------------------------------------------------------
function isPdfFile(filePath) {
    return fsp
        .open(filePath, 'r')
        .then(async (handle) => {
        try {
            const buffer = Buffer.alloc(5);
            const { bytesRead } = await handle.read(buffer, 0, 5, 0);
            return bytesRead === 5 && buffer.toString('latin1') === '%PDF-';
        }
        finally {
            await handle.close();
        }
    })
        .catch(() => false);
}
function createDocumentConverter(command) {
    const locks = new Map();
    return {
        toPdf(input) {
            const pending = locks.get(input.sha256);
            if (pending)
                return pending;
            const task = (async () => {
                const outDir = path.join(PREVIEW_CACHE_ROOT, `${input.sha256}-pdf`);
                const target = path.join(outDir, 'document.pdf');
                if (await isPdfFile(target))
                    return target;
                await fsp.rm(outDir, { recursive: true, force: true }).catch(() => undefined);
                await fsp.mkdir(outDir, { recursive: true });
                const result = await runKit(command, ['convert', '--input', input.absolutePath, '--output', target], `文档转换超时（${PREVIEW_TIMEOUT_MS / 1000} 秒），可以重试`);
                if (result.code !== 0 || !(await isPdfFile(target))) {
                    await fsp.rm(outDir, { recursive: true, force: true }).catch(() => undefined);
                    const detail = (result.stderr || result.stdout).replace(/\s+/g, ' ').trim().slice(0, 300);
                    throw new ReviewError('CONVERT_FAILED', `Office 文档转 PDF 失败（exit ${result.code}）${detail ? `：${detail}` : ''}`, 500);
                }
                void prunePreviewCacheRoot();
                return target;
            })().finally(() => locks.delete(input.sha256));
            locks.set(input.sha256, task);
            return task;
        },
    };
}
let cachedDocumentConverter = null;
function resolveDocumentConverter(ctx) {
    const injected = typeof ctx.get === 'function' ? ctx.get('documentConverter') : undefined;
    if (injected && typeof injected.toPdf === 'function')
        return injected;
    if (cachedDocumentConverter)
        return cachedDocumentConverter;
    const command = resolveKitCommand();
    if (!command)
        throw new ReviewError('NO_RENDERER', '宿主没有可用的 LibreOffice Kit，无法转换文档', 503);
    cachedDocumentConverter = createDocumentConverter(command);
    return cachedDocumentConverter;
}
const pdfDocumentCache = new Map();
async function ensureDocumentPdf(ctx, absolutePath, sourceSha256) {
    const ext = path.extname(absolutePath).toLowerCase();
    if (ext === '.pdf')
        return { pdfPath: absolutePath, sha256: sourceSha256 };
    const source = await fsp.readFile(absolutePath);
    if (isEncryptedOoxml(source)) {
        throw new ReviewError('ERR_ENCRYPTED_FILE', '文件受密码保护，请先解除密码后再预览', 422);
    }
    const cached = pdfDocumentCache.get(sourceSha256);
    if (cached && (await isPdfFile(cached.pdfPath)))
        return cached;
    const converter = resolveDocumentConverter(ctx);
    const kind = ext === '.docx' ? 'docx' : ext === '.pptx' ? 'pptx' : 'xlsx';
    const pdfPath = await converter.toPdf({ absolutePath, sha256: sourceSha256, kind });
    const stat = await fsp.stat(pdfPath).catch(() => null);
    if (!stat || stat.size < 5 || stat.size > MAX_PDF_BYTES || !(await isPdfFile(pdfPath))) {
        throw new ReviewError('CONVERT_FAILED', '转换出的 PDF 不可用（缺失、为空或超过 60MB）', 500);
    }
    const digest = await sha256ForFile(pdfPath, stat);
    const document = { pdfPath, sha256: digest };
    if (pdfDocumentCache.size >= 32) {
        const oldest = pdfDocumentCache.keys().next().value;
        if (typeof oldest === 'string')
            pdfDocumentCache.delete(oldest);
    }
    pdfDocumentCache.set(sourceSha256, document);
    return document;
}
/** 读 zip 条目；失败时带上具体原因，便于 /sheet 把 NO_SHEET 的根因报给客户端 */
function readZipEntryDetailed(buffer, target, maxBytes = MAX_ZIP_ENTRY_BYTES) {
    const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0 || eocd + 22 > buffer.length)
        return { data: null, reason: 'ZIP_EOCD_MISSING' };
    const total = buffer.readUInt16LE(eocd + 10);
    if (total > MAX_ZIP_ENTRIES)
        return { data: null, reason: 'ZIP_TOO_MANY_ENTRIES' };
    let offset = buffer.readUInt32LE(eocd + 16);
    let totalUncompressed = 0;
    for (let index = 0; index < total; index += 1) {
        if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
            return { data: null, reason: 'ZIP_CORRUPT_CENTRAL' };
        }
        const method = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const uncompressedSize = buffer.readUInt32LE(offset + 24);
        const nameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localOffset = buffer.readUInt32LE(offset + 42);
        const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
        totalUncompressed += uncompressedSize;
        if (totalUncompressed > MAX_ZIP_TOTAL_BYTES)
            return { data: null, reason: 'ZIP_TOTAL_TOO_LARGE' };
        if (name === target) {
            // 拒绝超大条目，避免 zip 炸弹把内存打满；工作表 XML 走单独的更高上限
            if (uncompressedSize > maxBytes)
                return { data: null, reason: 'ZIP_ENTRY_TOO_LARGE' };
            if (localOffset + 30 > buffer.length)
                return { data: null, reason: 'ZIP_BAD_LOCAL' };
            const localNameLength = buffer.readUInt16LE(localOffset + 26);
            const localExtraLength = buffer.readUInt16LE(localOffset + 28);
            const dataStart = localOffset + 30 + localNameLength + localExtraLength;
            if (dataStart + compressedSize > buffer.length)
                return { data: null, reason: 'ZIP_BAD_LOCAL' };
            const data = buffer.subarray(dataStart, dataStart + compressedSize);
            if (method === 0)
                return { data: Buffer.from(data) };
            if (method === 8) {
                // 解压上限取「声明大小」与调用方上限的较小者，再以 8MB 兜底：
                // 诚实的大工作表按真实大小放行；声明很小、实际很大的撒谎条目仍只解到 8MB。
                const outputLimit = Math.min(maxBytes, Math.max(uncompressedSize, MAX_ZIP_ENTRY_BYTES));
                try {
                    return { data: inflateRawSync(data, { maxOutputLength: outputLimit }) };
                }
                catch {
                    return { data: null, reason: 'ZIP_INFLATE_FAILED' };
                }
            }
            return { data: null, reason: 'ZIP_METHOD_UNSUPPORTED' };
        }
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return { data: null, reason: 'ZIP_ENTRY_MISSING' };
}
function readZipEntry(buffer, target, maxBytes = MAX_ZIP_ENTRY_BYTES) {
    return readZipEntryDetailed(buffer, target, maxBytes).data;
}
function decodeXmlEntities(value) {
    return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (whole, entity) => {
        if (entity === 'amp')
            return '&';
        if (entity === 'lt')
            return '<';
        if (entity === 'gt')
            return '>';
        if (entity === 'quot')
            return '"';
        if (entity === 'apos')
            return "'";
        // P2：数值字符实体必须落在 Unicode 标量范围内。以前直接交给
        // String.fromCodePoint，非法值（如 &#1114112;）会抛 RangeError 变成 500；
        // 现在按 4xx 拒绝，避免把解析器异常暴露成内部错误。
        const codePoint = entity.startsWith('#x')
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        if (!Number.isInteger(codePoint) ||
            codePoint < 0 ||
            codePoint > 0x10ffff ||
            (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
            throw new ReviewError('BAD_XML_ENTITY', `文件包含非法的 XML 字符实体：${whole}`, 400);
        }
        return String.fromCodePoint(codePoint);
    });
}
/**
 * xlsx 只接受普通 XML；拒绝 DOCTYPE/ENTITY 声明，避免外部实体或实体膨胀。
 * 我们不做 DTD 展开，遇到这类输入直接判为不安全，整表预览失败。
 */
function assertSafeXml(entry, label) {
    if (!entry)
        return null;
    const head = entry.subarray(0, Math.min(entry.length, MAX_XML_HEAD_BYTES)).toString('utf8');
    if (/<!DOCTYPE\b|<!ENTITY\b/i.test(head)) {
        throw new ReviewError('UNSAFE_XML', `${label} 包含不安全的 XML 声明（DOCTYPE/ENTITY）`, 400);
    }
    return entry;
}
/** 判断 OOXML 是否为加密包（加密的 docx/xlsx/pptx 会带这两个 entry） */
function isEncryptedOoxml(buffer) {
    return readZipEntry(buffer, 'EncryptionInfo') !== null || readZipEntry(buffer, 'EncryptedPackage') !== null;
}
/** 从 worksheet 的 sheetView/pane 读取冻结行列数（xSplit=列，ySplit=行） */
function readFrozenPane(xml) {
    const pane = /<pane\b[^>]*>/i.exec(xml)?.[0];
    if (!pane)
        return undefined;
    const xSplit = Number.parseInt(xmlAttr(pane, 'xSplit') ?? '', 10);
    const ySplit = Number.parseInt(xmlAttr(pane, 'ySplit') ?? '', 10);
    const rows = Number.isFinite(ySplit) ? Math.max(0, ySplit) : 0;
    const cols = Number.isFinite(xSplit) ? Math.max(0, xSplit) : 0;
    if (rows <= 0 && cols <= 0)
        return undefined;
    return { rows: Math.min(rows, MAX_SHEET_ROWS - 1), cols: Math.min(cols, MAX_SHEET_COLS - 1) };
}
// ---------------------------------------------------------------------------
// xlsx：DOM 表格预览（不引 SheetJS；只解析展示需要的最小信息）
// ---------------------------------------------------------------------------
const MAX_SHEET_ROWS = 1000;
const MAX_SHEET_FULL_ROWS = 20000;
const MAX_SHEET_COLS = 60;
const MAX_SHEET_CELLS = 60000;
const MAX_SHEET_FULL_CELLS = 300000;
/** 单个 <c> 单元格的 XML 上限：超过按非法截断跳过，防止病态文件拖死解析 */
const MAX_CELL_XML_BYTES = 64 * 1024;
const DEFAULT_COLUMN_WIDTH = 96;
const MAX_ZIP_ENTRIES = 4096;
const MAX_ZIP_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 8 * 1024 * 1024;
/** 行数多的工作表 XML 很容易超过 8MB，单独放宽；仍封顶，防止 zip 炸弹撑爆内存 */
const MAX_SHEET_XML_BYTES = 32 * 1024 * 1024;
const MAX_SHARED_STRINGS_BYTES = 16 * 1024 * 1024;
const MAX_XML_HEAD_BYTES = 64 * 1024;
const MAX_PREVIEW_CACHE_DIRS = 48;
const MAX_PREVIEW_CACHE_BYTES = 512 * 1024 * 1024;
/** 预览缓存清理：过期、超数量、超总大小都删；失败静默，不影响预览 */
async function prunePreviewCacheRoot() {
    const entries = await fsp.readdir(PREVIEW_CACHE_ROOT, { withFileTypes: true }).catch(() => []);
    const dirs = [];
    for (const entry of entries) {
        if (!entry.isDirectory())
            continue;
        const dir = path.join(PREVIEW_CACHE_ROOT, entry.name);
        const stat = await fsp.stat(dir).catch(() => null);
        if (!stat)
            continue;
        dirs.push({ dir, mtimeMs: stat.mtimeMs, size: stat.size });
    }
    dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let keptBytes = 0;
    let keptCount = 0;
    for (const item of dirs) {
        const tooOld = item.mtimeMs < cutoff;
        const tooMany = keptCount >= MAX_PREVIEW_CACHE_DIRS;
        const tooHeavy = keptBytes + item.size > MAX_PREVIEW_CACHE_BYTES;
        if (tooOld || tooMany || tooHeavy) {
            await fsp.rm(item.dir, { recursive: true, force: true }).catch(() => undefined);
        }
        else {
            keptBytes += item.size;
            keptCount += 1;
        }
    }
}
function xmlAttr(tag, name) {
    const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag);
    return match ? decodeXmlEntities(match[1] ?? '') : undefined;
}
function parseSharedStrings(entry) {
    if (!entry)
        return [];
    const xml = entry.toString('utf8').replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    const values = [];
    for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
        const body = match[1] ?? '';
        values.push([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
            .map((item) => decodeXmlEntities(item[1] ?? ''))
            .join(''));
    }
    return values;
}
/** 返回“像日期/时间”的 cellXfs 下标，供数字单元格格式化 */
function parseDateStyleIndexes(entry) {
    const result = new Set();
    if (!entry)
        return result;
    const xml = entry.toString('utf8');
    const builtInDateIds = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
    const customFormats = new Map();
    const numFmts = /<numFmts\b[^>]*>([\s\S]*?)<\/numFmts>/.exec(xml)?.[1] ?? '';
    for (const match of numFmts.matchAll(/<numFmt\b[^>]*>/g)) {
        const tag = match[0];
        const id = Number.parseInt(xmlAttr(tag, 'numFmtId') ?? '', 10);
        const code = xmlAttr(tag, 'formatCode') ?? '';
        if (Number.isInteger(id))
            customFormats.set(id, code);
    }
    const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
    let styleIndex = 0;
    for (const match of cellXfs.matchAll(/<xf\b[^>]*>/g)) {
        const tag = match[0];
        const numFmtId = Number.parseInt(xmlAttr(tag, 'numFmtId') ?? '0', 10);
        const code = customFormats.get(numFmtId) ?? '';
        const looksLikeDate = builtInDateIds.has(numFmtId) || (/[ymdhs]/i.test(code) && !/[#0]/.test(code));
        if (looksLikeDate)
            result.add(styleIndex);
        styleIndex += 1;
    }
    return result;
}
function columnName(index) {
    let value = index;
    let name = '';
    while (value > 0) {
        const remainder = (value - 1) % 26;
        name = String.fromCharCode(65 + remainder) + name;
        value = Math.floor((value - 1) / 26);
    }
    return name;
}
function parseCellRef(ref) {
    const match = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
    if (!match)
        return null;
    const letters = (match[1] ?? '').toUpperCase();
    let col = 0;
    for (const letter of letters)
        col = col * 26 + (letter.charCodeAt(0) - 64);
    const row = Number.parseInt(match[2] ?? '', 10);
    if (!Number.isInteger(col) || !Number.isInteger(row) || col <= 0 || row <= 0)
        return null;
    return { row, col };
}
function excelDateText(serial) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000));
    if (Number.isNaN(date.getTime()))
        return String(serial);
    const iso = date.toISOString();
    const hasTime = Math.abs(serial - Math.floor(serial)) > 1e-6;
    return hasTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}
function formatSheetNumber(value) {
    if (!Number.isFinite(value))
        return '';
    if (Number.isInteger(value))
        return String(value);
    return String(Number(value.toFixed(8)));
}
/** 读 workbook.xml + rels，得到 sheet 顺序、名字和 zip 内路径 */
function readXlsxSheetsFromBuffer(buffer) {
    if (isEncryptedOoxml(buffer)) {
        throw new ReviewError('ERR_ENCRYPTED_FILE', '文件受密码保护，请先解除密码后再预览', 422);
    }
    const workbookRead = readZipEntryDetailed(buffer, 'xl/workbook.xml');
    const workbook = workbookRead.data ? assertSafeXml(workbookRead.data, 'workbook.xml') : null;
    if (!workbook) {
        const reason = workbookRead.reason ?? 'ZIP_ENTRY_MISSING';
        throw new ReviewError('NO_SHEET', `工作簿结构无法读取（${reason}）`, 404, reason);
    }
    const rels = assertSafeXml(readZipEntry(buffer, 'xl/_rels/workbook.xml.rels'), 'workbook.xml.rels');
    const targets = new Map();
    if (rels) {
        for (const match of rels.toString('utf8').matchAll(/<Relationship\b[^>]*>/g)) {
            const tag = match[0];
            const id = xmlAttr(tag, 'Id');
            const target = xmlAttr(tag, 'Target');
            if (id && target)
                targets.set(id, target);
        }
    }
    const sheets = [];
    const xml = workbook.toString('utf8');
    let index = 0;
    for (const match of xml.matchAll(/<sheet\b[^>]*>/g)) {
        const tag = match[0];
        const name = (xmlAttr(tag, 'name') ?? '').trim() || `Sheet${index + 1}`;
        const relationshipId = xmlAttr(tag, 'r:id');
        const target = relationshipId ? targets.get(relationshipId) : undefined;
        let entry = '';
        if (target) {
            const normalized = target.replace(/\\/g, '/').replace(/^\/+/, '');
            entry = normalized.startsWith('xl/') ? normalized : path.posix.normalize(`xl/${normalized}`);
        }
        if (!entry.startsWith('xl/') || entry.includes('..')) {
            entry = `xl/worksheets/sheet${index + 1}.xml`;
        }
        sheets.push({ index, name, entry });
        index += 1;
    }
    return sheets;
}
async function readXlsxSheets(filePath) {
    try {
        const buffer = await fsp.readFile(filePath);
        return readXlsxSheetsFromBuffer(buffer);
    }
    catch (error) {
        if (error instanceof ReviewError)
            throw error;
        return [];
    }
}
async function readXlsxSheetData(filePath, sheetIndex, full = false) {
    const rowLimit = full ? MAX_SHEET_FULL_ROWS : MAX_SHEET_ROWS;
    const cellLimit = full ? MAX_SHEET_FULL_CELLS : MAX_SHEET_CELLS;
    const buffer = await fsp.readFile(filePath);
    const sheets = readXlsxSheetsFromBuffer(buffer);
    const sheetRef = sheets[sheetIndex];
    if (!sheetRef)
        throw new ReviewError('NO_SHEET', `没有第 ${sheetIndex + 1} 个工作表`, 404);
    const sheetRead = readZipEntryDetailed(buffer, sheetRef.entry, MAX_SHEET_XML_BYTES);
    const sheetEntry = sheetRead.data ? assertSafeXml(sheetRead.data, sheetRef.entry) : null;
    if (!sheetEntry) {
        const reason = sheetRead.reason ?? 'ZIP_ENTRY_MISSING';
        throw new ReviewError('NO_SHEET', `工作表「${sheetRef.name}」的数据无法读取（${reason}）`, 404, reason);
    }
    const sharedStrings = parseSharedStrings(assertSafeXml(readZipEntry(buffer, 'xl/sharedStrings.xml', MAX_SHARED_STRINGS_BYTES), 'sharedStrings.xml'));
    const dateStyles = parseDateStyleIndexes(assertSafeXml(readZipEntry(buffer, 'xl/styles.xml'), 'styles.xml'));
    const xml = sheetEntry.toString('utf8');
    const frozen = readFrozenPane(xml);
    const dimension = /<dimension\b[^>]*\bref="([^"]+)"/.exec(xml)?.[1];
    let actualRows = 0;
    let actualCols = 0;
    if (dimension) {
        const end = dimension.includes(':') ? dimension.split(':').pop() ?? dimension : dimension;
        const position = parseCellRef(end);
        if (position) {
            actualRows = position.row;
            actualCols = position.col;
        }
    }
    const rowHeights = new Map();
    for (const match of xml.matchAll(/<row\b[^>]*>/g)) {
        const tag = match[0];
        const row = Number.parseInt(xmlAttr(tag, 'r') ?? '', 10);
        const height = Number.parseFloat(xmlAttr(tag, 'ht') ?? '');
        if (!Number.isInteger(row) || row <= 0)
            continue;
        actualRows = Math.max(actualRows, row);
        if (Number.isFinite(height) && height > 0) {
            rowHeights.set(row, Math.max(20, Math.min(200, Math.round((height * 4) / 3))));
        }
    }
    const columns = [];
    const ensureColumns = (count) => {
        while (columns.length < count)
            columns.push(DEFAULT_COLUMN_WIDTH);
    };
    for (const match of xml.matchAll(/<col\b[^>]*>/g)) {
        const tag = match[0];
        const min = Number.parseInt(xmlAttr(tag, 'min') ?? '', 10);
        const max = Number.parseInt(xmlAttr(tag, 'max') ?? '', 10);
        const width = Number.parseFloat(xmlAttr(tag, 'width') ?? '');
        const hidden = xmlAttr(tag, 'hidden') === '1';
        if (!Number.isInteger(min) || !Number.isInteger(max) || min <= 0 || max < min)
            continue;
        const limit = Math.min(max, MAX_SHEET_COLS);
        ensureColumns(limit);
        for (let col = min; col <= limit; col += 1) {
            columns[col - 1] = hidden
                ? 24
                : Math.max(40, Math.min(320, Math.round((Number.isFinite(width) && width > 0 ? width : 12) * 7 + 5)));
        }
    }
    const merges = [...xml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"/g)]
        .map((match) => decodeXmlEntities(match[1] ?? ''))
        .filter((value) => /^[A-Za-z]+\d+(?::[A-Za-z]+\d+)?$/.test(value));
    const cells = [];
    // P1：旧正则 `/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g` 在「有 <c 无 </c>」的
    // 病态 sheet 上会反复扫描到文件尾，退化成 O(n²)（400KB 实测 7.9s）。
    // 改成有界游标：每个 <c 只向后找一次最近的 </c>，找不到立即停止；
    // 单格 XML 超过 MAX_CELL_XML_BYTES 直接跳过，整体严格 O(n)。
    let cursor = 0;
    while (cells.length < cellLimit) {
        const open = xml.indexOf('<c', cursor);
        if (open < 0)
            break;
        const boundary = xml.charCodeAt(open + 2);
        const isCellTag = boundary === 62 ||
            boundary === 47 ||
            boundary === 32 ||
            boundary === 9 ||
            boundary === 10 ||
            boundary === 13;
        if (!isCellTag) {
            cursor = open + 2;
            continue;
        }
        const openEnd = xml.indexOf('>', open + 2);
        if (openEnd < 0)
            break;
        const attrs = xml.slice(open + 2, openEnd);
        const selfClosing = attrs.endsWith('/');
        let body = '';
        if (selfClosing) {
            cursor = openEnd + 1;
        }
        else {
            const close = xml.indexOf('</c>', openEnd + 1);
            if (close < 0)
                break;
            if (close - openEnd > MAX_CELL_XML_BYTES) {
                cursor = close + 4;
                continue;
            }
            body = xml.slice(openEnd + 1, close);
            cursor = close + 4;
        }
        const tag = `<c${attrs}>`;
        const position = parseCellRef(xmlAttr(tag, 'r') ?? '');
        if (!position)
            continue;
        actualRows = Math.max(actualRows, position.row);
        actualCols = Math.max(actualCols, position.col);
        if (position.row > rowLimit || position.col > MAX_SHEET_COLS)
            continue;
        if (cells.length >= cellLimit)
            continue;
        const type = xmlAttr(tag, 't') ?? 'n';
        const styleValue = xmlAttr(tag, 's');
        const styleIndex = styleValue === undefined ? -1 : Number.parseInt(styleValue, 10);
        let text = '';
        let kind = 'string';
        if (type === 'inlineStr') {
            const inlineBody = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? body;
            text = [...inlineBody.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
                .map((item) => decodeXmlEntities(item[1] ?? ''))
                .join('');
        }
        else {
            const valueEntry = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
            if (valueEntry !== undefined) {
                const raw = decodeXmlEntities(valueEntry);
                if (type === 's') {
                    const index = Number.parseInt(raw, 10);
                    text = Number.isInteger(index) ? sharedStrings[index] ?? '' : '';
                }
                else if (type === 'b') {
                    text = raw === '1' ? 'TRUE' : 'FALSE';
                    kind = 'boolean';
                }
                else if (type === 'e') {
                    text = raw;
                    kind = 'error';
                }
                else if (type === 'str') {
                    text = raw;
                }
                else {
                    const numeric = Number(raw);
                    if (raw.trim() !== '' && Number.isFinite(numeric)) {
                        text =
                            Number.isInteger(styleIndex) && dateStyles.has(styleIndex)
                                ? excelDateText(numeric)
                                : formatSheetNumber(numeric);
                        kind = 'number';
                    }
                    else {
                        text = raw;
                    }
                }
            }
        }
        if (text === '')
            continue;
        cells.push({
            ref: `${columnName(position.col)}${position.row}`,
            row: position.row,
            col: position.col,
            text,
            kind,
        });
    }
    const rowCount = Math.min(Math.max(actualRows, 1), rowLimit);
    const colCount = Math.min(Math.max(actualCols, 1), MAX_SHEET_COLS);
    ensureColumns(colCount);
    columns.length = colCount;
    const rows = [];
    for (let index = 1; index <= rowCount; index += 1) {
        const height = rowHeights.get(index);
        rows.push(height !== undefined ? { index, height } : { index });
    }
    return {
        index: sheetRef.index,
        name: sheetRef.name,
        rowCount,
        colCount,
        ...(frozen ? { frozen } : {}),
        totalRows: Math.max(actualRows, rowCount),
        totalCols: Math.max(actualCols, colCount),
        columns,
        rows,
        cells,
        merges,
        truncated: actualRows > rowCount || actualCols > colCount || cells.length >= cellLimit,
    };
}
let pdfjsPromise = null;
function loadPdfjs() {
    if (!pdfjsPromise) {
        pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').catch((error) => {
            pdfjsPromise = null;
            throw new ReviewError('NO_TEXT_LAYER', `文字层组件不可用：${error instanceof Error ? error.message : String(error)}`, 503);
        });
    }
    return pdfjsPromise;
}
async function assertPdfReadable(pdfPath) {
    const pdfjs = await loadPdfjs();
    const data = await fsp.readFile(pdfPath);
    const task = pdfjs.getDocument({
        data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        isEvalSupported: false,
        useSystemFonts: false,
        disableFontFace: true,
        verbosity: 0,
    });
    try {
        await task.promise.catch((error) => {
            const name = error?.name;
            const message = error instanceof Error ? error.message : String(error);
            if (name === 'PasswordException' || /password|encrypted/i.test(message)) {
                throw new ReviewError('ERR_ENCRYPTED_FILE', 'PDF 受密码保护，请先解除密码后再预览', 422);
            }
            throw new ReviewError('PDF_UNREADABLE', `PDF 无法解析：${message}`, 422);
        });
    }
    finally {
        // pdfjs v6 的 PDFDocumentProxy 没有 destroy()；释放只能走 loading task。
        await task.destroy().catch(() => undefined);
    }
}
async function extractPdfText(pdfPath, pageNumber) {
    const pdfjs = await loadPdfjs();
    const data = await fsp.readFile(pdfPath);
    const task = pdfjs.getDocument({
        data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        isEvalSupported: false,
        useSystemFonts: false,
        disableFontFace: true,
        verbosity: 0,
    });
    try {
        const document = await task.promise.catch((error) => {
            const name = error?.name;
            const message = error instanceof Error ? error.message : String(error);
            if (name === 'PasswordException' || /password|encrypted/i.test(message)) {
                throw new ReviewError('ERR_ENCRYPTED_FILE', 'PDF 受密码保护，请先解除密码后再预览', 422);
            }
            throw error;
        });
        if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) {
            throw new ReviewError('NO_PAGE', `没有第 ${pageNumber} 页`, 404);
        }
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const width = viewport.width > 0 ? viewport.width : 1;
        const height = viewport.height > 0 ? viewport.height : 1;
        const content = await page.getTextContent();
        const blocks = [];
        for (const item of content.items) {
            if (typeof item?.str !== 'string' || item.str.length === 0)
                continue;
            const matrix = pdfjs.Util.transform(viewport.transform, item.transform);
            const fontPx = Math.hypot(matrix[2] ?? 0, matrix[3] ?? 0);
            if (!Number.isFinite(fontPx) || fontPx <= 0)
                continue;
            const rawX = (matrix[4] ?? 0) / width;
            const rawY = ((matrix[5] ?? 0) - fontPx) / height;
            const x = Math.max(0, Math.min(1, rawX));
            const y = Math.max(0, Math.min(1, rawY));
            const w = Math.max(0.0001, Math.abs(item.width) / width);
            const h = fontPx / height;
            blocks.push({
                text: item.str,
                x,
                y,
                w: Math.min(w, 1 - x),
                h: Math.min(h, 1 - y),
            });
        }
        return {
            page: pageNumber,
            width,
            height,
            hasText: blocks.some((block) => block.text.trim().length > 0),
            blocks,
        };
    }
    finally {
        await task.destroy().catch(() => undefined);
    }
}
let cachedTextLayerExtractor = null;
function resolveTextLayerExtractor(ctx) {
    const injected = typeof ctx.get === 'function' ? ctx.get('textLayerExtractor') : undefined;
    if (injected && typeof injected.extract === 'function')
        return injected;
    if (cachedTextLayerExtractor)
        return cachedTextLayerExtractor;
    cachedTextLayerExtractor = { extract: extractPdfText };
    return cachedTextLayerExtractor;
}
const textLayerCache = new Map();
async function getTextLayer(ctx, pdf, page) {
    const cacheKey = `${pdf.sha256}:${page}`;
    const cached = textLayerCache.get(cacheKey);
    if (cached)
        return cached;
    const layer = await resolveTextLayerExtractor(ctx).extract(pdf.pdfPath, page);
    if (textLayerCache.size >= 64) {
        const oldest = textLayerCache.keys().next().value;
        if (typeof oldest === 'string')
            textLayerCache.delete(oldest);
    }
    textLayerCache.set(cacheKey, layer);
    return layer;
}
async function handleTree(ctx, url) {
    const workspace = await sessionWorkspace(ctx, url.searchParams.get('sessionId'));
    const relDir = url.searchParams.get('dir') ?? '';
    const absoluteDir = relDir
        ? await resolveWorkspacePath(workspace, relDir, { mustExist: true })
        : workspace;
    const stat = await fsp.stat(absoluteDir).catch(() => null);
    if (!stat || !stat.isDirectory())
        throw new ReviewError('NOT_DIR', '目标不是目录', 400);
    const dirents = await fsp.readdir(absoluteDir, { withFileTypes: true });
    const entries = [];
    for (const dirent of dirents.slice(0, MAX_TREE_ENTRIES)) {
        if (HIDDEN_NAMES.has(dirent.name))
            continue;
        const target = path.join(absoluteDir, dirent.name);
        const relative = relativeToWorkspace(workspace, target);
        if (dirent.isDirectory()) {
            entries.push({ name: dirent.name, path: relative, dir: true, size: 0, mtimeMs: 0, editable: false });
            continue;
        }
        if (!dirent.isFile())
            continue;
        const fileStat = await fsp.stat(target).catch(() => null);
        if (!fileStat)
            continue;
        entries.push({
            name: dirent.name,
            path: relative,
            dir: false,
            size: fileStat.size,
            mtimeMs: fileStat.mtimeMs,
            editable: isTextPath(target) && fileStat.size <= MAX_WRITE_BYTES,
        });
    }
    entries.sort((a, b) => {
        if (a.dir !== b.dir)
            return a.dir ? -1 : 1;
        return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    return { ok: true, dir: relDir.replace(/\\/g, '/'), workspace: path.basename(workspace), entries };
}
async function handleRead(ctx, url) {
    const workspace = await sessionWorkspace(ctx, url.searchParams.get('sessionId'));
    const absolute = await resolveWorkspacePath(workspace, url.searchParams.get('path') ?? '', { mustExist: true });
    const stat = await fsp.stat(absolute);
    if (stat.isDirectory())
        throw new ReviewError('IS_DIR', '目标是目录', 400);
    const text = isTextPath(absolute);
    const tooLarge = stat.size > MAX_READ_BYTES;
    const buffer = text && !tooLarge ? await fsp.readFile(absolute) : Buffer.alloc(0);
    const meta = {
        path: relativeToWorkspace(workspace, absolute),
        name: path.basename(absolute),
        content: text && !tooLarge ? buffer.toString('utf8') : '',
        sha1: text && !tooLarge ? sha1(buffer) : await fileFingerprint(absolute, stat),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        readonly: !text || tooLarge,
        tooLarge,
        text,
        previewKind: previewKindOf(absolute),
    };
    return { ok: true, file: meta };
}
async function handleStat(ctx, url) {
    const workspace = await sessionWorkspace(ctx, url.searchParams.get('sessionId'));
    const absolute = await resolveWorkspacePath(workspace, url.searchParams.get('path') ?? '', { mustExist: true });
    const stat = await fsp.stat(absolute);
    if (stat.isDirectory())
        throw new ReviewError('IS_DIR', '目标是目录', 400);
    return {
        ok: true,
        stat: {
            path: relativeToWorkspace(workspace, absolute),
            sha1: await fileFingerprint(absolute, stat),
            size: stat.size,
            mtimeMs: stat.mtimeMs,
        },
    };
}
async function writeAtomic(target, content) {
    const dir = path.dirname(target);
    const tmp = path.join(dir, `.dsh-file-review-${process.pid}-${Date.now()}.tmp`);
    await fsp.writeFile(tmp, content, 'utf8');
    try {
        await fsp.rename(tmp, target);
    }
    catch (error) {
        await fsp.rm(tmp, { force: true }).catch(() => undefined);
        throw error;
    }
}
async function handleWrite(ctx, req) {
    const body = await readJsonBody(req);
    const workspace = await sessionWorkspace(ctx, typeof body.sessionId === 'string' ? body.sessionId : null);
    const relPath = typeof body.path === 'string' ? body.path : '';
    const content = typeof body.content === 'string' ? body.content : null;
    if (content === null)
        throw new ReviewError('BAD_BODY', '缺少 content', 400);
    if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
        throw new ReviewError('TOO_LARGE', '内容超过 2MB，S1 不支持保存', 413);
    }
    const absolute = await resolveWorkspacePath(workspace, relPath, { mustExist: true });
    const existing = await fsp.readFile(absolute);
    const currentSha1 = sha1(existing);
    const baseSha1 = typeof body.baseSha1 === 'string' ? body.baseSha1 : null;
    if (baseSha1 && baseSha1 !== currentSha1) {
        throw new ReviewError('CONFLICT', '文件已被外部修改，请刷新后再保存', 409);
    }
    // 备份（覆盖上一次的 .bak，保留最近一次原始内容）
    const backup = `${absolute}.bak`;
    await fsp.writeFile(backup, existing);
    await writeAtomic(absolute, content);
    const stat = await fsp.stat(absolute);
    return {
        ok: true,
        file: {
            path: relativeToWorkspace(workspace, absolute),
            sha1: sha1(content),
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            backup: `${relativeToWorkspace(workspace, absolute)}.bak`,
        },
    };
}
async function handleExport(ctx, req) {
    const body = await readJsonBody(req);
    const workspace = await sessionWorkspace(ctx, typeof body.sessionId === 'string' ? body.sessionId : null);
    const relPath = typeof body.path === 'string' ? body.path : '';
    const content = typeof body.content === 'string' ? body.content : '';
    if (!content.trim())
        throw new ReviewError('BAD_BODY', '缺少 content', 400);
    const absolute = await resolveWorkspacePath(workspace, relPath, { mustExist: true });
    const target = `${absolute}.annotations.md`;
    const exists = await fsp.stat(target).then(() => true, () => false);
    const stamp = new Date().toISOString();
    const block = exists
        ? `\n\n---\n\n## ${stamp}\n\n${content.trim()}\n`
        : `# 批注记录 · ${path.basename(absolute)}\n\n导出自 DSH 文件预览与批注插件。\n\n---\n\n## ${stamp}\n\n${content.trim()}\n`;
    await fsp.writeFile(target, block, exists ? { encoding: 'utf8', flag: 'a' } : 'utf8');
    return { ok: true, export: { path: relativeToWorkspace(workspace, target) } };
}
// ---------------------------------------------------------------------------
// 批注回传：走 Host 侧 SessionController（浏览器拿不到会话态，必须由 Host 发送）
// ---------------------------------------------------------------------------
function resolveSessionController(ctx) {
    let controller = null;
    try {
        controller = ctx.sessionController;
    }
    catch {
        controller = null;
    }
    if (!controller && typeof ctx.get === 'function') {
        try {
            controller = ctx.get('sessionController');
        }
        catch {
            controller = null;
        }
    }
    const candidate = controller;
    if (!candidate || typeof candidate.prompt !== 'function') {
        throw new ReviewError('NO_CONTROLLER', '宿主未提供 sessionController，无法把批注发进会话', 503);
    }
    return candidate;
}
async function handleSend(ctx, req) {
    const body = await readJsonBody(req);
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    const markdown = typeof body.markdown === 'string' ? body.markdown : '';
    if (!sessionId)
        throw new ReviewError('BAD_BODY', '缺少 sessionId', 400);
    if (!markdown.trim())
        throw new ReviewError('BAD_BODY', '缺少 markdown', 400);
    if (markdown.length > MAX_SEND_CHARS) {
        throw new ReviewError('TOO_LARGE', `批注消息超过 ${MAX_SEND_CHARS} 字符`, 413);
    }
    const controller = resolveSessionController(ctx);
    const requestId = `review-${randomUUID()}`;
    try {
        await controller.prompt({
            requestId,
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: markdown }],
            clientTimeZone: CLIENT_TIME_ZONE,
        }, AbortSignal.timeout(15000));
    }
    catch (error) {
        if (error instanceof ReviewError)
            throw error;
        throw new ReviewError('SEND_FAILED', `会话发送失败：${error instanceof Error ? error.message : String(error)}`, 500);
    }
    return { ok: true, delivered: 'sessionController', requestId };
}
// ---------------------------------------------------------------------------
// S2 预览路由
// ---------------------------------------------------------------------------
function publicPage(page) {
    return {
        index: page.index,
        ...(page.page !== undefined ? { page: page.page } : {}),
        ...(page.sheet !== undefined ? { sheet: page.sheet } : {}),
        ...(page.range !== undefined ? { range: page.range } : {}),
        label: page.label,
        width: page.width,
        height: page.height,
    };
}
async function previewContext(ctx, url) {
    const workspace = await sessionWorkspace(ctx, url.searchParams.get('sessionId'));
    const absolute = await resolveWorkspacePath(workspace, url.searchParams.get('path') ?? '', { mustExist: true });
    const stat = await fsp.stat(absolute);
    if (stat.isDirectory())
        throw new ReviewError('IS_DIR', '目标是目录', 400);
    if (stat.size > MAX_PREVIEW_BYTES) {
        throw new ReviewError('ERR_TOO_LARGE', `文件超过 ${Math.floor(MAX_PREVIEW_BYTES / 1024 / 1024)} MB，暂不支持预览`, 413);
    }
    return { absolute, stat, kind: previewKindOf(absolute) };
}
/** GET /preview：返回预览类型与分页元数据；分页文档由 Host 侧渲染 */
async function handlePreview(ctx, url) {
    const { absolute, stat, kind } = await previewContext(ctx, url);
    if (kind === 'text')
        return { ok: true, preview: { kind } };
    if (kind === 'unsupported') {
        throw new ReviewError('UNSUPPORTED_PREVIEW', '该格式暂不支持预览（S2 支持 docx / xlsx / pptx / pdf / 图片）', 415);
    }
    const ext = path.extname(absolute).toLowerCase();
    if (kind === 'image') {
        const digest = await sha256ForFile(absolute, stat);
        return {
            ok: true,
            preview: {
                kind,
                mime: IMAGE_MIME[ext] ?? 'application/octet-stream',
                size: stat.size,
                sha1: digest,
            },
        };
    }
    if (kind === 'sheet') {
        const sheets = await readXlsxSheets(absolute);
        if (sheets.length === 0) {
            throw new ReviewError('UNSUPPORTED_PREVIEW', '无法解析这个 xlsx 的工作表', 415);
        }
        return {
            ok: true,
            preview: {
                kind: 'sheet',
                active: 0,
                sheets: sheets.map(({ index, name }) => ({ index, name })),
            },
        };
    }
    const digest = await sha256ForFile(absolute, stat);
    const renderer = resolvePreviewRenderer(ctx);
    const pdf = await ensureDocumentPdf(ctx, absolute, digest);
    // 加密/损坏的 PDF 若只交给渲染器，可能返回空白页，客户端就没有错误可显示；
    // 这里先用 pdfjs 解一遍，把 PasswordException 等统一变成 422 错误卡。
    if (path.extname(absolute).toLowerCase() === '.pdf')
        await assertPdfReadable(pdf.pdfPath);
    const plan = await renderer.render({ absolutePath: pdf.pdfPath, sha256: pdf.sha256, mode: 'pages' });
    return {
        ok: true,
        preview: {
            kind: 'pages',
            key: pdf.sha256,
            pageCount: plan.pageCount,
            truncated: plan.truncated,
            dpi: plan.dpi,
            missingFonts: plan.missingFonts,
            pages: plan.images.map(publicPage),
        },
    };
}
/** GET /sheet：返回 xlsx 单表的单元格、列宽、行高、合并区域（DOM 表格由前端渲染） */
async function handleSheet(ctx, url) {
    const { absolute, kind } = await previewContext(ctx, url);
    if (kind !== 'sheet')
        throw new ReviewError('NOT_SHEET', '该文件不是表格', 400);
    const sheetValue = Number.parseInt(url.searchParams.get('sheet') ?? '0', 10);
    if (!Number.isInteger(sheetValue) || sheetValue < 0) {
        throw new ReviewError('BAD_SHEET', 'sheet 必须是非负整数', 400);
    }
    const sheet = await readXlsxSheetData(absolute, sheetValue, url.searchParams.get('full') === '1');
    return { ok: true, sheet };
}
/** GET /render：按页返回 PNG（缓存由预览渲染器负责） */
async function handleRender(ctx, url, res) {
    const { absolute, stat, kind } = await previewContext(ctx, url);
    if (kind !== 'pages')
        throw new ReviewError('NOT_PAGES', '该文件不是分页预览类型', 400);
    const pageValue = Number.parseInt(url.searchParams.get('page') ?? '', 10);
    if (!Number.isInteger(pageValue) || pageValue < 1) {
        throw new ReviewError('BAD_PAGE', 'page 必须是正整数', 400);
    }
    // key 只作 URL 缓存标记，不信任客户端传值：文件可能已变化，旧 key 会命中旧缓存。
    // sha256ForFile 按 (path,size,mtime) 记忆化，这里重算的代价可以忽略。
    const key = await sha256ForFile(absolute, stat);
    const pdf = await ensureDocumentPdf(ctx, absolute, key);
    const renderer = resolvePreviewRenderer(ctx);
    const plan = await renderer.render({ absolutePath: pdf.pdfPath, sha256: pdf.sha256, mode: 'pages' });
    const image = plan.images.find((item) => item.index === pageValue);
    if (!image)
        throw new ReviewError('NO_PAGE', `没有第 ${pageValue} 页`, 404);
    const buffer = await fsp.readFile(image.filePath);
    res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': buffer.length,
        'cache-control': 'private, max-age=3600',
    });
    res.end(buffer);
}
/** GET /document：返回缓存 PDF（Office 先转换；PDF 原样返回） */
async function handleDocument(ctx, url, res) {
    const { absolute, stat, kind } = await previewContext(ctx, url);
    if (kind !== 'pages')
        throw new ReviewError('NOT_PAGES', '该文件不是分页文档', 400);
    const digest = await sha256ForFile(absolute, stat);
    const pdf = await ensureDocumentPdf(ctx, absolute, digest);
    const buffer = await fsp.readFile(pdf.pdfPath);
    res.writeHead(200, {
        'content-type': 'application/pdf',
        'content-length': buffer.length,
        'content-disposition': 'inline; filename="document.pdf"',
        'cache-control': 'private, max-age=3600',
    });
    res.end(buffer);
}
/** GET /textlayer：返回某一页的文字块（归一化坐标，原点左上） */
async function handleTextLayer(ctx, url) {
    const { absolute, stat, kind } = await previewContext(ctx, url);
    if (kind !== 'pages')
        throw new ReviewError('NOT_PAGES', '该文件不是分页文档', 400);
    const pageValue = Number.parseInt(url.searchParams.get('page') ?? '', 10);
    if (!Number.isInteger(pageValue) || pageValue < 1) {
        throw new ReviewError('BAD_PAGE', 'page 必须是正整数', 400);
    }
    const digest = await sha256ForFile(absolute, stat);
    const pdf = await ensureDocumentPdf(ctx, absolute, digest);
    const layer = await getTextLayer(ctx, pdf, pageValue);
    return {
        ok: true,
        textLayer: {
            page: layer.page,
            width: layer.width,
            height: layer.height,
            hasText: layer.hasText,
            blocks: layer.blocks,
        },
    };
}
/** GET /raw：直接返回图片原文件 */
async function handleRaw(ctx, url, res) {
    const { absolute, kind } = await previewContext(ctx, url);
    if (kind !== 'image')
        throw new ReviewError('NOT_IMAGE', '该文件不是图片', 400);
    const ext = path.extname(absolute).toLowerCase();
    const buffer = await fsp.readFile(absolute);
    res.writeHead(200, {
        'content-type': IMAGE_MIME[ext] ?? 'application/octet-stream',
        'content-length': buffer.length,
        'cache-control': 'private, max-age=60',
    });
    res.end(buffer);
}
// ---------------------------------------------------------------------------
// 插件入口
// ---------------------------------------------------------------------------
export function apply(ctx) {
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: async (req, res) => {
            try {
                if (!isTrustedRequest(ctx, req)) {
                    throw new ReviewError('FORBIDDEN', '只接受本机 DSH GUI 的请求', 403);
                }
                const url = new URL(req.url ?? '/', 'http://dsh.internal');
                const route = url.pathname.slice(API_PREFIX.length) || '/';
                const method = req.method ?? 'GET';
                if (method === 'GET' && route === '/tree') {
                    writeJson(res, 200, await handleTree(ctx, url));
                    return;
                }
                if (method === 'GET' && route === '/file') {
                    writeJson(res, 200, await handleRead(ctx, url));
                    return;
                }
                if (method === 'GET' && route === '/stat') {
                    writeJson(res, 200, await handleStat(ctx, url));
                    return;
                }
                if (method === 'PUT' && route === '/file') {
                    writeJson(res, 200, await handleWrite(ctx, req));
                    return;
                }
                if (method === 'POST' && route === '/export') {
                    writeJson(res, 200, await handleExport(ctx, req));
                    return;
                }
                if (method === 'POST' && route === '/send') {
                    writeJson(res, 200, await handleSend(ctx, req));
                    return;
                }
                if (method === 'GET' && route === '/preview') {
                    writeJson(res, 200, await handlePreview(ctx, url));
                    return;
                }
                if (method === 'GET' && route === '/sheet') {
                    writeJson(res, 200, await handleSheet(ctx, url));
                    return;
                }
                if (method === 'GET' && route === '/render') {
                    await handleRender(ctx, url, res);
                    return;
                }
                if (method === 'GET' && route === '/document') {
                    await handleDocument(ctx, url, res);
                    return;
                }
                if (method === 'GET' && route === '/textlayer') {
                    writeJson(res, 200, await handleTextLayer(ctx, url));
                    return;
                }
                if (method === 'GET' && route === '/raw') {
                    await handleRaw(ctx, url, res);
                    return;
                }
                throw new ReviewError('NOT_FOUND', `未知接口：${method} ${route}`, 404);
            }
            catch (error) {
                writeError(res, error);
            }
        },
    }), 'dsh-file-review: 工作区文件 API');
    ctx.logger?.info?.('[dsh-file-review] 已注册 %s', API_PREFIX);
}
//# sourceMappingURL=index.js.map
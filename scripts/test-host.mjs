#!/usr/bin/env node
/**
 * Host 半离线自测：用假 ctx / 假 req / 假 res 直接调用 lib/index.js 注册的处理器，
 * 覆盖 列表 / 读取 / 写回+备份 / 版本冲突 / 路径越界 / 导出批注。
 *
 * 不依赖 DSH 运行时；验证的是 lib/index.js（tsc 产物），所以先 npm run build。
 * 用法：node scripts/test-host.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { apply } from '../lib/index.js';

const API = '/plugins/dsh-file-review/api';
const results = [];
let failed = 0;

function assert(name, condition, detail = '') {
  results.push(`${condition ? 'ok  ' : 'FAIL'} ${name}${condition ? '' : `  ← ${detail}`}`);
  if (!condition) {
    failed += 1;
    // 失败即时打印：脚本中途抛错时 finish() 跑不到，否则失败原因会丢
    console.log(`  FAIL ${name}  ← ${detail}`);
  }
}

function makeReq(method, url, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from(payload ? [Buffer.from(payload, 'utf8')] : []);
  req.method = method;
  req.url = url;
  req.headers = {
    host: '127.0.0.1:3080',
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
    ...headers,
  };
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

function makeRes() {
  let resolveDone;
  const done = new Promise((resolvePromise) => {
    resolveDone = resolvePromise;
  });
  const state = { status: 0, body: '', headers: {}, raw: Buffer.alloc(0) };
  const res = {
    writeHead(status, headers) {
      state.status = status;
      state.headers = headers ?? {};
    },
    write(chunk) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ''), 'utf8');
      state.raw = Buffer.concat([state.raw, buffer]);
      return true;
    },
    end(body) {
      if (body !== undefined) {
        const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'utf8');
        state.raw = Buffer.concat([state.raw, buffer]);
      }
      state.body = state.raw.toString('utf8');
      resolveDone();
    },
  };
  return { res, state, done };
}

async function call(handler, method, path, body, headers = {}) {
  const req = makeReq(method, `${API}${path}`, body, headers);
  const { res, state, done } = makeRes();
  await handler(req, res);
  await done;
  let json = null;
  try {
    json = JSON.parse(state.body);
  } catch {
    json = null;
  }
  return { status: state.status, json, raw: state.raw, headers: state.headers };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** 最小 zip 构造器（仅 stored，测试用，不依赖第三方库） */
function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const nameBytes = Buffer.from(name, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function buildXlsxFixture() {
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="数据" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C4"/><cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="10" customWidth="1"/></cols><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>项目</t></is></c><c r="B1" t="inlineStr"><is><t></t></is></c><c r="C1" t="inlineStr"><is><t>备注</t></is></c></row><row r="2" ht="24"><c r="A2" t="inlineStr"><is><t>苹果</t></is></c><c r="B2"><v>43</v></c><c r="C2" t="inlineStr"><is><t>待修改</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>橙子</t></is></c><c r="B3"><v>7</v></c></row><row r="4"><c r="B4"><v>49</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells></worksheet>`;
  return buildZip([
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', rels],
    ['xl/worksheets/sheet1.xml', sheet],
  ]);
}

const SHEET_WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="数据" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const SHEET_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

function buildSheetXlsx(sheetXml, extraEntries = []) {
  return buildZip([
    ['xl/workbook.xml', SHEET_WORKBOOK],
    ['xl/_rels/workbook.xml.rels', SHEET_RELS],
    ['xl/worksheets/sheet1.xml', sheetXml],
    ...extraEntries,
  ]);
}

function buildLargeXlsxFixture(rowCount) {
  const rows = Array.from(
    { length: rowCount },
    (_, index) => `<row r="${index + 1}"><c r="A${index + 1}"><v>${index + 1}</v></c></row>`,
  ).join('');
  return buildSheetXlsx(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:A${rowCount}"/><sheetData>${rows}</sheetData></worksheet>`,
  );
}

/** V-18 回归：工作表 XML 解压后 >8MB（真实大表 12,431 行时 17.7MB），
 *  旧的 8MB 单条目上限会把有效大表误判成 NO_SHEET，截断条永远走不到。 */
function buildBigWorksheetXlsxFixture() {
  const padding = 'x'.repeat(9 * 1024 * 1024);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:AX12431"/><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="B1" t="inlineStr"><is><t>${padding}</t></is></c></row></sheetData></worksheet>`;
  console.log(`  info 大工作表 XML ${Buffer.byteLength(sheet)} B（>8MB 单条目上限）`);
  return buildSheetXlsx(sheet);
}

function buildBadEntityXlsxFixture() {
  return buildSheetXlsx(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:A1"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&#1114112;</t></is></c></row></sheetData></worksheet>`,
  );
}

/** P1 回归样本：3 万个未闭合 `<c` + 280KB 正文（约 400KB），旧正则会无界回溯数秒 */
function buildPathologicalXlsxFixture() {
  const body = `<c r="A1" t="inlineStr"><is><t>${'<c '.repeat(30000)}${'x'.repeat(280000)}`;
  return buildSheetXlsx(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:A1"/><sheetData><row r="1">${body}</row></sheetData></worksheet>`,
  );
}

function buildEncryptedXlsxFixture() {
  return buildZip([
    ['EncryptionInfo', Buffer.from('encrypted-info')],
    ['EncryptedPackage', Buffer.from('encrypted-package')],
  ]);
}

// pdfjs 能真正解析的最小 PDF：1 页、空资源、内容流 5 字节。
function buildMinimalPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 5 >>\nstream\nBT ET\nendstream',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((content, index) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${index + 1} 0 obj\n${content}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

async function main() {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-fr-test-'));
  mkdirSync(join(workspace, 'docs'), { recursive: true });
  writeFileSync(join(workspace, 'notes.md'), '# 标题\n\n第一行内容\n第二行内容\n', 'utf8');
  writeFileSync(join(workspace, 'docs', 'a.txt'), 'hello\n', 'utf8');
  writeFileSync(join(workspace, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
  const previewDir = join(workspace, '__preview');
  mkdirSync(previewDir, { recursive: true });
  const previewPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
    'base64',
  );
  writeFileSync(join(previewDir, 'page-1.png'), previewPng);
  writeFileSync(join(previewDir, 'page-2.png'), previewPng);
  writeFileSync(join(workspace, 'report.docx'), Buffer.from('fake-docx'));
  writeFileSync(join(workspace, 'sheet.xlsx'), buildXlsxFixture());
  writeFileSync(join(workspace, 'large.xlsx'), buildLargeXlsxFixture(1205));
  writeFileSync(join(workspace, 'big-sheet.xlsx'), buildBigWorksheetXlsxFixture());
  writeFileSync(join(workspace, 'broken.xlsx'), Buffer.from('PK\x03\x04broken-zip-without-eocd'));
  writeFileSync(join(workspace, 'bad-entity.xlsx'), buildBadEntityXlsxFixture());
  writeFileSync(join(workspace, 'pathological.xlsx'), buildPathologicalXlsxFixture());
  writeFileSync(join(workspace, 'locked.xlsx'), buildEncryptedXlsxFixture());
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1');
  writeFileSync(join(workspace, 'converted.pdf'), pdfBytes);
  writeFileSync(join(workspace, 'valid.pdf'), buildMinimalPdf());
  writeFileSync(join(workspace, 'pic.png'), previewPng);
  writeFileSync(join(workspace, 'pic.avif'), previewPng);
  writeFileSync(join(workspace, 'scan.tiff'), Buffer.from('fake-tiff'));
  const mediaBytes = Buffer.alloc(1024, 7);
  writeFileSync(join(workspace, 'clip.mp4'), mediaBytes);
  writeFileSync(join(workspace, 'voice.mp3'), mediaBytes.subarray(0, 600));
  const ftyp = (major, compatible) => {
    const size = 16 + compatible.length * 4;
    const box = Buffer.alloc(size);
    box.writeUInt32BE(size, 0);
    box.write('ftyp', 4, 'latin1');
    box.write(major, 8, 'latin1');
    box.writeUInt32BE(0, 12);
    compatible.forEach((brand, index) => box.write(brand, 16 + index * 4, 'latin1'));
    return box;
  };
  writeFileSync(join(workspace, 'movie.mov'), ftyp('qt  ', ['qt  ']));
  writeFileSync(join(workspace, 'hevc.mp4'), ftyp('isom', ['isom', 'hvc1']));
  writeFileSync(join(workspace, 'blob.xyz'), Buffer.from('unsupported'));

  let handler = null;
  const workspaceRoot = parse(workspace).root;
  const homeDir = process.env.USERPROFILE ?? workspaceRoot;
  const probeCwd = process.env.TEMP ?? workspace;
  const sessionController = {
    calls: [],
    fail: false,
    async prompt(request, signal) {
      if (this.fail) throw new Error('controller boom');
      this.calls.push({ request, hasSignal: signal instanceof AbortSignal });
      return {};
    },
  };
  const renderCalls = [];
  const previewRenderer = {
    async render(input) {
      renderCalls.push({ ...input });
      const pageImage = (index) => ({
        index,
        page: index,
        label: `第${index}页`,
        width: 100,
        height: 140,
        filePath: join(previewDir, `page-${index}.png`),
      });
      return {
        pageCount: 2,
        truncated: false,
        dpi: 120,
        missingFonts: [],
        images: [pageImage(1), pageImage(2)],
      };
    },
  };
  const converterCalls = [];
  const documentConverter = {
    async toPdf(input) {
      converterCalls.push({ ...input });
      return join(workspace, 'converted.pdf');
    },
  };
  const textLayerCalls = [];
  const textLayerExtractor = {
    async extract(pdfPath, page) {
      textLayerCalls.push({ pdfPath, page });
      return {
        page,
        width: 612,
        height: 792,
        hasText: true,
        blocks: [{ text: '目标数字：42', x: 0.1, y: 0.2, w: 0.3, h: 0.02 }],
      };
    },
  };
  const ctx = {
    effect(fn) {
      const result = fn();
      return result;
    },
    webServer: {
      register(route) {
        handler = route.handler;
        return () => undefined;
      },
    },
    sessions: {
      get(sessionId) {
        if (sessionId === 's1') return { header: { cwd: workspace } };
        if (sessionId === 'root') return { header: { cwd: workspaceRoot } };
        return undefined;
      },
    },
    sessionController,
    get(serviceName) {
      if (serviceName === 'previewRenderer') return previewRenderer;
      if (serviceName === 'documentConverter') return documentConverter;
      if (serviceName === 'textLayerExtractor') return textLayerExtractor;
      return undefined;
    },
    webRuntime: { trustedHosts: [] },
    logger: { info() {} },
  };

  apply(ctx);
  assert('注册了 API 处理器', typeof handler === 'function');
  if (!handler) return finish(workspace);

  // 1. 列目录
  const tree = await call(handler, 'GET', '/tree?sessionId=s1');
  assert('GET /tree 返回 200', tree.status === 200, JSON.stringify(tree.json));
  const names = (tree.json?.entries ?? []).map((entry) => entry.name);
  assert('树里含 notes.md / docs / binary.bin', ['notes.md', 'docs', 'binary.bin'].every((name) => names.includes(name)), names.join(','));
  const binaryEntry = (tree.json?.entries ?? []).find((entry) => entry.name === 'binary.bin');
  assert('二进制文件标记为不可编辑', binaryEntry?.editable === false, JSON.stringify(binaryEntry));

  // 1b. 工作区为盘根时必须整条链路都拒绝（tree 的根分支不能绕过校验）
  const rootTree = await call(handler, 'GET', '/tree?sessionId=root');
  assert(
    '工作区为盘根时 /tree 返回 403 BAD_WORKSPACE',
    rootTree.status === 403 && rootTree.json?.error?.code === 'BAD_WORKSPACE',
    `status=${rootTree.status} body=${JSON.stringify(rootTree.json)}`,
  );
  const cwdRootTree = await call(handler, 'GET', `/tree?cwd=${encodeURIComponent(workspaceRoot)}`);
  assert(
    '无会话时客户端上报 cwd 不再被采信（400 NO_SESSION）',
    cwdRootTree.status === 400 && cwdRootTree.json?.error?.code === 'NO_SESSION',
    `status=${cwdRootTree.status} body=${JSON.stringify(cwdRootTree.json)}`,
  );

  // 1c. 工作区只能来自已验证会话：无 sessionId / 伪 sessionId 都不行
  const cwdHomeTree = await call(handler, 'GET', `/tree?cwd=${encodeURIComponent(homeDir)}`);
  assert(
    '无 session 带 cwd 的 /tree 返回 400 NO_SESSION',
    cwdHomeTree.status === 400 && cwdHomeTree.json?.error?.code === 'NO_SESSION',
    `status=${cwdHomeTree.status} body=${JSON.stringify(cwdHomeTree.json)}`,
  );
  const fakeSessionTree = await call(handler, 'GET', `/tree?sessionId=bogus&cwd=${encodeURIComponent(homeDir)}`);
  assert(
    '伪 sessionId 带 cwd 的 /tree 返回 400 NO_SESSION',
    fakeSessionTree.status === 400 && fakeSessionTree.json?.error?.code === 'NO_SESSION',
    `status=${fakeSessionTree.status} body=${JSON.stringify(fakeSessionTree.json)}`,
  );
  const validSessionTree = await call(handler, 'GET', '/tree?sessionId=s1');
  assert(
    '合法 sessionId 的 /tree 仍返回 200',
    validSessionTree.status === 200 && validSessionTree.json?.ok === true,
    `status=${validSessionTree.status} body=${JSON.stringify(validSessionTree.json)}`,
  );

  const subTree = await call(handler, 'GET', '/tree?sessionId=s1&dir=docs');
  assert('GET /tree?dir=docs 返回 a.txt', (subTree.json?.entries ?? []).some((entry) => entry.name === 'a.txt'));

  // 2. 读文件
  const read = await call(handler, 'GET', '/file?sessionId=s1&path=notes.md');
  assert('GET /file 返回内容', read.status === 200 && read.json?.file?.content?.includes('第一行内容'), JSON.stringify(read.json));
  assert('GET /file 的 path 是工作区相对路径（短路径/软链环境也一致）', read.json?.file?.path === 'notes.md', JSON.stringify(read.json?.file?.path));
  assert('GET /file 返回 sha1', typeof read.json?.file?.sha1 === 'string' && read.json.file.sha1.length === 40);
  assert('GET /file 可编辑标记', read.json?.file?.readonly === false);

  const binaryRead = await call(handler, 'GET', '/file?sessionId=s1&path=binary.bin');
  assert('二进制文件只读且不返回内容', binaryRead.status === 200 && binaryRead.json?.file?.readonly === true && binaryRead.json?.file?.text === false);

  const cwdRead = await call(handler, 'GET', `/file?cwd=${encodeURIComponent(homeDir)}&path=win.ini`);
  assert(
    '无 session 带 cwd 的 /file 返回 400 NO_SESSION',
    cwdRead.status === 400 && cwdRead.json?.error?.code === 'NO_SESSION',
    `status=${cwdRead.status} body=${JSON.stringify(cwdRead.json)}`,
  );

  // 3. 路径越界
  const escape = await call(handler, 'GET', '/file?sessionId=s1&path=../../Windows/win.ini');
  assert('路径越界被拒（403/400）', escape.status === 403 || escape.status === 400, `status=${escape.status}`);
  const absolute = await call(handler, 'GET', '/file?sessionId=s1&path=C%3A%5CWindows%5Cwin.ini');
  assert('绝对路径被拒', absolute.status === 403 || absolute.status === 400, `status=${absolute.status}`);

  // 4. 写回 + 备份
  const sha1 = read.json.file.sha1;
  const saved = await call(handler, 'PUT', '/file', {
    sessionId: 's1',
    path: 'notes.md',
    content: '# 标题\n\n第一行内容（已改）\n第二行内容\n',
    baseSha1: sha1,
  });
  assert('PUT /file 保存成功', saved.status === 200 && saved.json?.ok === true, JSON.stringify(saved.json));
  assert('保存后内容已更新', readFileSync(join(workspace, 'notes.md'), 'utf8').includes('已改'));
  const backupPath = join(workspace, 'notes.md.bak');
  assert('保存前生成了 .bak 备份', existsSync(backupPath), backupPath);
  assert('.bak 是旧内容', readFileSync(backupPath, 'utf8').includes('第一行内容\n'));
  assert('保存返回新 sha1', saved.json?.file?.sha1 && saved.json.file.sha1 !== sha1);

  const cwdWrite = await call(handler, 'PUT', '/file', { cwd: probeCwd, path: 'dsh-review-probe.txt', content: 'x' });
  assert(
    '无 session 仅带 cwd 的 PUT /file 返回 400 NO_SESSION',
    cwdWrite.status === 400 && cwdWrite.json?.error?.code === 'NO_SESSION',
    `status=${cwdWrite.status} body=${JSON.stringify(cwdWrite.json)}`,
  );

  // 5. 版本冲突
  const conflict = await call(handler, 'PUT', '/file', {
    sessionId: 's1',
    path: 'notes.md',
    content: 'stale write',
    baseSha1: sha1,
  });
  assert('过期版本写回返回 409', conflict.status === 409 && conflict.json?.error?.code === 'CONFLICT', `status=${conflict.status}`);

  // 6. stat
  const stat = await call(handler, 'GET', '/stat?sessionId=s1&path=notes.md');
  assert('GET /stat 返回 sha1', stat.status === 200 && typeof stat.json?.stat?.sha1 === 'string');

  // 6b. S2 预览：分页元数据、渲染 PNG、图片原始字节、错误分支
  const docPreview = await call(handler, 'GET', '/preview?sessionId=s1&path=report.docx');
  assert(
    'GET /preview 返回分页元数据',
    docPreview.status === 200 && docPreview.json?.preview?.kind === 'pages',
    JSON.stringify(docPreview.json),
  );
  assert(
    '分页预览有 2 页且标签正确',
    docPreview.json?.preview?.pageCount === 2 && docPreview.json?.preview?.pages?.[0]?.label === '第1页',
    JSON.stringify(docPreview.json?.preview),
  );
  assert(
    '渲染器收到 pages 模式与 sha256',
    renderCalls.at(-1)?.mode === 'pages' && /^[0-9a-f]{64}$/.test(renderCalls.at(-1)?.sha256 ?? ''),
    JSON.stringify(renderCalls.at(-1)),
  );
  assert(
    'docx 先转 PDF 再渲染（渲染器拿到 PDF 路径）',
    String(renderCalls.at(-1)?.absolutePath ?? '').endsWith('converted.pdf'),
    JSON.stringify(renderCalls.at(-1)),
  );
  assert(
    'docx 转换器收到源路径、sha256 与 kind=docx',
    converterCalls.at(-1)?.kind === 'docx' &&
      /^[0-9a-f]{64}$/.test(converterCalls.at(-1)?.sha256 ?? '') &&
      String(converterCalls.at(-1)?.absolutePath ?? '').endsWith('report.docx'),
    JSON.stringify(converterCalls.at(-1)),
  );
  assert(
    '预览响应不泄露本地渲染路径',
    !JSON.stringify(docPreview.json).includes(previewDir),
    JSON.stringify(docPreview.json),
  );
  const pdfPreview = await call(handler, 'GET', '/preview?sessionId=s1&path=valid.pdf');
  assert(
    '普通 PDF /preview 返回 200 pages（document.destroy 回归）',
    pdfPreview.status === 200 &&
      pdfPreview.json?.preview?.kind === 'pages' &&
      pdfPreview.json?.preview?.pageCount === 2,
    JSON.stringify(pdfPreview.json),
  );
  assert(
    '普通 PDF 直接渲染，不经转换器',
    String(renderCalls.at(-1)?.absolutePath ?? '').endsWith('valid.pdf') &&
      !converterCalls.some((item) => String(item.absolutePath ?? '').endsWith('valid.pdf')),
    JSON.stringify({ render: renderCalls.at(-1), converters: converterCalls.length }),
  );
  const previewKey = docPreview.json?.preview?.key;
  const page1 = await call(handler, 'GET', `/render?sessionId=s1&path=report.docx&page=1&key=${previewKey}`);
  assert(
    'GET /render 返回 PNG',
    page1.status === 200 && page1.headers['content-type'] === 'image/png' && page1.raw.equals(previewPng),
    `status=${page1.status} type=${page1.headers['content-type']} len=${page1.raw.length}`,
  );
  const wrongKey = '0'.repeat(64);
  const pageWithWrongKey = await call(handler, 'GET', `/render?sessionId=s1&path=report.docx&page=1&key=${wrongKey}`);
  assert(
    'GET /render 不信任过期/伪造 key',
    pageWithWrongKey.status === 200 && pageWithWrongKey.raw.equals(previewPng),
    `status=${pageWithWrongKey.status} len=${pageWithWrongKey.raw.length}`,
  );
  const missingPage = await call(handler, 'GET', `/render?sessionId=s1&path=report.docx&page=99&key=${previewKey}`);
  assert(
    '越界页号返回 404 NO_PAGE',
    missingPage.status === 404 && missingPage.json?.error?.code === 'NO_PAGE',
    JSON.stringify(missingPage.json),
  );
  const xlsxPreview = await call(handler, 'GET', '/preview?sessionId=s1&path=sheet.xlsx');
  assert(
    'xlsx 预览返回 sheet 列表',
    xlsxPreview.status === 200 &&
      xlsxPreview.json?.preview?.kind === 'sheet' &&
      xlsxPreview.json?.preview?.sheets?.[0]?.name === '数据' &&
      xlsxPreview.json?.preview?.pages === undefined,
    JSON.stringify(xlsxPreview.json),
  );
  assert(
    'xlsx 不再走 PDF 转换',
    !converterCalls.some((item) => item.kind === 'xlsx'),
    JSON.stringify(converterCalls),
  );
  const sheetResponse = await call(handler, 'GET', '/sheet?sessionId=s1&path=sheet.xlsx&sheet=0');
  assert(
    'GET /sheet 返回行列、单元格与合并',
    sheetResponse.status === 200 &&
      sheetResponse.json?.sheet?.name === '数据' &&
      sheetResponse.json?.sheet?.rowCount === 4 &&
      sheetResponse.json?.sheet?.colCount === 3 &&
      sheetResponse.json?.sheet?.cells?.find((cell) => cell.ref === 'B2')?.text === '43' &&
      sheetResponse.json?.sheet?.merges?.includes('A1:B1'),
    JSON.stringify(sheetResponse.json),
  );
  assert(
    '列宽/行高按 xlsx 换算',
    sheetResponse.json?.sheet?.columns?.[0] === 131 &&
      sheetResponse.json?.sheet?.columns?.[1] === 75 &&
      sheetResponse.json?.sheet?.rows?.[1]?.height === 32,
    JSON.stringify(sheetResponse.json?.sheet),
  );
  const sheetMissing = await call(handler, 'GET', '/sheet?sessionId=s1&path=sheet.xlsx&sheet=9');
  assert(
    '越界 sheet 返回 404 NO_SHEET',
    sheetMissing.status === 404 && sheetMissing.json?.error?.code === 'NO_SHEET',
    JSON.stringify(sheetMissing.json),
  );
  const sheetWrongKind = await call(handler, 'GET', '/sheet?sessionId=s1&path=report.docx&sheet=0');
  assert(
    '非表格调用 /sheet 返回 400 NOT_SHEET',
    sheetWrongKind.status === 400 && sheetWrongKind.json?.error?.code === 'NOT_SHEET',
    JSON.stringify(sheetWrongKind.json),
  );
  const sheetNoSession = await call(handler, 'GET', '/sheet?path=sheet.xlsx&sheet=0');
  assert(
    '无 session 的 /sheet 返回 400 NO_SESSION',
    sheetNoSession.status === 400 && sheetNoSession.json?.error?.code === 'NO_SESSION',
    JSON.stringify(sheetNoSession.json),
  );
  const largeSheet = await call(handler, 'GET', '/sheet?sessionId=s1&path=large.xlsx&sheet=0');
  assert(
    '大表默认只返回前 1000 行并标记截断',
    largeSheet.status === 200 &&
      largeSheet.json?.sheet?.rowCount === 1000 &&
      largeSheet.json?.sheet?.totalRows === 1205 &&
      largeSheet.json?.sheet?.totalCols === 1 &&
      largeSheet.json?.sheet?.truncated === true,
    JSON.stringify({
      rowCount: largeSheet.json?.sheet?.rowCount,
      totalRows: largeSheet.json?.sheet?.totalRows,
      truncated: largeSheet.json?.sheet?.truncated,
    }),
  );
  const fullSheet = await call(handler, 'GET', '/sheet?sessionId=s1&path=large.xlsx&sheet=0&full=1');
  assert(
    'full=1 返回完整 1205 行且不再标记截断',
    fullSheet.status === 200 &&
      fullSheet.json?.sheet?.rowCount === 1205 &&
      fullSheet.json?.sheet?.totalRows === 1205 &&
      fullSheet.json?.sheet?.truncated === false,
    JSON.stringify({
      rowCount: fullSheet.json?.sheet?.rowCount,
      totalRows: fullSheet.json?.sheet?.totalRows,
      truncated: fullSheet.json?.sheet?.truncated,
    }),
  );
  const bigSheet = await call(handler, 'GET', '/sheet?sessionId=s1&path=big-sheet.xlsx&sheet=0');
  assert(
    '工作表 XML >8MB 的大表仍能打开并走截断（V-18）',
    bigSheet.status === 200 &&
      bigSheet.json?.sheet?.rowCount === 1000 &&
      bigSheet.json?.sheet?.totalRows === 12431 &&
      bigSheet.json?.sheet?.truncated === true,
    JSON.stringify({
      status: bigSheet.status,
      error: bigSheet.json?.error,
      rowCount: bigSheet.json?.sheet?.rowCount,
      totalRows: bigSheet.json?.sheet?.totalRows,
      truncated: bigSheet.json?.sheet?.truncated,
    }),
  );
  const brokenSheet = await call(handler, 'GET', '/sheet?sessionId=s1&path=broken.xlsx&sheet=0');
  assert(
    '损坏 zip 的 NO_SHEET 带具体原因 ZIP_EOCD_MISSING',
    brokenSheet.status === 404 &&
      brokenSheet.json?.error?.code === 'NO_SHEET' &&
      brokenSheet.json?.error?.reason === 'ZIP_EOCD_MISSING',
    JSON.stringify(brokenSheet.json),
  );
  const encrypted = await call(handler, 'GET', '/preview?sessionId=s1&path=locked.xlsx');
  assert(
    '加密 xlsx 返回 422 ERR_ENCRYPTED_FILE',
    encrypted.status === 422 && encrypted.json?.error?.code === 'ERR_ENCRYPTED_FILE',
    JSON.stringify(encrypted.json),
  );
  const badEntity = await call(handler, 'GET', '/sheet?sessionId=s1&path=bad-entity.xlsx&sheet=0');
  assert(
    '非法 XML 字符实体返回 400 BAD_XML_ENTITY（不是 500）',
    badEntity.status === 400 && badEntity.json?.error?.code === 'BAD_XML_ENTITY',
    JSON.stringify(badEntity.json),
  );
  const pathologicalStart = performance.now();
  const pathological = await call(handler, 'GET', '/sheet?sessionId=s1&path=pathological.xlsx&sheet=0');
  const pathologicalMs = performance.now() - pathologicalStart;
  console.log(`  info 病态 sheet（3 万个未闭合 <c，约 400 KB）解析耗时 ${pathologicalMs.toFixed(1)} ms`);
  assert(
    '病态 sheet 有界扫描不再无界回溯（<500ms）',
    pathological.status === 200 && pathologicalMs < 500,
    `status=${pathological.status} elapsed=${pathologicalMs.toFixed(1)}ms`,
  );
  const documentResponse = await call(handler, 'GET', '/document?sessionId=s1&path=report.docx');
  assert(
    'GET /document 返回 PDF 字节',
    documentResponse.status === 200 &&
      documentResponse.headers['content-type'] === 'application/pdf' &&
      documentResponse.raw.subarray(0, 5).toString('latin1') === '%PDF-',
    `status=${documentResponse.status} type=${documentResponse.headers['content-type']} len=${documentResponse.raw.length}`,
  );
  const textLayer = await call(handler, 'GET', '/textlayer?sessionId=s1&path=report.docx&page=1');
  assert(
    'GET /textlayer 返回归一化文字块',
    textLayer.status === 200 &&
      textLayer.json?.textLayer?.hasText === true &&
      textLayer.json?.textLayer?.blocks?.[0]?.text === '目标数字：42',
    JSON.stringify(textLayer.json),
  );
  assert(
    '文字层抽取器收到缓存 PDF 与页码',
    String(textLayerCalls.at(-1)?.pdfPath ?? '').endsWith('converted.pdf') && textLayerCalls.at(-1)?.page === 1,
    JSON.stringify(textLayerCalls.at(-1)),
  );
  const textLayerNoSession = await call(handler, 'GET', '/textlayer?path=report.docx&page=1');
  assert(
    '无 session 的 /textlayer 返回 400 NO_SESSION',
    textLayerNoSession.status === 400 && textLayerNoSession.json?.error?.code === 'NO_SESSION',
    JSON.stringify(textLayerNoSession.json),
  );
  const imagePreview = await call(handler, 'GET', '/preview?sessionId=s1&path=pic.png');
  assert(
    '图片预览返回 image 元数据',
    imagePreview.status === 200 && imagePreview.json?.preview?.kind === 'image' && imagePreview.json?.preview?.mime === 'image/png',
    JSON.stringify(imagePreview.json),
  );
  const rawImage = await call(handler, 'GET', '/raw?sessionId=s1&path=pic.png');
  assert(
    'GET /raw 返回图片字节',
    rawImage.status === 200 && rawImage.headers['content-type'] === 'image/png' && rawImage.raw.equals(previewPng),
    `status=${rawImage.status} type=${rawImage.headers['content-type']} len=${rawImage.raw.length}`,
  );
  // v0.3.0：音视频走 media kind + /raw Range（浏览器拖动进度条依赖 206）
  const videoPreview = await call(handler, 'GET', '/preview?sessionId=s1&path=clip.mp4');
  assert(
    '视频预览返回 media/video 元数据',
    videoPreview.status === 200
      && videoPreview.json?.preview?.kind === 'media'
      && videoPreview.json?.preview?.media === 'video'
      && videoPreview.json?.preview?.mime === 'video/mp4'
      && videoPreview.json?.preview?.size === 1024,
    JSON.stringify(videoPreview.json),
  );
  const audioPreview = await call(handler, 'GET', '/preview?sessionId=s1&path=voice.mp3');
  assert(
    '音频预览返回 media/audio 元数据',
    audioPreview.status === 200
      && audioPreview.json?.preview?.kind === 'media'
      && audioPreview.json?.preview?.media === 'audio'
      && audioPreview.json?.preview?.mime === 'audio/mpeg',
    JSON.stringify(audioPreview.json),
  );
  const movPreview = await call(handler, 'GET', '/preview?sessionId=s1&path=movie.mov');
  assert(
    'MOV/QuickTime 不被 Host 拦截（交给浏览器运行时判定）',
    movPreview.status === 200
      && movPreview.json?.preview?.kind === 'media'
      && movPreview.json?.preview?.media === 'video',
    JSON.stringify(movPreview.json),
  );
  const hevcPreview = await call(handler, 'GET', '/preview?sessionId=s1&path=hevc.mp4');
  assert(
    'HEVC 不被 Host 拦截（由客户端 videoWidth 看门狗兜底）',
    hevcPreview.status === 200
      && hevcPreview.json?.preview?.kind === 'media'
      && hevcPreview.json?.preview?.media === 'video',
    JSON.stringify(hevcPreview.json),
  );
  const rawMedia = await call(handler, 'GET', '/raw?sessionId=s1&path=clip.mp4');
  assert(
    'GET /raw 音视频支持整段读取并声明 Accept-Ranges',
    rawMedia.status === 200
      && rawMedia.headers['accept-ranges'] === 'bytes'
      && rawMedia.headers['content-type'] === 'video/mp4'
      && rawMedia.raw.length === 1024,
    `status=${rawMedia.status} len=${rawMedia.raw.length} ranges=${rawMedia.headers['accept-ranges']}`,
  );
  const rangeMedia = await call(handler, 'GET', '/raw?sessionId=s1&path=clip.mp4', undefined, { range: 'bytes=0-99' });
  assert(
    'Range 请求返回 206 与前 100 字节',
    rangeMedia.status === 206
      && rangeMedia.headers['content-range'] === 'bytes 0-99/1024'
      && rangeMedia.headers['content-length'] === 100
      && rangeMedia.raw.length === 100,
    `status=${rangeMedia.status} range=${rangeMedia.headers['content-range']} len=${rangeMedia.raw.length}`,
  );
  const suffixMedia = await call(handler, 'GET', '/raw?sessionId=s1&path=clip.mp4', undefined, { range: 'bytes=-50' });
  assert(
    '后缀 Range 返回最后 50 字节',
    suffixMedia.status === 206 && suffixMedia.headers['content-range'] === 'bytes 974-1023/1024',
    `status=${suffixMedia.status} range=${suffixMedia.headers['content-range']}`,
  );
  const badRange = await call(handler, 'GET', '/raw?sessionId=s1&path=clip.mp4', undefined, { range: 'bytes=2000-' });
  assert(
    '越界 Range 返回 416',
    badRange.status === 416 && badRange.headers['content-range'] === 'bytes */1024',
    `status=${badRange.status} range=${badRange.headers['content-range']}`,
  );
  const headMedia = await call(handler, 'HEAD', '/raw?sessionId=s1&path=clip.mp4');
  assert(
    'HEAD /raw 返回长度/类型且无正文',
    headMedia.status === 200
      && headMedia.headers['content-type'] === 'video/mp4'
      && Number(headMedia.headers['content-length']) === 1024
      && headMedia.raw.length === 0,
    `status=${headMedia.status} len=${headMedia.headers['content-length']} body=${headMedia.raw.length}`,
  );
  const avifPreview = await call(handler, 'GET', '/preview?sessionId=s1&path=pic.avif');
  assert(
    'avif 图片返回 image/avif',
    avifPreview.status === 200
      && avifPreview.json?.preview?.kind === 'image'
      && avifPreview.json?.preview?.mime === 'image/avif',
    JSON.stringify(avifPreview.json),
  );
  const tiffPreview = await call(handler, 'GET', '/preview?sessionId=s1&path=scan.tiff');
  assert(
    'tiff 返回 415 并提示转 PNG',
    tiffPreview.status === 415
      && tiffPreview.json?.error?.code === 'UNSUPPORTED_PREVIEW'
      && String(tiffPreview.json?.error?.message ?? '').includes('PNG'),
    JSON.stringify(tiffPreview.json),
  );
  const unsupported = await call(handler, 'GET', '/preview?sessionId=s1&path=blob.xyz');
  assert(
    '不支持的类型返回 415 UNSUPPORTED_PREVIEW',
    unsupported.status === 415 && unsupported.json?.error?.code === 'UNSUPPORTED_PREVIEW',
    JSON.stringify(unsupported.json),
  );
  const textPreview = await call(handler, 'GET', '/preview?sessionId=s1&path=notes.md');
  assert(
    '文本预览返回 text kind',
    textPreview.status === 200 && textPreview.json?.preview?.kind === 'text',
    JSON.stringify(textPreview.json),
  );
  const noSessionPreview = await call(handler, 'GET', '/preview?path=report.docx');
  assert(
    '无 session 的 /preview 返回 400 NO_SESSION',
    noSessionPreview.status === 400 && noSessionPreview.json?.error?.code === 'NO_SESSION',
    JSON.stringify(noSessionPreview.json),
  );
  const filePic = await call(handler, 'GET', '/file?sessionId=s1&path=pic.png');
  assert(
    'GET /file 返回 previewKind=image 且只读',
    filePic.status === 200 && filePic.json?.file?.previewKind === 'image' && filePic.json?.file?.readonly === true,
    JSON.stringify(filePic.json?.file),
  );

  // 7. 导出批注
  const exported = await call(handler, 'POST', '/export', {
    sessionId: 's1',
    path: 'notes.md',
    content: '请按以下批注修改文件：\n\n1. 【意见】改一下',
  });
  assert('POST /export 成功', exported.status === 200 && typeof exported.json?.export?.path === 'string', JSON.stringify(exported.json));
  const exportPath = join(workspace, 'notes.md.annotations.md');
  assert('导出文件存在且含批注', existsSync(exportPath) && readFileSync(exportPath, 'utf8').includes('改一下'));

  // 8. 批注回传：Host 侧 sessionController.prompt
  const sendMissingSession = await call(handler, 'POST', '/send', { markdown: '请改一下' });
  assert(
    'POST /send 缺 sessionId 返回 400',
    sendMissingSession.status === 400 && sendMissingSession.json?.error?.code === 'BAD_BODY',
    `status=${sendMissingSession.status} body=${JSON.stringify(sendMissingSession.json)}`,
  );
  const sendEmpty = await call(handler, 'POST', '/send', { sessionId: 's1', markdown: '   ' });
  assert(
    'POST /send 空 markdown 返回 400',
    sendEmpty.status === 400 && sendEmpty.json?.error?.code === 'BAD_BODY',
    `status=${sendEmpty.status} body=${JSON.stringify(sendEmpty.json)}`,
  );
  const sendText = '请按以下批注修改文件：\n\n1. 【意见】把标题改成 2 级';
  const sent = await call(handler, 'POST', '/send', { sessionId: 's1', markdown: sendText });
  assert('POST /send 成功', sent.status === 200 && sent.json?.ok === true, JSON.stringify(sent.json));
  const lastCall = sessionController.calls.at(-1);
  assert(
    'sessionController 收到 queue 模式与原文本',
    lastCall?.request?.mode === 'queue' && lastCall?.request?.content?.[0]?.text === sendText,
    JSON.stringify(lastCall?.request),
  );
  assert(
    'sessionController 收到 review- 前缀 requestId 与 sessionId',
    typeof lastCall?.request?.requestId === 'string' &&
      lastCall.request.requestId.startsWith('review-') &&
      lastCall.request.sessionId === 's1',
    JSON.stringify(lastCall?.request),
  );
  assert('sessionController 收到超时 signal', lastCall?.hasSignal === true);
  sessionController.fail = true;
  const sendFailed = await call(handler, 'POST', '/send', { sessionId: 's1', markdown: '触发失败' });
  assert(
    'sessionController 抛错返回 500 SEND_FAILED',
    sendFailed.status === 500 && sendFailed.json?.error?.code === 'SEND_FAILED',
    `status=${sendFailed.status} body=${JSON.stringify(sendFailed.json)}`,
  );
  sessionController.fail = false;

  // 9. 批注持久化（.dsh-file-review/）
  const annotationsEmpty = await call(handler, 'GET', '/annotations?sessionId=s1&path=notes.md');
  assert(
    'GET /annotations 空存储返回空列表',
    annotationsEmpty.status === 200 && Array.isArray(annotationsEmpty.json?.annotations) && annotationsEmpty.json.annotations.length === 0,
    JSON.stringify(annotationsEmpty.json),
  );
  const annotation = {
    id: 'a1',
    path: 'notes.md',
    from: 1,
    to: 2,
    quote: '第一行',
    text: '改标题',
    status: 'open',
    createdAt: 1,
    fileSha1: null,
  };
  const annotationsSaved = await call(handler, 'PUT', '/annotations', {
    sessionId: 's1',
    path: 'notes.md',
    annotations: [annotation],
    deleted: [],
  });
  assert(
    'PUT /annotations 写入成功',
    annotationsSaved.status === 200 && annotationsSaved.json?.annotations?.length === 1,
    JSON.stringify(annotationsSaved.json),
  );
  const annotationsRead = await call(handler, 'GET', '/annotations?sessionId=s1&path=notes.md');
  assert(
    'GET /annotations 读回批注',
    annotationsRead.status === 200 && annotationsRead.json?.annotations?.[0]?.text === '改标题',
    JSON.stringify(annotationsRead.json),
  );
  // 媒体时间码必须活着穿过后端清洗：刷新后“定位”依赖 block.at
  const mediaAnnotation = {
    id: 'm1',
    path: 'clip.mp4',
    from: 1,
    to: 1,
    quote: '视频 00:03',
    text: '剪短一点',
    status: 'open',
    createdAt: 2,
    fileSha1: null,
    block: { page: 1, label: '视频 00:03', at: 3 },
  };
  const mediaSaved = await call(handler, 'PUT', '/annotations', {
    sessionId: 's1',
    path: 'clip.mp4',
    annotations: [mediaAnnotation],
    deleted: [],
  });
  assert(
    'PUT /annotations 保留媒体时间码 block.at',
    mediaSaved.status === 200 && mediaSaved.json?.annotations?.[0]?.block?.at === 3,
    JSON.stringify(mediaSaved.json),
  );
  const annotationsOverwritten = await call(handler, 'PUT', '/annotations', {
    sessionId: 's1',
    path: 'notes.md',
    annotations: [{ ...annotation, text: '改副标题' }],
    deleted: [],
  });
  assert(
    '同 id 覆盖而不是重复',
    annotationsOverwritten.status === 200 &&
      annotationsOverwritten.json?.annotations?.length === 1 &&
      annotationsOverwritten.json.annotations[0].text === '改副标题',
    JSON.stringify(annotationsOverwritten.json),
  );
  const annotationsDeleted = await call(handler, 'PUT', '/annotations', {
    sessionId: 's1',
    path: 'notes.md',
    annotations: [],
    deleted: ['a1'],
  });
  assert(
    '墓碑删除批注',
    annotationsDeleted.status === 200 && annotationsDeleted.json?.annotations?.length === 0,
    JSON.stringify(annotationsDeleted.json),
  );
  const annotationsReAdded = await call(handler, 'PUT', '/annotations', {
    sessionId: 's1',
    path: 'notes.md',
    annotations: [annotation],
    deleted: [],
  });
  assert(
    '墓碑删除后不能被旧标签加回',
    annotationsReAdded.status === 200 && annotationsReAdded.json?.annotations?.length === 0,
    JSON.stringify(annotationsReAdded.json),
  );
  const annotationsEscape = await call(handler, 'PUT', '/annotations', {
    sessionId: 's1',
    path: '../outside.md',
    annotations: [annotation],
    deleted: [],
  });
  assert(
    '批注路径越界返回 400 BAD_PATH',
    annotationsEscape.status === 400 && annotationsEscape.json?.error?.code === 'BAD_PATH',
    JSON.stringify(annotationsEscape.json),
  );
  const annotationsTooLarge = await call(handler, 'PUT', '/annotations', {
    sessionId: 's1',
    path: 'notes.md',
    annotations: Array.from({ length: 500 }, (_, index) => ({
      ...annotation,
      id: `big-${index}`,
      text: 'x'.repeat(4000),
    })),
    deleted: [],
  });
  assert(
    '批注超过 512KB 返回 413 TOO_LARGE',
    annotationsTooLarge.status === 413 && annotationsTooLarge.json?.error?.code === 'TOO_LARGE',
    `status=${annotationsTooLarge.status} body=${JSON.stringify(annotationsTooLarge.json?.error)}`,
  );
  writeFileSync(join(workspace, 'stale.md.bak'), 'backup', 'utf8');
  const treeFiltered = await call(handler, 'GET', '/tree?sessionId=s1');
  const treeNames = (treeFiltered.json?.entries ?? []).map((entry) => entry.name);
  assert(
    '文件树隐藏 .bak 与 .dsh-file-review',
    !treeNames.includes('stale.md.bak') && !treeNames.includes('.dsh-file-review'),
    JSON.stringify(treeNames),
  );

  // 10. 未知路由 / 缺会话
  const unknown = await call(handler, 'GET', '/nope');
  assert('未知路由 404', unknown.status === 404);
  const noSession = await call(handler, 'GET', '/tree');
  assert('缺会话返回 NO_SESSION', noSession.status === 400 && noSession.json?.error?.code === 'NO_SESSION', JSON.stringify(noSession.json));

  finish(workspace);
}

function finish(workspace) {
  for (const line of results) console.log(`  ${line}`);
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    /* 忽略清理失败 */
  }
  if (failed > 0) {
    console.error(`\nHost 半自测失败：${failed} 项`);
    process.exit(1);
  }
  console.log(`\nHost 半自测通过：${results.length} 项`);
}

main().catch((error) => {
  // 中途抛错时把已收集的断言结果打出来，便于定位是哪一项之后炸的
  for (const line of results) console.log(`  ${line}`);
  console.error(error);
  process.exit(1);
});

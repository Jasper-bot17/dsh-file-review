/** Host 半 HTTP API 客户端（同源 fetch） */

const BASE = '/plugins/dsh-file-review/api';

export interface TreeEntry {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  mtimeMs: number;
  editable: boolean;
}

export type PreviewKind = 'text' | 'image' | 'pages' | 'sheet' | 'unsupported';

export interface SheetSummary {
  index: number;
  name: string;
}

export interface PreviewPage {
  index: number;
  page?: number;
  sheet?: string;
  range?: string;
  label: string;
  width: number;
  height: number;
}

export interface PreviewInfo {
  kind: PreviewKind;
  mime?: string;
  size?: number;
  sha1?: string;
  key?: string;
  pageCount?: number;
  truncated?: boolean;
  dpi?: number;
  missingFonts?: string[];
  pages?: PreviewPage[];
  /** xlsx DOM 表格：工作表列表；active 是默认表下标 */
  sheets?: SheetSummary[];
  active?: number;
}

/** xlsx 单元格（Host 只返回有值的格子） */
export interface SheetCell {
  ref: string;
  row: number;
  col: number;
  text: string;
  kind: 'string' | 'number' | 'boolean' | 'error';
}

export interface SheetRow {
  index: number;
  height?: number;
}

/** xlsx 单表数据；columns 是像素宽度，rows 只含显式行高 */
export interface SheetData {
  index: number;
  name: string;
  rowCount: number;
  colCount: number;
  /** 冻结窗格：前 rows 行 / 前 cols 列固定 */
  frozen?: { rows: number; cols: number };
  /** 未截断前的真实规模，用于「仅显示前 N 行」提示 */
  totalRows: number;
  totalCols: number;
  columns: number[];
  rows: SheetRow[];
  cells: SheetCell[];
  merges: string[];
  truncated: boolean;
}

/** 文字层文本块：坐标已归一化到页面（0–1，原点左上） */
export interface TextBlock {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextLayerInfo {
  page: number;
  width: number;
  height: number;
  hasText: boolean;
  blocks: TextBlock[];
}

export interface FileMeta {
  path: string;
  name: string;
  content: string;
  sha1: string;
  size: number;
  mtimeMs: number;
  readonly: boolean;
  tooLarge: boolean;
  text: boolean;
  previewKind: PreviewKind;
}

export interface SavedFile {
  path: string;
  sha1: string;
  size: number;
  mtimeMs: number;
  backup?: string;
}

function qs(sessionId: string | null, extra: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  if (sessionId) params.set('sessionId', sessionId);
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === 'string' && value.length > 0) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

interface ApiError {
  code: string;
  message: string;
  status: number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${url}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } } | null)?.error;
    const apiError: ApiError = {
      code: error?.code ?? 'HTTP_ERROR',
      message: error?.message ?? `请求失败（HTTP ${response.status}）`,
      status: response.status,
    };
    throw apiError;
  }
  return payload as T;
}

export async function listTree(sessionId: string | null, dir: string): Promise<TreeEntry[]> {
  const data = await request<{ entries: TreeEntry[] }>(`/tree${qs(sessionId, { dir })}`);
  return data.entries ?? [];
}

export async function readFile(sessionId: string | null, path: string): Promise<FileMeta> {
  const data = await request<{ file: FileMeta }>(`/file${qs(sessionId, { path })}`);
  return data.file;
}

export async function statFile(sessionId: string | null, path: string): Promise<{ sha1: string; size: number; mtimeMs: number }> {
  const data = await request<{ stat: { sha1: string; size: number; mtimeMs: number } }>(`/stat${qs(sessionId, { path })}`);
  return data.stat;
}

/** S2 预览元数据：文本 / 图片 / 分页文档（Office、PDF） */
export async function getPreview(
  sessionId: string | null,
  path: string,
  signal?: AbortSignal,
): Promise<PreviewInfo> {
  const data = await request<{ preview: PreviewInfo }>(`/preview${qs(sessionId, { path })}`, { signal });
  return data.preview;
}

/** xlsx 单表数据（DOM 表格渲染，文字原生可选）；full=true 走二次确认的「加载全部」 */
export async function getSheet(
  sessionId: string | null,
  path: string,
  sheet: number,
  signal?: AbortSignal,
  full = false,
): Promise<SheetData> {
  const query = qs(sessionId, { path, sheet: String(sheet), ...(full ? { full: '1' } : {}) });
  const data = await request<{ sheet: SheetData }>(`/sheet${query}`, {
    signal,
  });
  return data.sheet;
}

/** 分页文档第 page 页的 PNG 地址（key 是 Host 侧 sha256，用来固定版本） */
export function renderUrl(
  sessionId: string | null,
  path: string,
  key: string | undefined,
  page: number,
): string {
  return `${BASE}/render${qs(sessionId, { path, key, page: String(page) })}`;
}

/** 图片原文件地址（v 用文件指纹做缓存穿透） */
export function rawUrl(sessionId: string | null, path: string, v?: string): string {
  return `${BASE}/raw${qs(sessionId, { path, v })}`;
}

/** 分页文档某一页的文字层（透明覆盖在页图上，用于拖选文字） */
export async function getTextLayer(
  sessionId: string | null,
  path: string,
  page: number,
  signal?: AbortSignal,
): Promise<TextLayerInfo> {
  const data = await request<{ textLayer: TextLayerInfo }>(
    `/textlayer${qs(sessionId, { path, page: String(page) })}`,
    { signal },
  );
  return data.textLayer;
}

export async function saveFile(input: {
  sessionId: string | null;
  path: string;
  content: string;
  baseSha1: string | null;
}): Promise<SavedFile> {
  const data = await request<{ file: SavedFile }>('/file', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return data.file;
}

export async function exportAnnotations(input: {
  sessionId: string | null;
  path: string;
  content: string;
}): Promise<string> {
  const data = await request<{ export: { path: string } }>('/export', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.export.path;
}

export interface SendResult {
  ok: boolean;
  delivered?: string;
  requestId?: string;
}

/**
 * 把批注消息发进当前会话。
 * 浏览器侧拿不到会话态（shell.overlay 是 root scope），所以统一交给 Host 半：
 * Host 用官方 sessionController.prompt 以 queue 模式写入会话。
 */
export async function sendAnnotations(input: { sessionId: string; markdown: string }): Promise<SendResult> {
  return request<SendResult>('/send', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function isApiError(error: unknown): error is ApiError {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** Host 半 HTTP API 客户端（同源 fetch） */
import type { Annotation } from './message.js';
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
    frozen?: {
        rows: number;
        cols: number;
    };
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
interface ApiError {
    code: string;
    message: string;
    status: number;
}
export declare function listTree(sessionId: string | null, dir: string): Promise<TreeEntry[]>;
export declare function readFile(sessionId: string | null, path: string): Promise<FileMeta>;
export declare function statFile(sessionId: string | null, path: string): Promise<{
    sha1: string;
    size: number;
    mtimeMs: number;
}>;
/** S2 预览元数据：文本 / 图片 / 分页文档（Office、PDF） */
export declare function getPreview(sessionId: string | null, path: string, signal?: AbortSignal): Promise<PreviewInfo>;
/** xlsx 单表数据（DOM 表格渲染，文字原生可选）；full=true 走二次确认的「加载全部」 */
export declare function getSheet(sessionId: string | null, path: string, sheet: number, signal?: AbortSignal, full?: boolean): Promise<SheetData>;
/** 分页文档第 page 页的 PNG 地址（key 是 Host 侧 sha256，用来固定版本） */
export declare function renderUrl(sessionId: string | null, path: string, key: string | undefined, page: number): string;
/** 图片原文件地址（v 用文件指纹做缓存穿透） */
export declare function rawUrl(sessionId: string | null, path: string, v?: string): string;
/** 分页文档某一页的文字层（透明覆盖在页图上，用于拖选文字） */
export declare function getTextLayer(sessionId: string | null, path: string, page: number, signal?: AbortSignal): Promise<TextLayerInfo>;
export declare function saveFile(input: {
    sessionId: string | null;
    path: string;
    content: string;
    baseSha1: string | null;
}): Promise<SavedFile>;
export declare function exportAnnotations(input: {
    sessionId: string | null;
    path: string;
    content: string;
}): Promise<string>;
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
export declare function sendAnnotations(input: {
    sessionId: string;
    markdown: string;
}): Promise<SendResult>;
export interface AnnotationStore {
    path: string;
    annotations: Annotation[];
    deleted: string[];
    updatedAt: number;
}
/** S3 批注持久化：取某个文件已存的批注（无记录时返回空数组） */
export declare function loadAnnotations(sessionId: string | null, path: string): Promise<AnnotationStore>;
/**
 * 保存某文件的批注。deleted 是删除墓碑：多标签/并发下由 Host 合并，
 * 避免另一个标签把已删批注又带回来。
 */
export declare function saveAnnotations(input: {
    sessionId: string | null;
    path: string;
    annotations: Annotation[];
    deleted: string[];
}): Promise<AnnotationStore>;
export declare function isApiError(error: unknown): error is ApiError;
export declare function formatBytes(bytes: number): string;
export {};

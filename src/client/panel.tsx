import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX, MouseEvent as ReactMouseEvent } from 'react';
import {
  exportAnnotations,
  formatBytes,
  getPreview,
  getSheet,
  getTextLayer,
  isApiError,
  listTree,
  loadAnnotations,
  rawUrl,
  readFile,
  renderUrl,
  saveAnnotations,
  saveFile,
  sendAnnotations,
  statFile,
  type FileMeta,
  type PreviewInfo,
  type PreviewPage,
  type SheetCell,
  type SheetData,
  type SheetRow,
  type TextBlock,
  type TextLayerInfo,
  type TreeEntry,
} from './api.js';
import { PANEL_CSS } from './css.js';
import {
  buildAnnotationMessage,
  formatRelativeTime,
  trimQuote,
  type Annotation,
  type AnnotationBlock,
} from './message.js';
import { closePanel, useReviewSnapshot } from './store.js';

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DirState {
  expanded: boolean;
  loaded: boolean;
  loading: boolean;
  entries: TreeEntry[];
}

interface ComposerState {
  x: number;
  y: number;
  from: number;
  to: number;
  quote: string;
  block?: AnnotationBlock;
  /** 分页文档文字层批注：1-based 页码 */
  page?: number;
  /** 页标签（卡片展示用） */
  pageLabel?: string;
}

const GEOM_KEY = 'dsh-file-review:geometry';
const MIN_W = 720;
const MIN_H = 420;
const POLL_MS = 4000;
const SHEET_ROW_HEIGHT = 26;
// thead th 高 24px（含 1px 底边），与 css.ts 的 `.dsh-fr-sheet thead th` 对齐
const SHEET_HEADER_HEIGHT = 24;
const SHEET_VIEWPORT_ROWS = 80;
const SHEET_OVERSCAN = 20;
const SHEET_VIRTUAL_THRESHOLD = 160;
/** 多文件标签上限（与 Design 交互稿一致） */
const MAX_TABS = 8;

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError';
}

/** 错误统一存成 `CODE|message`，UI 按 code 给一句人话，details 里再放原文 */
function formatUiError(error: unknown): string {
  if (isApiError(error)) return `${error.code}|${error.message}`;
  return `HTTP_ERROR|${error instanceof Error ? error.message : String(error)}`;
}

function splitUiError(value: string | null): { code: string; message: string; title: string; hint: string } {
  const [rawCode, ...rest] = (value ?? '').split('|');
  const code = rawCode || 'HTTP_ERROR';
  const message = rest.join('|') || value || '';
  const titleMap: Record<string, string> = {
    ERR_ENCRYPTED_FILE: '文件受密码保护',
    ENCRYPTED: '文件受密码保护',
    ERR_TOO_LARGE: '文件太大，无法预览',
    TOO_LARGE_PREVIEW: '文件太大，无法预览',
    ERR_CONVERT_TIMEOUT: '转换超时',
    RENDER_TIMEOUT: '转换超时',
    TIMEOUT: '转换超时',
    NO_RENDERER: '当前环境缺少 Office 转换组件',
    NO_TEXT_LAYER: '文字层暂不可用',
    CONVERT_FAILED: 'Office 文档转换失败',
    UNSAFE_XML: '文件结构不安全，已拒绝解析',
    BAD_XML_ENTITY: '文件结构不合法，已拒绝解析',
    RENDER_FAILED: '页面渲染失败',
    NO_PAGE: '这一页不存在',
    NOT_SHEET: '不是可解析的表格',
    NO_SHEET: '没有这个工作表',
  };
  const hintMap: Record<string, string> = {
    ERR_ENCRYPTED_FILE: '请先用 Office / PDF 工具解除密码，再回来预览。',
    ENCRYPTED: '请先用 Office / PDF 工具解除密码，再回来预览。',
    ERR_TOO_LARGE: '超过 30MB 的文件不预览，避免页面卡死；可以换小一点的文件。',
    TOO_LARGE_PREVIEW: '超过 30MB 的文件不预览，避免页面卡死；可以换小一点的文件。',
    ERR_CONVERT_TIMEOUT: '转换时间过长，已停止；可以点重试，或换一个文件。',
    RENDER_TIMEOUT: '转换时间过长，已停止；可以点重试，或换一个文件。',
    TIMEOUT: '转换时间过长，已停止；可以点重试，或换一个文件。',
    NO_RENDERER: '宿主里没有找到 LibreOffice Kit，请把环境信息发给维护者。',
    NO_TEXT_LAYER: '文字层组件加载失败；预览和整页批注仍可用，可以点重试。',
    CONVERT_FAILED: '文件可能已损坏，或格式不受支持；可以点重试。',
    UNSAFE_XML: '文件里有外部实体/DOCTYPE，出于安全考虑不解析。',
    BAD_XML_ENTITY: '文件里有超出 Unicode 范围的字符实体；可能不是真正的 Office 文件。',
  };
  return {
    code,
    message,
    title: titleMap[code] ?? '预览失败',
    hint: hintMap[code] ?? '文件可能已损坏、受密码保护，或格式暂不支持。可以重试，或换一个文件。',
  };
}

function loadGeometry(): Geometry {
  const fallback = (): Geometry => {
    const w = Math.min(1240, Math.max(MIN_W, window.innerWidth - 96));
    const h = Math.min(780, Math.max(MIN_H, window.innerHeight - 96));
    return { x: Math.max(24, Math.round((window.innerWidth - w) / 2)), y: Math.max(24, Math.round((window.innerHeight - h) / 2)), w, h };
  };
  try {
    const raw = localStorage.getItem(GEOM_KEY);
    if (!raw) return fallback();
    const parsed = JSON.parse(raw) as Partial<Geometry>;
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number' || typeof parsed.w !== 'number' || typeof parsed.h !== 'number') {
      return fallback();
    }
    return {
      x: parsed.x,
      y: parsed.y,
      w: Math.max(MIN_W, parsed.w),
      h: Math.max(MIN_H, parsed.h),
    };
  } catch {
    return fallback();
  }
}

/** 给预览区的每一行加上 md 风格 class（文本原样保留，便于行号锚点与批注定位） */
function decorateLines(content: string): Array<{ text: string; cls: string }> {
  const lines = content.split('\n');
  const result: Array<{ text: string; cls: string }> = [];
  let inFence = false;
  for (const text of lines) {
    const trimmed = text.trim();
    let cls = '';
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence;
      cls = ' dsh-fr-code';
    } else if (inFence) {
      cls = ' dsh-fr-code';
    } else if (/^#{1}\s/.test(trimmed)) {
      cls = ' dsh-fr-h1';
    } else if (/^#{2}\s/.test(trimmed)) {
      cls = ' dsh-fr-h2';
    } else if (/^#{3,6}\s/.test(trimmed)) {
      cls = ' dsh-fr-h3';
    }
    result.push({ text, cls });
  }
  return result;
}

function lineNumberOf(node: Node | null): number | null {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const line = element?.closest('[data-line]');
  if (!line) return null;
  const value = Number(line.getAttribute('data-line'));
  return Number.isFinite(value) ? value : null;
}

function elementOf(node: Node | null): Element | null {
  if (!node) return null;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function columnLabel(index: number): string {
  let value = index;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

/** 卡片 footer 只放类型短标签：首行已显示具体 label，footer 再拼一遍会重复且挤按钮 */
function annotationKindLabel(annotation: Annotation): string {
  if (annotation.block) {
    if (annotation.block.label === '图片') return '整图';
    if (annotation.block.label.startsWith('第')) return '整页';
    return '区域';
  }
  if (annotation.page !== undefined) return `第${annotation.page}页 · 选中文字`;
  return `L${annotation.from}${annotation.from === annotation.to ? '' : `-${annotation.to}`}`;
}

function parseCellRef(ref: string): { row: number; col: number } | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
  if (!match) return null;
  let col = 0;
  for (const letter of (match[1] ?? '').toUpperCase()) col = col * 26 + (letter.charCodeAt(0) - 64);
  const row = Number.parseInt(match[2] ?? '', 10);
  return Number.isInteger(col) && Number.isInteger(row) && col > 0 && row > 0 ? { row, col } : null;
}

function useInjectedStyle(): void {
  useEffect(() => {
    const id = 'dsh-file-review-style';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.dataset.dshPlugin = 'dsh-file-review';
    style.textContent = PANEL_CSS;
    document.head.appendChild(style);
  }, []);
}

export function FileReviewPanel(): JSX.Element | null {
  useInjectedStyle();
  const snapshot = useReviewSnapshot();
  const sessionId = snapshot.sessionId;

  const [geometry, setGeometry] = useState<Geometry>(() => loadGeometry());
  const [rootEntries, setRootEntries] = useState<TreeEntry[]>([]);
  const [rootLoading, setRootLoading] = useState(false);
  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  const [activePath, setActivePath] = useState<string | null>(null);
  const [file, setFile] = useState<FileMeta | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [composerText, setComposerText] = useState('');
  const [sendOpen, setSendOpen] = useState(false);
  const [sendIncludePath, setSendIncludePath] = useState(true);
  const [sendIncludeQuote, setSendIncludeQuote] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [banner, setBanner] = useState<'external' | 'conflict' | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewCancelled, setPreviewCancelled] = useState(false);
  const [pageIndex, setPageIndex] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [textLayer, setTextLayer] = useState<TextLayerInfo | null>(null);
  const [textLayerLoading, setTextLayerLoading] = useState(false);
  const [textLayerError, setTextLayerError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [sheetCancelled, setSheetCancelled] = useState(false);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [sheetSel, setSheetSel] = useState<{
    anchorRow: number;
    anchorCol: number;
    focusRow: number;
    focusCol: number;
  } | null>(null);
  const [sheetWindow, setSheetWindow] = useState({ start: 0, end: SHEET_VIEWPORT_ROWS });
  const [sheetFull, setSheetFull] = useState(false);
  const [fullConfirmOpen, setFullConfirmOpen] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [annotationSaveState, setAnnotationSaveState] = useState<'idle' | 'saved' | 'error'>('idle');

  const rootRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const sheetScrollRef = useRef<HTMLDivElement | null>(null);
  const previewAbort = useRef<AbortController | null>(null);
  const textLayerAbort = useRef<AbortController | null>(null);
  const sheetAbort = useRef<AbortController | null>(null);
  const toastTimer = useRef<number | null>(null);
  const previewToken = useRef(0);
  const textLayerToken = useRef(0);
  const textLayerCache = useRef(new Map<string, TextLayerInfo>());
  const sheetToken = useRef(0);
  const sheetCache = useRef(new Map<string, SheetData>());
  const sheetDragging = useRef(false);
  const annotationsRef = useRef<Annotation[]>([]);
  /** 删除墓碑：多标签/并发保存时由 Host 合并，避免已删批注被别的标签带回来 */
  const deletedByPath = useRef(new Map<string, Set<string>>());
  /** 每个文件最后一次成功保存的 updatedAt（调试/排查用，Host 以合并为准） */
  const annotationUpdatedAt = useRef(new Map<string, number>());
  /** 每个标签的未保存草稿，切换标签不丢 */
  const tabDrafts = useRef(new Map<string, { draft: string; dirty: boolean; mode: 'preview' | 'edit' }>());

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  /** 把当前文件批注写进工作区 `.dsh-file-review/`；Host 负责合并与上限 */
  const persistAnnotations = useCallback(
    async (path: string) => {
      if (!sessionId || !path) return;
      const list = annotationsRef.current.filter((annotation) => annotation.path === path);
      const deleted = [...(deletedByPath.current.get(path) ?? [])];
      try {
        const saved = await saveAnnotations({ sessionId, path, annotations: list, deleted });
        annotationUpdatedAt.current.set(path, saved.updatedAt);
        if (deleted.length > 0) deletedByPath.current.set(path, new Set());
        setAnnotationSaveState('saved');
      } catch {
        setAnnotationSaveState('error');
      }
    },
    [sessionId],
  );

  useEffect(() => {
    if (!snapshot.open || !file) return;
    const path = file.path;
    const timer = window.setTimeout(() => void persistAnnotations(path), 350);
    return () => window.clearTimeout(timer);
  }, [annotations, file?.path, snapshot.open, persistAnnotations]);

  useEffect(() => {
    try {
      localStorage.setItem(GEOM_KEY, JSON.stringify(geometry));
    } catch {
      /* 忽略存储失败 */
    }
  }, [geometry]);

  const refreshRoot = useCallback(async () => {
    if (!snapshot.open) return;
    setRootLoading(true);
    try {
      const entries = await listTree(sessionId, '');
      setRootEntries(entries);
    } catch (error) {
      showToast(`读取目录失败：${isApiError(error) ? error.message : String(error)}`);
    } finally {
      setRootLoading(false);
    }
  }, [sessionId, snapshot.open, showToast]);

  useEffect(() => {
    if (!snapshot.open) return;
    void refreshRoot();
  }, [snapshot.open, refreshRoot]);

  const loadDirs = useCallback(
    async (dir: string) => {
      setDirs((previous) => ({
        ...previous,
        [dir]: previous[dir] ?? { expanded: false, loaded: false, loading: false, entries: [] },
      }));
      const state = dirs[dir];
      if (state?.loaded || state?.loading) return;
      setDirs((previous) => ({
        ...previous,
        [dir]: { ...(previous[dir] ?? { expanded: true, loaded: false, loading: false, entries: [] }), loading: true },
      }));
      try {
        const entries = await listTree(sessionId, dir);
        setDirs((previous) => ({
          ...previous,
          [dir]: { ...(previous[dir] ?? { expanded: true, loaded: false, loading: false, entries: [] }), loaded: true, loading: false, entries },
        }));
      } catch (error) {
        showToast(`读取目录失败：${isApiError(error) ? error.message : String(error)}`);
        setDirs((previous) => ({
          ...previous,
          [dir]: { ...(previous[dir] ?? { expanded: true, loaded: false, loading: false, entries: [] }), loading: false },
        }));
      }
    },
    [dirs, sessionId, showToast],
  );

  const toggleDir = useCallback(
    (dir: string) => {
      const state = dirs[dir];
      if (state?.expanded) {
        setDirs((previous) => ({ ...previous, [dir]: { ...(previous[dir] as DirState), expanded: false } }));
        return;
      }
      setDirs((previous) => ({
        ...previous,
        [dir]: { ...(previous[dir] ?? { loaded: false, loading: false, entries: [] }), expanded: true },
      }));
      if (!state?.loaded) void loadDirs(dir);
    },
    [dirs, loadDirs],
  );

  const loadPreview = useCallback(
    async (meta: FileMeta) => {
      const token = ++previewToken.current;
      previewAbort.current?.abort();
      const controller = new AbortController();
      previewAbort.current = controller;
      setPreview(null);
      setPreviewError(null);
      setPreviewCancelled(false);
      setTextLayer(null);
      setTextLayerError(null);
      setSheet(null);
      setSheetError(null);
      setSheetFull(false);
      setFullConfirmOpen(false);
      setSheetIndex(0);
      setSheetWindow({ start: 0, end: SHEET_VIEWPORT_ROWS });
      setPageIndex(1);
      setZoom(1);
      if (meta.previewKind === 'text') {
        setPreviewLoading(false);
        return;
      }
      if (meta.previewKind === 'unsupported') {
        setPreviewLoading(false);
        setPreviewError('UNSUPPORTED_PREVIEW|该格式暂不支持预览（支持 docx / xlsx / pptx / pdf / 图片）');
        return;
      }
      setPreviewLoading(true);
      try {
        const info = await getPreview(sessionId, meta.path, controller.signal);
        if (token !== previewToken.current) return;
        setPreview(info);
        setPageIndex(info.pages?.[0]?.index ?? 1);
        if (info.kind === 'sheet') setSheetIndex(info.active ?? 0);
      } catch (error) {
        if (token !== previewToken.current || isAbortError(error)) return;
        setPreviewError(formatUiError(error));
      } finally {
        if (token === previewToken.current) setPreviewLoading(false);
      }
    },
    [sessionId],
  );

  const loadTextLayer = useCallback(
    async (meta: FileMeta, page: PreviewPage) => {
      const token = ++textLayerToken.current;
      textLayerAbort.current?.abort();
      const controller = new AbortController();
      textLayerAbort.current = controller;
      const cacheKey = `${meta.path}:${meta.sha1}:${page.index}`;
      const cached = textLayerCache.current.get(cacheKey);
      if (cached) {
        setTextLayer(cached);
        setTextLayerError(null);
        setTextLayerLoading(false);
        return;
      }
      setTextLayer(null);
      setTextLayerError(null);
      setTextLayerLoading(true);
      try {
        const layer = await getTextLayer(sessionId, meta.path, page.index, controller.signal);
        if (token !== textLayerToken.current) return;
        textLayerCache.current.set(cacheKey, layer);
        if (textLayerCache.current.size > 16) {
          const oldest = textLayerCache.current.keys().next().value;
          if (typeof oldest === 'string') textLayerCache.current.delete(oldest);
        }
        setTextLayer(layer);
      } catch (error) {
        if (token !== textLayerToken.current || isAbortError(error)) return;
        setTextLayerError(formatUiError(error));
      } finally {
        if (token === textLayerToken.current) setTextLayerLoading(false);
      }
    },
    [sessionId],
  );

  const loadSheet = useCallback(
    async (meta: FileMeta, index: number, full = false) => {
      const token = ++sheetToken.current;
      sheetAbort.current?.abort();
      const controller = new AbortController();
      sheetAbort.current = controller;
      const cacheKey = `${meta.path}:${meta.sha1}:${index}${full ? ':full' : ''}`;
      const cached = sheetCache.current.get(cacheKey);
      if (cached) {
        setSheet(cached);
        setSheetError(null);
        setSheetCancelled(false);
        setSheetLoading(false);
        setSheetFull(full);
        setFullConfirmOpen(false);
        setSheetWindow({ start: 0, end: SHEET_VIEWPORT_ROWS });
        return;
      }
      setSheet(null);
      setSheetError(null);
      setSheetCancelled(false);
      setSheetLoading(true);
      setSheetFull(full);
      setFullConfirmOpen(false);
      setSheetWindow({ start: 0, end: SHEET_VIEWPORT_ROWS });
      let timer: number | undefined;
      const timeoutSeconds = full ? 60 : 20;
      try {
        const data = await Promise.race([
          getSheet(sessionId, meta.path, index, controller.signal, full),
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(
              () => reject(new Error(`SHEET_TIMEOUT:${timeoutSeconds}`)),
              timeoutSeconds * 1000,
            );
          }),
        ]);
        if (token !== sheetToken.current) return;
        sheetCache.current.set(cacheKey, data);
        if (sheetCache.current.size > 8) {
          const oldest = sheetCache.current.keys().next().value;
          if (typeof oldest === 'string') sheetCache.current.delete(oldest);
        }
        setSheet(data);
      } catch (error) {
        if (token !== sheetToken.current || isAbortError(error)) return;
        if (error instanceof Error && error.message.startsWith('SHEET_TIMEOUT:')) {
          controller.abort();
          const seconds = error.message.split(':')[1] ?? String(timeoutSeconds);
          setSheetError(`ERR_CONVERT_TIMEOUT|表格解析超过 ${seconds} 秒，请重试`);
        } else {
          setSheetError(formatUiError(error));
        }
      } finally {
        if (timer !== undefined) window.clearTimeout(timer);
        if (token === sheetToken.current) setSheetLoading(false);
      }
    },
    [sessionId],
  );

  const loadFile = useCallback(
    async (relativePath: string) => {
      setFileLoading(true);
      setComposer(null);
      setSendOpen(false);
      try {
        const next = await readFile(sessionId, relativePath);
        // 批注持久化：先取该文件已存的批注，再和本地未保存的按 id 合并。
        const stored = await loadAnnotations(sessionId, next.path).catch(() => null);
        if (stored) annotationUpdatedAt.current.set(next.path, stored.updatedAt);
        setFile(next);
        const savedDraft = tabDrafts.current.get(next.path);
        setDraft(savedDraft?.dirty ? savedDraft.draft : next.content);
        setDirty(Boolean(savedDraft?.dirty));
        setMode(savedDraft?.mode ?? 'preview');
        setBanner(null);
        setVersions((previous) => ({ ...previous, [next.path]: previous[next.path] ?? 1 }));
        void loadPreview(next);
        setAnnotations((previous) => {
          const merged = new Map<string, Annotation>();
          for (const annotation of stored?.annotations ?? []) merged.set(annotation.id, annotation);
          for (const annotation of previous.filter((item) => item.path === next.path)) {
            merged.set(annotation.id, annotation);
          }
          for (const id of deletedByPath.current.get(next.path) ?? []) merged.delete(id);
          const others = previous.filter((item) => item.path !== next.path);
          const current = [...merged.values()].map((annotation) =>
            annotation.fileSha1 && annotation.fileSha1 !== next.sha1 && annotation.status === 'open'
              ? { ...annotation, status: 'stale' as const }
              : annotation,
          );
          return [...others, ...current];
        });
      } catch (error) {
        setFile(null);
        showToast(`打开文件失败：${isApiError(error) ? error.message : String(error)}`);
      } finally {
        setFileLoading(false);
      }
    },
    [loadPreview, sessionId, showToast],
  );

  useEffect(() => {
    if (!snapshot.open || !activePath) return;
    if (file?.path === activePath) return;
    void loadFile(activePath);
  }, [activePath, snapshot.open, file?.path, loadFile]);

  useEffect(() => {
    if (snapshot.open) return;
    previewAbort.current?.abort();
    textLayerAbort.current?.abort();
    sheetAbort.current?.abort();
    textLayerCache.current.clear();
    sheetCache.current.clear();
  }, [snapshot.open]);

  useEffect(
    () => () => {
      previewAbort.current?.abort();
      textLayerAbort.current?.abort();
      sheetAbort.current?.abort();
    },
    [],
  );

  // 外部变更轮询
  useEffect(() => {
    if (!snapshot.open || !file) return;
    const timer = window.setInterval(async () => {
      try {
        const stat = await statFile(sessionId, file.path);
        if (stat.sha1 !== file.sha1) {
          setBanner(dirty ? 'conflict' : 'external');
        } else {
          setBanner(null);
        }
      } catch {
        /* 轮询失败静默 */
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [snapshot.open, file, dirty, sessionId]);

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm('有未保存的修改，关闭后丢失，确定关闭？')) return;
    if (file) void persistAnnotations(file.path);
    setComposer(null);
    setSendOpen(false);
    closePanel();
  }, [dirty, file, persistAnnotations]);

  const refreshCurrent = useCallback(async () => {
    if (!file) return;
    if (dirty && !window.confirm('有未保存的修改，刷新会丢失，继续？')) return;
    const next = await readFile(sessionId, file.path).catch((error: unknown) => {
      showToast(`刷新失败：${isApiError(error) ? error.message : String(error)}`);
      return null;
    });
    if (!next) return;
    setFile(next);
    setDraft(next.content);
    setDirty(false);
    tabDrafts.current.delete(next.path);
    setBanner(null);
    void loadPreview(next);
    setAnnotations((previous) =>
      previous.map((annotation) => (annotation.path === next.path && annotation.status === 'open' ? { ...annotation, status: 'open' } : annotation)),
    );
    showToast('已刷新到最新版本');
  }, [dirty, file, loadPreview, sessionId, showToast]);

  /** 切换标签前把当前草稿收进 map，回来时还原，切标签不丢未保存修改 */
  const stashActiveTab = useCallback(() => {
    if (!file) return;
    if (dirty || mode === 'edit') tabDrafts.current.set(file.path, { draft, dirty, mode });
    else tabDrafts.current.delete(file.path);
  }, [draft, dirty, file, mode]);

  const openTab = useCallback(
    (relativePath: string) => {
      if (relativePath === activePath) return;
      if (!tabs.includes(relativePath) && tabs.length >= MAX_TABS) {
        showToast(`最多同时打开 ${MAX_TABS} 个文件`);
        return;
      }
      stashActiveTab();
      if (file) void persistAnnotations(file.path);
      setTabs((previous) => (previous.includes(relativePath) ? previous : [...previous, relativePath]));
      setActivePath(relativePath);
    },
    [activePath, file, persistAnnotations, showToast, stashActiveTab, tabs],
  );

  const closeTab = useCallback(
    (relativePath: string) => {
      if (relativePath === file?.path && dirty && !window.confirm('这个标签有未保存的修改，关闭后丢失，确定关闭？')) return;
      if (relativePath === file?.path) void persistAnnotations(relativePath);
      tabDrafts.current.delete(relativePath);
      const nextTabs = tabs.filter((item) => item !== relativePath);
      setTabs(nextTabs);
      if (relativePath !== activePath) return;
      const next = nextTabs[nextTabs.length - 1] ?? null;
      setActivePath(next);
      if (!next) {
        setFile(null);
        setPreview(null);
        setPreviewError(null);
        setComposer(null);
        setSendOpen(false);
        setBanner(null);
      }
    },
    [activePath, dirty, file?.path, persistAnnotations, tabs],
  );

  const activeAnnotations = useMemo(
    () => (file ? annotations.filter((annotation) => annotation.path === file.path) : []),
    [annotations, file],
  );
  const openAnnotations = useMemo(
    () => activeAnnotations.filter((annotation) => annotation.status === 'open'),
    [activeAnnotations],
  );
  const markedLines = useMemo(() => {
    const lines = new Set<number>();
    for (const annotation of openAnnotations) {
      if (annotation.block || annotation.page !== undefined) continue;
      for (let line = annotation.from; line <= annotation.to; line += 1) lines.add(line);
    }
    return lines;
  }, [openAnnotations]);
  const decorated = useMemo(() => (file ? decorateLines(file.content) : []), [file]);
  const version = file ? versions[file.path] ?? 1 : 1;
  const previewPages = preview?.pages ?? [];
  const currentPage = previewPages.find((page) => page.index === pageIndex) ?? previewPages[0];
  const pagePosition = Math.max(0, previewPages.findIndex((page) => page.index === (currentPage?.index ?? 0)));
  const blockTarget = useMemo<AnnotationBlock | null>(() => {
    if (preview?.kind === 'image') return { page: 1, label: '图片' };
    if (preview?.kind === 'sheet') {
      const name = sheet?.name ?? preview.sheets?.find((item) => item.index === sheetIndex)?.name ?? '表格';
      return { page: sheetIndex + 1, label: `工作表「${name}」`, sheet: name };
    }
    if (!currentPage) return null;
    return {
      page: currentPage.index,
      label: currentPage.label,
      ...(currentPage.sheet ? { sheet: currentPage.sheet } : {}),
      ...(currentPage.range ? { range: currentPage.range } : {}),
    };
  }, [currentPage, preview?.kind, preview?.sheets, sheet, sheetIndex]);

  const sheetCellMap = useMemo(() => {
    const map = new Map<string, SheetCell>();
    for (const cell of sheet?.cells ?? []) map.set(`${cell.row}:${cell.col}`, cell);
    return map;
  }, [sheet]);

  const sheetMerges = useMemo(() => {
    const spans = new Map<string, { rowSpan: number; colSpan: number }>();
    const covered = new Set<string>();
    for (const ref of sheet?.merges ?? []) {
      const [startRef, endRef] = ref.split(':');
      const start = parseCellRef(startRef ?? '');
      const end = parseCellRef(endRef ?? startRef ?? '');
      if (!start || !end || end.row < start.row || end.col < start.col) continue;
      spans.set(`${start.row}:${start.col}`, {
        rowSpan: end.row - start.row + 1,
        colSpan: end.col - start.col + 1,
      });
      for (let row = start.row; row <= end.row; row += 1) {
        for (let col = start.col; col <= end.col; col += 1) {
          if (row !== start.row || col !== start.col) covered.add(`${row}:${col}`);
        }
      }
    }
    return { spans, covered };
  }, [sheet]);

  const sheetSelection = useMemo(() => {
    if (preview?.kind !== 'sheet') return null;
    if (sheetSel) {
      return {
        fromRow: Math.min(sheetSel.anchorRow, sheetSel.focusRow),
        toRow: Math.max(sheetSel.anchorRow, sheetSel.focusRow),
        fromCol: Math.min(sheetSel.anchorCol, sheetSel.focusCol),
        toCol: Math.max(sheetSel.anchorCol, sheetSel.focusCol),
      };
    }
    if (!composer?.block?.range || composer.block.sheet !== sheet?.name) return null;
    const [startRefRaw, endRefRaw] = composer.block.range.split(':');
    const start = parseCellRef(startRefRaw ?? '');
    const end = parseCellRef(endRefRaw ?? startRefRaw ?? '');
    if (!start || !end) return null;
    return {
      fromRow: Math.min(start.row, end.row),
      toRow: Math.max(start.row, end.row),
      fromCol: Math.min(start.col, end.col),
      toCol: Math.max(start.col, end.col),
    };
  }, [composer, preview?.kind, sheet?.name, sheetSel]);

  const sheetColumnWidths = useMemo(
    () => Array.from({ length: sheet?.colCount ?? 0 }, (_, index) => sheet?.columns[index] ?? 96),
    [sheet],
  );
  const sheetTableWidth = useMemo(
    () => 44 + sheetColumnWidths.reduce((sum, width) => sum + width, 0),
    [sheetColumnWidths],
  );
  const sheetFrozenRows = Math.min(sheet?.frozen?.rows ?? 0, sheet?.rowCount ?? 0);
  const sheetFrozenCols = Math.min(sheet?.frozen?.cols ?? 0, sheet?.colCount ?? 0);
  const sheetVirtual = (sheet?.rowCount ?? 0) > SHEET_VIRTUAL_THRESHOLD;
  const sheetFrozenRowsData = useMemo(
    () => (sheet ? sheet.rows.slice(0, sheetFrozenRows) : []),
    [sheet, sheetFrozenRows],
  );
  // 行高前缀和：虚拟滚动按真实行高定位，自定义行高时也不脱位
  const sheetRowOffsets = useMemo(() => {
    const rowCount = sheet?.rowCount ?? 0;
    const offsets = new Array<number>(rowCount + 1);
    offsets[0] = 0;
    for (let index = 0; index < rowCount; index += 1) {
      offsets[index + 1] = (offsets[index] ?? 0) + (sheet?.rows[index]?.height ?? SHEET_ROW_HEIGHT);
    }
    return offsets;
  }, [sheet]);
  const sheetTotalHeight = sheetRowOffsets[sheetRowOffsets.length - 1] ?? 0;
  const sheetWindowStart = Math.min(Math.max(sheetWindow.start, sheetFrozenRows), sheet?.rowCount ?? 0);
  const sheetWindowEnd = Math.min(
    Math.max(sheetWindow.end, sheetWindowStart + (sheetVirtual ? 1 : sheet?.rowCount ?? 0)),
    sheet?.rowCount ?? 0,
  );
  const sheetWindowRowsData = useMemo(() => {
    if (!sheet) return [];
    if (!sheetVirtual) return sheet.rows.slice(sheetFrozenRows);
    return sheet.rows.slice(sheetWindowStart, sheetWindowEnd);
  }, [sheet, sheetVirtual, sheetFrozenRows, sheetWindowStart, sheetWindowEnd]);
  const sheetTopSpacerHeight = sheetVirtual
    ? Math.max(0, (sheetRowOffsets[sheetWindowStart] ?? 0) - (sheetRowOffsets[sheetFrozenRows] ?? 0))
    : 0;
  const sheetBottomSpacerHeight = sheetVirtual
    ? Math.max(0, sheetTotalHeight - (sheetRowOffsets[sheetWindowEnd] ?? 0))
    : 0;
  const sheetFrozenLeft = useMemo(() => {
    const lefts = [44];
    for (const width of sheetColumnWidths) lefts.push((lefts[lefts.length - 1] ?? 44) + width);
    return lefts;
  }, [sheetColumnWidths]);
  const onSheetScroll = useCallback(() => {
    if (!sheet || !sheetVirtual) return;
    const element = sheetScrollRef.current;
    if (!element) return;
    const rowCount = sheet.rowCount;
    if (rowCount <= 0) return;
    // 二分找目标像素落在哪一行（用真实行高）
    const findRowAt = (target: number) => {
      let low = 0;
      let high = rowCount - 1;
      while (low < high) {
        const middle = (low + high) >> 1;
        if ((sheetRowOffsets[middle + 1] ?? 0) > target) high = middle;
        else low = middle + 1;
      }
      return low;
    };
    const viewportTop = Math.max(0, element.scrollTop - SHEET_HEADER_HEIGHT);
    const first = findRowAt(viewportTop);
    const last = findRowAt(viewportTop + element.clientHeight);
    const start = Math.max(0, first - SHEET_OVERSCAN);
    const end = Math.min(rowCount, last + 1 + SHEET_OVERSCAN);
    setSheetWindow((previous) =>
      previous.start === start && previous.end === end ? previous : { start, end },
    );
  }, [sheet, sheetVirtual, sheetRowOffsets]);
  const sheetSelectionLabel = useMemo(() => {
    if (!sheetSelection || !sheet || preview?.kind !== 'sheet') return null;
    const fromRef = `${columnLabel(sheetSelection.fromCol)}${sheetSelection.fromRow}`;
    const toRef = `${columnLabel(sheetSelection.toCol)}${sheetSelection.toRow}`;
    return `工作表「${sheet.name}」 ${fromRef === toRef ? fromRef : `${fromRef}:${toRef}`}`;
  }, [preview?.kind, sheet, sheetSelection]);

  // 错误卡统一走 splitUiError：一句人话 + 细节可折叠，标题/提示不再写死
  const previewUiError = useMemo(() => (previewError ? splitUiError(previewError) : null), [previewError]);
  const sheetUiError = useMemo(() => (sheetError ? splitUiError(sheetError) : null), [sheetError]);

  // 冻结行的 sticky top：用行高前缀和，和虚拟滚动的占位高度同一套数
  const sheetFrozenTops = useMemo(() => {
    const tops = new Map<number, number>();
    for (const row of sheetFrozenRowsData) {
      tops.set(row.index, SHEET_HEADER_HEIGHT + (sheetRowOffsets[row.index - 1] ?? 0));
    }
    return tops;
  }, [sheetFrozenRowsData, sheetRowOffsets]);

  /** 表格行渲染：冻结行/冻结列都走 sticky，角格同时固定 top+left */
  const renderSheetRow = (row: SheetRow, frozenRow: boolean): JSX.Element => {
    if (!sheet) return <></>;
    const selection = sheetSelection;
    const frozenTop = frozenRow ? sheetFrozenTops.get(row.index) ?? SHEET_HEADER_HEIGHT : null;
    const rowSelected =
      Boolean(selection) && row.index >= selection!.fromRow && row.index <= selection!.toRow;
    const frozenRowEdge = frozenRow && row.index === sheetFrozenRows;
    const stickyStyle = (col?: number): CSSProperties | undefined => {
      const frozenCell = col !== undefined && col <= sheetFrozenCols;
      if (!frozenRow && !frozenCell) return undefined;
      const style: CSSProperties = { position: 'sticky' };
      if (frozenTop !== null) style.top = `${frozenTop}px`;
      if (col !== undefined && frozenCell) style.left = `${sheetFrozenLeft[col - 1] ?? 44}px`;
      style.zIndex = frozenRow && frozenCell ? 6 : frozenRow ? 2 : 3;
      return style;
    };
    return (
      <tr key={row.index} style={row.height ? { height: `${row.height}px` } : undefined}>
        <th
          className={`dsh-fr-sheet-rowhead${rowSelected ? ' dsh-fr-sheet-head-active' : ''}${
            frozenRow ? ' dsh-fr-sheet-frozen-row' : ''
          }${frozenRowEdge ? ' dsh-fr-sheet-frozen-row-edge' : ''}`}
          style={{
            position: 'sticky',
            left: 0,
            ...(frozenTop !== null ? { top: `${frozenTop}px` } : {}),
            zIndex: frozenRow ? 7 : 1,
          }}
        >
          {row.index}
        </th>
        {Array.from({ length: sheet.colCount }, (_, index) => {
          const col = index + 1;
          const key = `${row.index}:${col}`;
          if (sheetMerges.covered.has(key)) return null;
          const cell = sheetCellMap.get(key);
          const span = sheetMerges.spans.get(key);
          const cellRef = cell?.ref ?? `${columnLabel(col)}${row.index}`;
          const cellPos = parseCellRef(cellRef);
          const selected =
            Boolean(selection) &&
            row.index >= selection!.fromRow &&
            row.index <= selection!.toRow &&
            col >= selection!.fromCol &&
            col <= selection!.toCol;
          const selectedStart =
            selected && row.index === selection!.fromRow && col === selection!.fromCol;
          const selectedEnd = selected && row.index === selection!.toRow && col === selection!.toCol;
          const frozenCell = col <= sheetFrozenCols;
          const cellClass = [
            cell?.kind === 'number' ? 'dsh-fr-sheet-num' : '',
            selected ? 'dsh-fr-sheet-selected' : '',
            selectedStart ? 'dsh-fr-sheet-selected-start' : '',
            selectedEnd ? 'dsh-fr-sheet-selected-end' : '',
            frozenCell ? 'dsh-fr-sheet-frozen' : '',
            frozenCell && col === sheetFrozenCols ? 'dsh-fr-sheet-frozen-edge' : '',
            frozenRow ? 'dsh-fr-sheet-frozen-row' : '',
            frozenRowEdge ? 'dsh-fr-sheet-frozen-row-edge' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <td
              key={col}
              data-cell={cellRef}
              className={cellClass || undefined}
              colSpan={span?.colSpan}
              rowSpan={span?.rowSpan}
              style={stickyStyle(col)}
              onMouseDown={(event) => {
                if (event.button !== 0 || !cellPos) return;
                sheetDragging.current = true;
                setSheetSel({
                  anchorRow: cellPos.row,
                  anchorCol: cellPos.col,
                  focusRow: cellPos.row,
                  focusCol: cellPos.col,
                });
              }}
              onMouseEnter={() => {
                if (!sheetDragging.current || !cellPos) return;
                setSheetSel((previous) =>
                  previous
                    ? {
                        ...previous,
                        focusRow: cellPos.row,
                        focusCol: cellPos.col,
                      }
                    : previous,
                );
              }}
            >
              {cell?.text ?? ''}
            </td>
          );
        })}
      </tr>
    );
  };

  // 页图与文字层共用同一页坐标系：翻页/换文件/缩放后懒加载当前页文字
  useEffect(() => {
    if (!file || preview?.kind !== 'pages' || !currentPage) {
      setTextLayer(null);
      setTextLayerError(null);
      setTextLayerLoading(false);
      return;
    }
    void loadTextLayer(file, currentPage);
  }, [currentPage?.index, file?.path, file?.sha1, loadTextLayer, preview?.kind]);

  // xlsx：按当前 sheet 懒加载 DOM 表格数据
  useEffect(() => {
    setSheetSel(null);
    sheetDragging.current = false;
    if (!file || preview?.kind !== 'sheet') {
      setSheet(null);
      setSheetError(null);
      setSheetLoading(false);
      return;
    }
    void loadSheet(file, sheetIndex);
  }, [file?.path, file?.sha1, loadSheet, preview?.kind, sheetIndex]);

  // 页图适应预览区宽度（用户仍可用工具栏缩放）
  useEffect(() => {
    if (preview?.kind !== 'pages' || !currentPage) return;
    const width = contentRef.current?.clientWidth ?? 0;
    if (width <= 0) return;
    const fit = Math.round(((width - 48) / currentPage.width) * 100) / 100;
    setZoom(Math.min(1, Math.max(0.4, fit)));
  }, [currentPage?.index, currentPage?.width, geometry.w, preview?.kind]);

  const handleSelection = useCallback(() => {
    if (!file || mode === 'edit') return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const text = selection.toString();
    if (text.trim().length < 2) return;
    const range = selection.getRangeAt(0);
    const root = rootRef.current;
    if (!root) return;

    let next: ComposerState | null = null;
    if (file.text) {
      const from = lineNumberOf(range.startContainer);
      const to = lineNumberOf(range.endContainer);
      if (!from || !to) return;
      next = { x: 0, y: 0, from: Math.min(from, to), to: Math.max(from, to), quote: trimQuote(text) };
    } else if (preview?.kind === 'pages' && currentPage) {
      const start = range.startContainer;
      const element = start.nodeType === Node.ELEMENT_NODE ? (start as Element) : start.parentElement;
      if (!element?.closest('.dsh-fr-textlayer')) return;
      next = {
        x: 0,
        y: 0,
        from: currentPage.index,
        to: currentPage.index,
        quote: trimQuote(text),
        page: currentPage.index,
        pageLabel: currentPage.label,
      };
    } else if (preview?.kind === 'sheet' && sheet) {
      const startElement = elementOf(range.startContainer);
      const endElement = elementOf(range.endContainer);
      if (!startElement?.closest('.dsh-fr-sheet')) return;
      const startCell = startElement.closest('[data-cell]')?.getAttribute('data-cell') ?? '';
      const endCell = endElement?.closest('[data-cell]')?.getAttribute('data-cell') ?? startCell;
      const cellRange = startCell ? (endCell && endCell !== startCell ? `${startCell}:${endCell}` : startCell) : '';
      const startPos = parseCellRef(startCell);
      const endPos = parseCellRef(endCell || startCell);
      if (startPos && endPos) {
        setSheetSel({
          anchorRow: startPos.row,
          anchorCol: startPos.col,
          focusRow: endPos.row,
          focusCol: endPos.col,
        });
      }
      const label = `工作表「${sheet.name}」${cellRange ? ` ${cellRange}` : ''}`;
      next = {
        x: 0,
        y: 0,
        from: sheet.index + 1,
        to: sheet.index + 1,
        quote: trimQuote(text),
        pageLabel: label,
        block: {
          page: sheet.index + 1,
          label,
          sheet: sheet.name,
          ...(cellRange ? { range: cellRange } : {}),
          selected: true,
        },
      };
    }
    if (!next) return;

    const rootRect = root.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    setComposer({
      ...next,
      x: Math.max(12, Math.min(rootRect.width - 320, rect.left - rootRect.left - 20)),
      y: Math.max(60, Math.min(rootRect.height - 300, rect.bottom - rootRect.top + 8)),
    });
    setComposerText('');
    selection.removeAllRanges();
  }, [currentPage, file, mode, preview?.kind, sheet]);

  const addAnnotation = useCallback(() => {
    if (!file || !composer) return;
    const text = composerText.trim();
    if (!text) {
      showToast('先写一句批注意见');
      return;
    }
    const annotation: Annotation = {
      id: crypto.randomUUID(),
      path: file.path,
      fileSha1: file.sha1,
      from: composer.from,
      to: composer.to,
      quote: composer.quote,
      text,
      status: 'open',
      createdAt: Date.now(),
      ...(composer.block ? { block: composer.block } : {}),
      ...(composer.page !== undefined ? { page: composer.page } : {}),
    };
    setAnnotations((previous) => [...previous, annotation]);
    setComposer(null);
    setComposerText('');
    showToast('已添加批注');
  }, [composer, composerText, file, showToast]);

  const addBlockAnnotation = useCallback(() => {
    if (!file || !blockTarget) return;
    setComposer({
      x: 24,
      y: 104,
      from: blockTarget.page,
      to: blockTarget.page,
      quote: blockTarget.label,
      block: blockTarget,
    });
    setComposerText('');
  }, [blockTarget, file]);

  const save = useCallback(async () => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const saved = await saveFile({ sessionId, path: file.path, content: draft, baseSha1: file.sha1 });
      setFile({ ...file, content: draft, sha1: saved.sha1, size: saved.size, mtimeMs: saved.mtimeMs });
      setDirty(false);
      tabDrafts.current.delete(file.path);
      setBanner(null);
      setVersions((previous) => ({ ...previous, [file.path]: (previous[file.path] ?? 1) + 1 }));
      showToast(`已保存 v${(versions[file.path] ?? 1) + 1}（原文件备份为 .bak）`);
    } catch (error) {
      if (isApiError(error) && error.code === 'CONFLICT') {
        setBanner('conflict');
        showToast('文件已被外部修改，请先刷新');
      } else {
        showToast(`保存失败：${isApiError(error) ? error.message : String(error)}`);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, draft, file, sessionId, showToast, versions]);

  const jumpTo = useCallback((annotation: Annotation) => {
    if (annotation.block) {
      if (preview?.kind === 'sheet') {
        setSheetIndex(Math.max(0, annotation.block.page - 1));
        const [startRef, endRef] = (annotation.block.range ?? '').split(':');
        const start = parseCellRef(startRef ?? '');
        const end = parseCellRef(endRef ?? startRef ?? '');
        setSheetSel(
          start && end
            ? {
                anchorRow: start.row,
                anchorCol: start.col,
                focusRow: end.row,
                focusCol: end.col,
              }
            : null,
        );
      } else {
        setPageIndex(annotation.block.page);
      }
      return;
    }
    if (annotation.page !== undefined) {
      setPageIndex(annotation.page);
      return;
    }
    const target = contentRef.current?.querySelector(`[data-line="${annotation.from}"]`);
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [preview?.kind]);

  const resolveAnnotation = useCallback((id: string) => {
    setAnnotations((previous) => previous.map((annotation) => (annotation.id === id ? { ...annotation, status: 'resolved' as const } : annotation)));
  }, []);

  const reopenAnnotation = useCallback((id: string) => {
    setAnnotations((previous) => previous.map((annotation) => (annotation.id === id ? { ...annotation, status: 'open' as const } : annotation)));
  }, []);

  const deleteAnnotation = useCallback((id: string) => {
    const target = annotationsRef.current.find((annotation) => annotation.id === id);
    if (target) {
      const pending = deletedByPath.current.get(target.path) ?? new Set<string>();
      pending.add(id);
      deletedByPath.current.set(target.path, pending);
    }
    setAnnotations((previous) => previous.filter((annotation) => annotation.id !== id));
  }, []);

  const message = useMemo(() => {
    if (!file) return '';
    return buildAnnotationMessage({
      relPath: file.path,
      version,
      annotations: openAnnotations,
      includePath: sendIncludePath,
      includeQuote: sendIncludeQuote,
    });
  }, [file, openAnnotations, sendIncludePath, sendIncludeQuote, version]);

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('已复制到剪贴板');
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      showToast('已复制到剪贴板');
    }
  }, [showToast]);

  const send = useCallback(async () => {
    if (!file || busy) return;
    if (!sessionId) {
      showToast('当前没有会话，先把文件发给 AI 的会话里打开面板');
      return;
    }
    setBusy(true);
    try {
      await sendAnnotations({ sessionId, markdown: message });
      setAnnotations((previous) =>
        previous.map((annotation) =>
          annotation.path === file.path && annotation.status === 'open' ? { ...annotation, sentAt: Date.now() } : annotation,
        ),
      );
      setSendOpen(false);
      showToast('已发给 AI，等它改完刷新预览');
    } catch (error) {
      showToast(`发送失败：${isApiError(error) ? error.message : String(error)}；已复制文本备用`);
      await copyText(message);
    } finally {
      setBusy(false);
    }
  }, [busy, copyText, file, message, sessionId, showToast]);

  const exportCurrent = useCallback(async () => {
    if (!file) return;
    try {
      const exported = await exportAnnotations({ sessionId, path: file.path, content: message });
      showToast(`已导出：${exported}`);
    } catch (error) {
      showToast(`导出失败：${isApiError(error) ? error.message : String(error)}`);
    }
  }, [file, message, sessionId, showToast]);

  // ------------------------------------------------------------------
  // 拖拽与缩放
  // ------------------------------------------------------------------
  const beginDrag = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if ((event.target as HTMLElement).closest('button')) return;
      event.preventDefault();
      const start = { mouseX: event.clientX, mouseY: event.clientY, x: geometry.x, y: geometry.y };
      const onMove = (move: MouseEvent): void => {
        setGeometry((previous) => ({
          ...previous,
          x: start.x + (move.clientX - start.mouseX),
          y: Math.max(0, start.y + (move.clientY - start.mouseY)),
        }));
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [geometry.x, geometry.y],
  );

  const beginResize = useCallback(
    (axis: 'e' | 's' | 'se') => (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const start = { mouseX: event.clientX, mouseY: event.clientY, w: geometry.w, h: geometry.h };
      const onMove = (move: MouseEvent): void => {
        setGeometry((previous) => ({
          ...previous,
          w: axis === 's' ? previous.w : Math.max(MIN_W, start.w + (move.clientX - start.mouseX)),
          h: axis === 'e' ? previous.h : Math.max(MIN_H, start.h + (move.clientY - start.mouseY)),
        }));
      };
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [geometry.h, geometry.w],
  );

  // ------------------------------------------------------------------
  // 键盘：Esc 关闭 / Ctrl+S 保存
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!snapshot.open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (composer) {
          addAnnotation();
          return;
        }
        if (sendOpen) {
          if (!busy && activeAnnotations.length > 0) void send();
          return;
        }
        if (activeAnnotations.length > 0) setSendOpen(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (mode === 'edit' && dirty) void save();
        return;
      }
      if (event.key !== 'Escape') return;
      if (composer) {
        setComposer(null);
        return;
      }
      if (sendOpen) {
        setSendOpen(false);
        return;
      }
      requestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeAnnotations.length, addAnnotation, busy, composer, dirty, mode, requestClose, save, send, sendOpen, snapshot.open]);

  if (!snapshot.open) return null;

  const renderTreeLevel = (dir: string, entries: TreeEntry[], depth: number): JSX.Element[] =>
    entries.map((entry) => {
      const paddingLeft = 6 + depth * 12;
      if (entry.dir) {
        const state = dirs[entry.path];
        const expanded = state?.expanded ?? false;
        const children = state?.entries ?? [];
        return (
          <div key={entry.path}>
            <div
              className="dsh-fr-tree-row"
              style={{ paddingLeft }}
              onClick={() => toggleDir(entry.path)}
              title={entry.path}
            >
              <span className="dsh-fr-tree-icon">{expanded ? '▾' : '▸'}</span>
              <span className="dsh-fr-tree-name">{entry.name}</span>
            </div>
            {expanded ? renderTreeLevel(entry.path, children, depth + 1) : null}
          </div>
        );
      }
      return (
        <div
          key={entry.path}
          className={`dsh-fr-tree-row${entry.path === activePath ? ' dsh-fr-tree-row-active' : ''}`}
          style={{ paddingLeft }}
          onClick={() => openTab(entry.path)}
          title={entry.path}
        >
          <span className="dsh-fr-tree-icon">📄</span>
          <span className="dsh-fr-tree-name">{entry.name}</span>
        </div>
      );
    });

  return (
    <div
      className="dsh-fr-root"
      ref={rootRef}
      style={{ left: geometry.x, top: geometry.y, width: geometry.w, height: geometry.h }}
    >
      <header className="dsh-fr-head" onMouseDown={beginDrag}>
        <span className="dsh-fr-title">文件预览与批注</span>
        <span className="dsh-fr-meta">
          {file ? `${file.path} · v${version} · ${formatBytes(file.size)}${dirty ? ' · 未保存' : ''}` : '在左栏选择文件'}
        </span>
        <button className="dsh-fr-btn" onClick={() => void refreshRoot()} disabled={rootLoading}>
          {rootLoading ? '读取中…' : '刷新'}
        </button>
        <button
          className="dsh-fr-btn"
          disabled={!file || file.readonly}
          onClick={() => {
            if (mode === 'edit' && dirty && !window.confirm('退出编辑会丢弃未保存修改，继续？')) return;
            setMode(mode === 'edit' ? 'preview' : 'edit');
          }}
        >
          {mode === 'edit' ? '预览' : '编辑'}
        </button>
        <button className="dsh-fr-btn dsh-fr-close" onClick={requestClose} title="关闭（Esc）">
          ✕
        </button>
      </header>

      {banner === 'external' ? (
        <div className="dsh-fr-banner">
          <span>内容已更新，当前预览不是最新版本。</span>
          <span className="dsh-fr-spacer" />
          <button className="dsh-fr-btn" onClick={() => void refreshCurrent()}>
            刷新到最新
          </button>
        </div>
      ) : null}
      {banner === 'conflict' ? (
        <div className="dsh-fr-banner">
          <span>文件已在外部修改，同时你有未保存的修改，请先刷新再保存。</span>
          <span className="dsh-fr-spacer" />
          <button className="dsh-fr-btn" onClick={() => void refreshCurrent()}>
            刷新（丢弃我的修改）
          </button>
        </div>
      ) : null}

      <div className="dsh-fr-body">
        <aside className="dsh-fr-tree">
          {rootEntries.length === 0 && !rootLoading ? (
            <div className="dsh-fr-empty-list">工作区为空或未加载</div>
          ) : (
            renderTreeLevel('', rootEntries, 0)
          )}
        </aside>

        <main className="dsh-fr-main">
          {tabs.length > 0 ? (
            <div className="dsh-fr-tabs" role="tablist">
              {tabs.map((path) => {
                const name = path.split('/').pop() ?? path;
                const unsaved = path === file?.path ? dirty : tabDrafts.current.get(path)?.dirty;
                return (
                  <span
                    key={path}
                    className={`dsh-fr-tab${path === activePath ? ' dsh-fr-tab-active' : ''}`}
                    title={path}
                  >
                    <button className="dsh-fr-tab-name" role="tab" onClick={() => openTab(path)}>
                      {name}
                      {unsaved ? ' •' : ''}
                    </button>
                    <button className="dsh-fr-tab-close" onClick={() => closeTab(path)} title="关闭标签">
                      ×
                    </button>
                  </span>
                );
              })}
              <span className="dsh-fr-tabs-count">
                {tabs.length}/{MAX_TABS}
              </span>
            </div>
          ) : null}
          <div className="dsh-fr-toolbar">
            {file ? (
              <>
                <span>{file.path}</span>
                <span>· {formatBytes(file.size)}</span>
                {file.readonly ? <span>· 只读</span> : null}
                {file.tooLarge ? <span>· 超过 2MB，仅支持查看</span> : null}
                <span className="dsh-fr-spacer" />
                {mode === 'edit' ? (
                  <button className="dsh-fr-btn dsh-fr-btn-primary" onClick={() => void save()} disabled={busy || !dirty}>
                    {busy ? '保存中…' : `保存 v${version + 1}`}
                  </button>
                ) : null}
                <button className="dsh-fr-btn" onClick={() => void refreshCurrent()}>
                  刷新
                </button>
              </>
            ) : (
              <span>{fileLoading ? '打开中…' : '← 从左侧选择一个文件'}</span>
            )}
          </div>

          {file && file.previewKind !== 'text' ? (
            <div className="dsh-fr-previewbar">
              {preview?.kind === 'pages' && currentPage ? (
                <>
                  <button
                    className="dsh-fr-btn"
                    onClick={() => {
                      const target = previewPages[Math.max(0, pagePosition - 1)];
                      if (target) setPageIndex(target.index);
                    }}
                    disabled={pagePosition <= 0}
                  >
                    ‹ 上一页
                  </button>
                  <button
                    className="dsh-fr-btn"
                    onClick={() => {
                      const target = previewPages[Math.min(previewPages.length - 1, pagePosition + 1)];
                      if (target) setPageIndex(target.index);
                    }}
                    disabled={pagePosition >= previewPages.length - 1}
                  >
                    下一页 ›
                  </button>
                  <span className="dsh-fr-muted">{currentPage.label}</span>
                  {textLayer?.hasText ? <span className="dsh-fr-muted">· 可拖选文字</span> : null}
                  <span className="dsh-fr-muted">
                    {pagePosition + 1} / {preview.pageCount ?? previewPages.length}
                  </span>
                  <span className="dsh-fr-divider" />
                  <button
                    className="dsh-fr-btn"
                    onClick={() => setZoom((value) => Math.max(0.3, Math.round((value - 0.1) * 10) / 10))}
                    title="缩小"
                  >
                    −
                  </button>
                  <span className="dsh-fr-zoom">{Math.round(zoom * 100)}%</span>
                  <button
                    className="dsh-fr-btn"
                    onClick={() => setZoom((value) => Math.min(2.5, Math.round((value + 0.1) * 10) / 10))}
                    title="放大"
                  >
                    ＋
                  </button>
                  <span className="dsh-fr-divider" />
                  <button className="dsh-fr-btn" onClick={addBlockAnnotation}>
                    ＋ 批注本页
                  </button>
                  {preview.truncated ? (
                    <span className="dsh-fr-muted">仅渲染前 {previewPages.length} 页（共 {preview.pageCount} 页）</span>
                  ) : null}
                </>
              ) : preview?.kind === 'sheet' ? (
                <>
                  {(preview.sheets ?? []).map((item) => (
                    <button
                      key={item.index}
                      className={`dsh-fr-btn${item.index === sheetIndex ? ' dsh-fr-btn-primary' : ''}`}
                      onClick={() => setSheetIndex(item.index)}
                    >
                      工作表「{item.name}」
                    </button>
                  ))}
                  <span className="dsh-fr-muted">· 可拖选文字</span>
                  <span className="dsh-fr-spacer" />
                  <button
                    className="dsh-fr-btn"
                    onClick={addBlockAnnotation}
                    disabled={!sheet || sheetLoading || Boolean(sheetError)}
                  >
                    ＋ 批注本表
                  </button>
                </>
              ) : preview?.kind === 'image' ? (
                <>
                  <span className="dsh-fr-muted">
                    {preview.mime} · {formatBytes(preview.size ?? file.size)}
                  </span>
                  <span className="dsh-fr-spacer" />
                  <button className="dsh-fr-btn" onClick={addBlockAnnotation}>
                    ＋ 批注图片
                  </button>
                </>
              ) : (
                <span className="dsh-fr-muted">{previewLoading ? '准备预览…' : previewError ? '预览不可用' : ''}</span>
              )}
            </div>
          ) : null}

          <div
            className="dsh-fr-content"
            ref={contentRef}
            onMouseUp={() => {
              sheetDragging.current = false;
              handleSelection();
            }}
            onMouseLeave={() => {
              sheetDragging.current = false;
            }}
          >
            {!file ? (
              <div className="dsh-fr-empty">预览区。选中文字后可以添加批注。</div>
            ) : file.previewKind !== 'text' ? (
              <div
                className={
                  preview?.kind === 'sheet'
                    ? 'dsh-fr-preview-wrap dsh-fr-preview-wrap-sheet'
                    : 'dsh-fr-preview-wrap'
                }
              >
                {previewLoading ? (
                  <div className="dsh-fr-skeleton" aria-label="正在准备预览">
                    <div className="dsh-fr-skeleton-bar" />
                    <div className="dsh-fr-skeleton-block" />
                    <div className="dsh-fr-skeleton-block dsh-fr-skeleton-block-short" />
                    <div className="dsh-fr-preview-state">
                      正在转换文档，首次打开可能需要几秒…
                      <span className="dsh-fr-preview-actions">
                        <button
                          className="dsh-fr-btn"
                          onClick={() => {
                            previewAbort.current?.abort();
                            setPreviewLoading(false);
                            setPreviewCancelled(true);
                          }}
                        >
                          取消
                        </button>
                      </span>
                    </div>
                  </div>
                ) : previewError && previewUiError ? (
                  <div className="dsh-fr-preview-error">
                    <div className="dsh-fr-preview-error-title">{previewUiError.title}</div>
                    <div className="dsh-fr-preview-error-hint">{previewUiError.hint}</div>
                    <details className="dsh-fr-error-details">
                      <summary>查看技术详情</summary>
                      <pre>{previewUiError.message || previewError}</pre>
                    </details>
                    <button className="dsh-fr-btn" onClick={() => void loadPreview(file)}>
                      重试
                    </button>
                  </div>
                ) : preview?.kind === 'image' ? (
                  <div className="dsh-fr-image-wrap">
                    <img
                      className="dsh-fr-preview-image"
                      src={rawUrl(sessionId, file.path, file.sha1)}
                      alt={file.name}
                      draggable={false}
                    />
                  </div>
                ) : preview?.kind === 'sheet' ? (
                  <div className="dsh-fr-sheet-wrap">
                    {sheetLoading ? (
                      <div className="dsh-fr-skeleton" aria-label="正在解析表格">
                        <div className="dsh-fr-skeleton-bar" />
                        <div className="dsh-fr-skeleton-block" />
                        <div className="dsh-fr-preview-state">
                          正在解析表格…
                          <span className="dsh-fr-preview-actions">
                            <button
                              className="dsh-fr-btn"
                              onClick={() => {
                                sheetAbort.current?.abort();
                                setSheetLoading(false);
                                setSheetCancelled(true);
                              }}
                            >
                              取消
                            </button>
                          </span>
                        </div>
                      </div>
                    ) : sheetError && sheetUiError ? (
                      <div className="dsh-fr-preview-error">
                        <div className="dsh-fr-preview-error-title">{sheetUiError.title}</div>
                        <div className="dsh-fr-preview-error-hint">{sheetUiError.hint}</div>
                        <details className="dsh-fr-error-details">
                          <summary>查看技术详情</summary>
                          <pre>{sheetUiError.message || sheetError}</pre>
                        </details>
                        <button className="dsh-fr-btn" onClick={() => file && void loadSheet(file, sheetIndex)}>
                          重试
                        </button>
                      </div>
                    ) : sheet ? (
                      <>
                        {sheetSelectionLabel ? <div className="dsh-fr-sheet-range">{sheetSelectionLabel}</div> : null}
                        {sheet.truncated ? (
                          <div className="dsh-fr-sheet-trunc">
                            <span>
                              {sheetFull
                                ? `已加载前 ${sheet.rowCount.toLocaleString()} 行 · 共 ${sheet.totalRows.toLocaleString()} 行 × ${sheet.totalCols} 列，已达加载上限`
                                : `只显示前 ${sheet.rowCount.toLocaleString()} 行 · 共 ${sheet.totalRows.toLocaleString()} 行 × ${sheet.totalCols} 列，已截断`}
                            </span>
                            {!sheetFull ? (
                              <button className="dsh-fr-btn" onClick={() => setFullConfirmOpen(true)}>
                                加载全部（较慢）
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        {fullConfirmOpen ? (
                          <div className="dsh-fr-sheet-confirm">
                            <span>完整加载 {sheet.totalRows.toLocaleString()} 行会更慢，继续吗？</span>
                            <button
                              className="dsh-fr-btn dsh-fr-btn-primary"
                              onClick={() => file && void loadSheet(file, sheetIndex, true)}
                            >
                              确认加载
                            </button>
                            <button className="dsh-fr-btn" onClick={() => setFullConfirmOpen(false)}>
                              取消
                            </button>
                          </div>
                        ) : null}
                        <div className="dsh-fr-sheet-scroll" ref={sheetScrollRef} onScroll={onSheetScroll}>
                        <table className="dsh-fr-sheet" style={{ width: `${sheetTableWidth}px` }}>
                          <colgroup>
                            <col style={{ width: '44px' }} />
                            {sheetColumnWidths.map((width, index) => (
                              <col key={index} style={{ width: `${width}px` }} />
                            ))}
                          </colgroup>
                          <thead>
                            <tr>
                              <th className="dsh-fr-sheet-corner" />
                              {Array.from({ length: sheet.colCount }, (_, index) => (
                                <th
                                  key={index}
                                  className={`dsh-fr-sheet-colhead${
                                    sheetSelection && index + 1 >= sheetSelection.fromCol && index + 1 <= sheetSelection.toCol
                                      ? ' dsh-fr-sheet-head-active'
                                      : ''
                                  }`}
                                >
                                  {columnLabel(index + 1)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sheetFrozenRowsData.map((row) => renderSheetRow(row, true))}
                            {sheetVirtual ? (
                              <tr className="dsh-fr-sheet-spacer" style={{ height: `${sheetTopSpacerHeight}px` }}>
                                <td colSpan={sheet.colCount + 1} />
                              </tr>
                            ) : null}
                            {sheetWindowRowsData.map((row) => renderSheetRow(row, false))}
                            {sheetVirtual ? (
                              <tr className="dsh-fr-sheet-spacer" style={{ height: `${sheetBottomSpacerHeight}px` }}>
                                <td colSpan={sheet.colCount + 1} />
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                        {sheet.cells.length === 0 ? (
                          <div className="dsh-fr-sheet-note">这个工作表是空的</div>
                        ) : null}
                        </div>
                      </>
                    ) : sheetCancelled ? (
                      <div className="dsh-fr-preview-state">
                        已取消表格解析
                        <span className="dsh-fr-preview-actions">
                          <button className="dsh-fr-btn" onClick={() => file && void loadSheet(file, sheetIndex)}>
                            重新加载
                          </button>
                        </span>
                      </div>
                    ) : (
                      <div className="dsh-fr-preview-state">暂无表格数据</div>
                    )}
                  </div>
                ) : preview?.kind === 'pages' && currentPage ? (
                  <div className="dsh-fr-page-wrap">
                    <div
                      className="dsh-fr-page-stack"
                      style={{
                        width: Math.max(1, Math.round(currentPage.width * zoom)),
                        height: Math.max(1, Math.round(currentPage.height * zoom)),
                      }}
                    >
                      <img
                        className="dsh-fr-page-image"
                        src={renderUrl(sessionId, file.path, preview.key, currentPage.index)}
                        width={Math.max(1, Math.round(currentPage.width * zoom))}
                        height={Math.max(1, Math.round(currentPage.height * zoom))}
                        alt={currentPage.label}
                        draggable={false}
                      />
                      {textLayer && textLayer.hasText ? (
                        <div className="dsh-fr-textlayer">
                          {textLayer.blocks.map((block: TextBlock, index: number) => (
                            <span
                              key={`${block.text}-${index}`}
                              style={{
                                left: `${block.x * 100}%`,
                                top: `${block.y * 100}%`,
                                width: `${Math.max(block.w, 0.002) * 100}%`,
                                height: `${Math.max(block.h, 0.004) * 100}%`,
                                fontSize: `${Math.max(1, block.h * currentPage.height * zoom)}px`,
                              }}
                            >
                              {block.text}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {textLayerLoading ? <div className="dsh-fr-textlayer-hint">正在提取文字层…</div> : null}
                    {!textLayerLoading && textLayerError ? (
                      <div className="dsh-fr-textlayer-hint">文字层不可用：{textLayerError}；可用「＋ 批注本页」</div>
                    ) : null}
                    {!textLayerLoading && !textLayerError && textLayer && !textLayer.hasText ? (
                      <div className="dsh-fr-textlayer-hint">这页没有可选文字（扫描件？），可用「＋ 批注本页」</div>
                    ) : null}
                  </div>
                ) : (
                  <div className="dsh-fr-preview-state">
                    {previewCancelled ? (
                      <>
                        已取消预览
                        <span className="dsh-fr-preview-actions">
                          <button className="dsh-fr-btn" onClick={() => file && void loadPreview(file)}>
                            重新加载
                          </button>
                        </span>
                      </>
                    ) : (
                      '暂无预览'
                    )}
                  </div>
                )}
              </div>
            ) : mode === 'edit' ? (
              <div className="dsh-fr-editor-wrap">
                <pre className="dsh-fr-editor-ln">{draft.split('\n').map((_, index) => String(index + 1)).join('\n')}</pre>
                <textarea
                  className="dsh-fr-editor"
                  value={draft}
                  spellCheck={false}
                  readOnly={file.readonly}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setDirty(event.target.value !== file.content);
                  }}
                />
              </div>
            ) : (
              <div className="dsh-fr-lines">
                {decorated.map((line, index) => {
                  const lineNumber = index + 1;
                  const marked = markedLines.has(lineNumber);
                  return (
                    <div
                      key={lineNumber}
                      className={`dsh-fr-line${line.cls}${marked ? ' dsh-fr-line-marked' : ''}`}
                      data-line={lineNumber}
                    >
                      <span className="dsh-fr-ln">{lineNumber}</span>
                      <span className="dsh-fr-lt">
                        {marked ? <span className="dsh-fr-pin">●</span> : null}
                        {line.text || ' '}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        <aside className="dsh-fr-rail">
          <div className="dsh-fr-rail-head">
            <span>批注</span>
            <span className="dsh-fr-spacer" />
            <span>{openAnnotations.length} 条未解决 / {activeAnnotations.length} 条</span>
          </div>
          <div className="dsh-fr-rail-list">
            {activeAnnotations.length === 0 ? (
              <div className="dsh-fr-empty-list">
                选中左侧文字 → 点「＋ 批注」
                <br />
                Office / PDF 用预览工具栏的「＋ 批注本页」。
                <br />
                批注会带回当前会话，让 AI 直接改。
              </div>
            ) : (
              activeAnnotations.map((annotation) => (
                <div className="dsh-fr-card" key={annotation.id} style={annotation.status === 'resolved' ? { opacity: 0.55, borderLeftColor: '#6ee7a8' } : undefined}>
                  <div className="dsh-fr-card-quote">{annotation.block ? annotation.block.label : `“${annotation.quote}”`}</div>
                  <div className="dsh-fr-card-text">{annotation.text}</div>
                  <div className="dsh-fr-card-foot">
                    <span>{annotationKindLabel(annotation)}</span>
                    <span>{formatRelativeTime(annotation.createdAt)}</span>
                    {annotation.status === 'stale' ? <span>已过期</span> : null}
                    {annotation.sentAt ? <span>已发送</span> : null}
                    <span className="dsh-fr-card-actions">
                      <button className="dsh-fr-link" onClick={() => jumpTo(annotation)}>
                        定位
                      </button>
                      {annotation.status === 'resolved' ? (
                        <button className="dsh-fr-link" onClick={() => reopenAnnotation(annotation.id)}>
                          重新打开
                        </button>
                      ) : (
                        <button className="dsh-fr-link" onClick={() => resolveAnnotation(annotation.id)}>
                          解决
                        </button>
                      )}
                      <button className="dsh-fr-link" onClick={() => deleteAnnotation(annotation.id)}>
                        删除
                      </button>
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>

      <footer className="dsh-fr-foot">
        <span>
          {file ? `${openAnnotations.length} 条批注待处理` : '未选择文件'}
          {!sessionId ? ' · 未绑定会话' : ''}
        </span>
        <span className="dsh-fr-spacer" />
        <button className="dsh-fr-btn" disabled={!file || openAnnotations.length === 0} onClick={() => void exportCurrent()}>
          导出批注
        </button>
        <button
          className="dsh-fr-btn dsh-fr-btn-primary"
          disabled={!file || openAnnotations.length === 0}
          onClick={() => setSendOpen(true)}
        >
          发给 AI
        </button>
      </footer>

      {composer ? (
        <div className="dsh-fr-composer" style={{ left: composer.x, top: composer.y }}>
          <div className="dsh-fr-composer-quote">“{composer.quote}”</div>
          <textarea
            className="dsh-fr-input"
            autoFocus
            placeholder="写一句你的意见，例如：这里数字不对，改成 42"
            value={composerText}
            onChange={(event) => setComposerText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') addAnnotation();
            }}
          />
          <div className="dsh-fr-composer-foot">
            <button className="dsh-fr-btn" onClick={() => setComposer(null)}>
              取消
            </button>
            <button className="dsh-fr-btn dsh-fr-btn-primary" onClick={addAnnotation}>
              添加批注
            </button>
          </div>
        </div>
      ) : null}

      {sendOpen && file ? (
        <div className="dsh-fr-mask">
          <div className="dsh-fr-dialog">
            <h3>发给 AI</h3>
            <div className="dsh-fr-dialog-sub">
              把 {openAnnotations.length} 条批注作为一条用户消息发到当前会话，AI 会按批注改文件。
            </div>
            <label className="dsh-fr-switch-row">
              <input type="checkbox" checked={sendIncludePath} onChange={(event) => setSendIncludePath(event.target.checked)} />
              附带文件路径与版本
            </label>
            <label className="dsh-fr-switch-row">
              <input type="checkbox" checked={sendIncludeQuote} onChange={(event) => setSendIncludeQuote(event.target.checked)} />
              附带原文摘录
            </label>
            <div className="dsh-fr-preview">{message}</div>
            <div className="dsh-fr-dialog-foot">
              <button className="dsh-fr-btn" onClick={() => void copyText(message)}>
                复制文本
              </button>
              <button className="dsh-fr-btn" onClick={() => void exportCurrent()}>
                导出为 .md
              </button>
              <span className="dsh-fr-spacer" />
              <button className="dsh-fr-btn" onClick={() => setSendOpen(false)}>
                取消
              </button>
              <button className="dsh-fr-btn dsh-fr-btn-primary" onClick={() => void send()} disabled={busy}>
                {busy ? '发送中…' : '发送'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? <div className="dsh-fr-toast">{toast}</div> : null}

      <div className="dsh-fr-handle dsh-fr-handle-e" onMouseDown={beginResize('e')} />
      <div className="dsh-fr-handle dsh-fr-handle-s" onMouseDown={beginResize('s')} />
      <div className="dsh-fr-handle dsh-fr-handle-se" onMouseDown={beginResize('se')} />
    </div>
  );
}

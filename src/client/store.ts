import { useSyncExternalStore } from 'react';
import type { ClientContextLike } from './types.js';

/** 浮层共享状态：入口按钮（会话槽位）与浮层（root 槽位）都从这里取 */
export interface ReviewSnapshot {
  open: boolean;
  sessionId: string | null;
}

let snapshot: ReviewSnapshot = { open: false, sessionId: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setSnapshot(next: ReviewSnapshot): void {
  snapshot = next;
  emit();
}

export function openPanel(sessionId: string | null | undefined): void {
  setSnapshot({
    open: true,
    sessionId: sessionId ? String(sessionId) : snapshot.sessionId,
  });
}

export function closePanel(): void {
  setSnapshot({ ...snapshot, open: false });
}

export function rememberSession(sessionId: string | null | undefined): void {
  if (!sessionId || sessionId === snapshot.sessionId) return;
  setSnapshot({ ...snapshot, sessionId: String(sessionId) });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ReviewSnapshot {
  return snapshot;
}

export function useReviewSnapshot(): ReviewSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// ---------------------------------------------------------------------------
// 宿主能力：把批注当普通用户消息发进当前会话
// ---------------------------------------------------------------------------

let clientCtx: ClientContextLike | null = null;

export function bindClientContext(ctx: ClientContextLike): void {
  clientCtx = ctx;
}

/**
 * 输入条动作（setDraft/submit）由会话作用域槽位下发。
 * 入口按钮渲染时捕获一份，作为 Remote 通道不可用时的兜底发送方式。
 */
interface InputActionsLike {
  setDraft?: (text: string) => void;
  submit?: () => void;
}

let inputActions: InputActionsLike | null = null;

export function captureInputActions(actions: unknown): void {
  if (!actions || typeof actions !== 'object') return;
  const candidate = actions as InputActionsLike;
  if (typeof candidate.setDraft !== 'function' && typeof candidate.submit !== 'function') return;
  inputActions = candidate;
}

/**
 * 槽位下发诊断：记录 left/overlay 两个槽位实际收到的 props 键，
 * 真机排查「inputActions 到底从哪个槽位来」时用（控制台 __dshFileReview.diag()）。
 */
export interface SlotDiagnostics {
  leftKeys: string[];
  overlayKeys: string[];
  captured: boolean;
}

let diagnostics: SlotDiagnostics = { leftKeys: [], overlayKeys: [], captured: false };

export function recordSlotProps(slot: 'left' | 'overlay', props: unknown): void {
  const keys = props && typeof props === 'object' ? Object.keys(props as Record<string, unknown>) : [];
  diagnostics = slot === 'left' ? { ...diagnostics, leftKeys: keys } : { ...diagnostics, overlayKeys: keys };
}

export function getSlotDiagnostics(): SlotDiagnostics {
  return { ...diagnostics, captured: inputActions !== null };
}

interface RemoteSessionApi {
  prompt?: (request: {
    requestId: string;
    sessionId: string;
    mode: 'queue' | 'steer';
    content: readonly { type: 'text'; text: string }[];
    clientTimeZone?: string;
  }, signal?: AbortSignal) => Promise<unknown>;
}

/**
 * 解析官方 session/prompt Remote。
 * 客户端未注入 remote 服务时，cordis 的属性访问本身就会抛错，
 * 所以每一次取服务都必须包在 try 里，这里返回 null 而不是抛异常。
 */
function resolvePromptApi(): RemoteSessionApi | null {
  const ctx = clientCtx;
  if (!ctx) return null;
  let remote: unknown = null;
  try {
    remote = ctx.remote;
  } catch {
    remote = null;
  }
  if (!remote) {
    try {
      remote = ctx.get('remote');
    } catch {
      remote = null;
    }
  }
  const session = (remote as { session?: RemoteSessionApi } | null)?.session;
  if (!session || typeof session.prompt !== 'function') return null;
  return session;
}

/** 还有没有可用的发送通道（Remote 或输入条动作） */
export function canSendToSession(): boolean {
  if (inputActions && typeof inputActions.setDraft === 'function' && typeof inputActions.submit === 'function') {
    return true;
  }
  return resolvePromptApi() !== null;
}

/** 兜底：把文本写进输入条草稿并提交，等价于用户手动发送 */
function sendViaComposer(text: string): boolean {
  const actions = inputActions;
  if (!actions || typeof actions.setDraft !== 'function' || typeof actions.submit !== 'function') return false;
  try {
    actions.setDraft(text);
    actions.submit();
    return true;
  } catch {
    return false;
  }
}

/**
 * 把格式化后的批注文本作为用户消息送入当前会话。
 * 顺序：官方 session/prompt Remote（不覆盖用户草稿）→ 输入条 setDraft+submit 兜底。
 */
export async function sendToSession(sessionId: string, text: string): Promise<void> {
  const api = resolvePromptApi();
  if (api?.prompt) {
    const controller = new AbortController();
    try {
      await api.prompt(
        {
          requestId: crypto.randomUUID(),
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        controller.signal,
      );
      return;
    } catch (error) {
      if (sendViaComposer(text)) return;
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
  if (sendViaComposer(text)) return;
  throw new Error('当前 DSH 版本未暴露 session/prompt，也未捕获输入条动作，请用「复制文本」手动发送');
}

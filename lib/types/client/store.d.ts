import type { ClientContextLike } from './types.js';
/** 浮层共享状态：入口按钮（会话槽位）与浮层（root 槽位）都从这里取 */
export interface ReviewSnapshot {
    open: boolean;
    sessionId: string | null;
}
export declare function openPanel(sessionId: string | null | undefined): void;
export declare function closePanel(): void;
export declare function rememberSession(sessionId: string | null | undefined): void;
export declare function useReviewSnapshot(): ReviewSnapshot;
export declare function bindClientContext(ctx: ClientContextLike): void;
export declare function captureInputActions(actions: unknown): void;
/**
 * 槽位下发诊断：记录 left/overlay 两个槽位实际收到的 props 键，
 * 真机排查「inputActions 到底从哪个槽位来」时用（控制台 __dshFileReview.diag()）。
 */
export interface SlotDiagnostics {
    leftKeys: string[];
    overlayKeys: string[];
    captured: boolean;
}
export declare function recordSlotProps(slot: 'left' | 'overlay', props: unknown): void;
export declare function getSlotDiagnostics(): SlotDiagnostics;
/** 还有没有可用的发送通道（Remote 或输入条动作） */
export declare function canSendToSession(): boolean;
/**
 * 把格式化后的批注文本作为用户消息送入当前会话。
 * 顺序：官方 session/prompt Remote（不覆盖用户草稿）→ 输入条 setDraft+submit 兜底。
 */
export declare function sendToSession(sessionId: string, text: string): Promise<void>;

import type { ClientContextLike } from './types.js';
/** 插件 id 必须与 package.json name / bundle banner id 一致 */
export declare const name = "dsh-file-review";
export declare const inject: string[];
export { canSendToSession, captureInputActions, getSlotDiagnostics, sendToSession } from './store.js';
export { buildAnnotationMessage } from './message.js';
export declare function apply(ctx: ClientContextLike): void;

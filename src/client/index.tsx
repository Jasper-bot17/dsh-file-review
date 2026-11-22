import { createElement, useEffect } from 'react';
import { FileReviewPanel } from './panel.js';
import {
  bindClientContext,
  captureInputActions,
  getSlotDiagnostics,
  openPanel,
  recordSlotProps,
  rememberSession,
} from './store.js';
import type { ClientContextLike, SlotRenderProps, SlotsService } from './types.js';

/** 插件 id 必须与 package.json name / bundle banner id 一致 */
export const name = 'dsh-file-review';
export const inject = ['slots'];

// 供离线测试与宿主诊断使用（bundle 里照常导出，不影响槽位注册）
export { canSendToSession, captureInputActions, getSlotDiagnostics, sendToSession } from './store.js';
export { buildAnnotationMessage } from './message.js';

function EntryButton(props: SlotRenderProps) {
  useEffect(() => {
    rememberSession(props.sessionId);
    recordSlotProps('left', props);
    // 会话作用域槽位会下发输入条动作，缓存起来作为发送兜底
    captureInputActions(props.inputActions);
  }, [props.sessionId, props.inputActions]);

  return createElement(
    'button',
    {
      className: 'dsh-fr-btn',
      type: 'button',
      title: '打开文件预览与批注（预览工作区文件、选中批注、发给 AI）',
      style: { height: '28px', padding: '0 10px', margin: '0 2px' },
      onClick: () => openPanel(props.sessionId),
    },
    '📝 批注',
  );
}

/**
 * 输入条 overlay 槽位的无 UI 捕获组件。
 * 官方会话只在 conversation.input.overlay 的 props 里下发 inputActions（setDraft/submit，
 * 与输入条自身同一个 shell.actions 实例）；入口按钮所在的 input.left 不一定带，
 * 所以这里单独注册一个只做捕获、返回 null 的组件。
 */
function OverlayCapture(props: SlotRenderProps): null {
  rememberSession(props?.sessionId);
  recordSlotProps('overlay', props);
  captureInputActions(props?.inputActions);
  return null;
}

export function apply(ctx: ClientContextLike): void {
  bindClientContext(ctx);

  let slots: SlotsService | null = null;
  try {
    slots = (ctx.get('slots') as SlotsService | undefined) ?? null;
  } catch {
    slots = null;
  }
  if (!slots) return;
  const service = slots;

  // 输入条左端入口
  service.inject('conversation.input.left', () =>
    service.register(
      { name: 'conversation.input.left', id: 'file-review-entry', order: 40, label: '文件预览与批注' },
      (props: SlotRenderProps) =>
        createElement(EntryButton, { sessionId: props?.sessionId, inputActions: props?.inputActions }),
    ),
  );

  // 输入条 overlay：只捕获 inputActions，不渲染任何界面
  service.inject('conversation.input.overlay', () =>
    service.register(
      { name: 'conversation.input.overlay', id: 'file-review-capture', order: 40, label: '文件预览与批注（发送通道）' },
      OverlayCapture,
    ),
  );

  // 页面级浮层面板
  service.inject('shell.overlay', () =>
    service.register(
      { name: 'shell.overlay', id: 'file-review-panel' },
      () => createElement(FileReviewPanel),
    ),
  );

  // 真机排查入口：控制台执行 __dshFileReview.diag() 看两个槽位收到的 props 键
  try {
    (globalThis as unknown as Record<string, unknown>)['__dshFileReview'] = {
      diag: () => getSlotDiagnostics(),
      captureInputActions,
    };
  } catch {
    // 只读全局环境忽略
  }
}

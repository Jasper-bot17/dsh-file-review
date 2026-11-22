/** 面板样式：颜色尽量跟随宿主 CSS 变量，取不到时退回深色中性色 */
export const PANEL_CSS = `
.dsh-fr-style-marker { display: none; }
.dsh-fr-root {
  position: fixed;
  z-index: 900;
  display: flex;
  flex-direction: column;
  min-width: 720px;
  min-height: 420px;
  border-radius: 14px;
  overflow: hidden;
  border: 1px solid var(--dsw-color-border, rgba(255,255,255,.12));
  background: var(--dsw-color-bg-elevated, #17181d);
  color: var(--dsw-color-text-primary, #e8eaf0);
  box-shadow: 0 24px 64px rgba(0,0,0,.45), 0 2px 8px rgba(0,0,0,.35);
  font: 13px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
.dsh-fr-head {
  height: 46px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  border-bottom: 1px solid var(--dsw-color-border, rgba(255,255,255,.09));
  background: var(--dsw-color-bg-panel, rgba(255,255,255,.03));
  cursor: grab;
  user-select: none;
}
.dsh-fr-head:active { cursor: grabbing; }
.dsh-fr-title { font-weight: 600; letter-spacing: .2px; }
.dsh-fr-meta {
  color: var(--dsw-color-text-secondary, #9aa0ad);
  font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}
.dsh-fr-btn {
  appearance: none;
  border: 1px solid var(--dsw-color-border, rgba(255,255,255,.14));
  background: transparent;
  color: inherit;
  border-radius: 7px;
  height: 27px;
  padding: 0 9px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.dsh-fr-btn:hover { background: rgba(124,143,255,.14); }
.dsh-fr-btn:disabled { opacity: .45; cursor: default; }
.dsh-fr-btn-primary {
  border-color: transparent;
  background: #4d6bfe;
  color: #fff;
  font-weight: 600;
}
.dsh-fr-btn-primary:hover { background: #5b76ff; }
.dsh-fr-btn-ghost { border-color: transparent; color: var(--dsw-color-text-secondary, #a6acb9); }
.dsh-fr-close { margin-left: 2px; font-size: 15px; line-height: 1; padding: 0 8px; }
.dsh-fr-body { flex: 1; display: flex; min-height: 0; }
.dsh-fr-tree {
  width: 208px;
  flex: none;
  overflow: auto;
  border-right: 1px solid var(--dsw-color-border, rgba(255,255,255,.09));
  padding: 8px 6px;
}
.dsh-fr-tree-row {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 6px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--dsw-color-text-secondary, #b7bcc8);
  white-space: nowrap;
  overflow: hidden;
}
.dsh-fr-tree-row:hover { background: rgba(255,255,255,.05); color: var(--dsw-color-text-primary, #e8eaf0); }
.dsh-fr-tree-row-active { background: rgba(77,107,254,.18); color: #cdd6ff; }
.dsh-fr-tree-icon { width: 14px; flex: none; text-align: center; opacity: .85; }
.dsh-fr-tree-name { overflow: hidden; text-overflow: ellipsis; }
.dsh-fr-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.dsh-fr-toolbar {
  height: 38px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--dsw-color-border, rgba(255,255,255,.07));
  color: var(--dsw-color-text-secondary, #9aa0ad);
  font-size: 12px;
}
.dsh-fr-spacer { flex: 1; }
.dsh-fr-content { flex: 1; min-height: 0; overflow: auto; position: relative; }
.dsh-fr-lines { padding: 10px 0 40px; }
.dsh-fr-line {
  display: flex;
  gap: 12px;
  min-height: 20px;
  padding: 0 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
.dsh-fr-line:hover { background: rgba(255,255,255,.03); }
.dsh-fr-line-marked { background: rgba(217,146,46,.13); box-shadow: inset 2px 0 0 #d9922e; }
.dsh-fr-ln {
  width: 40px;
  flex: none;
  text-align: right;
  color: var(--dsw-color-text-tertiary, #6a707c);
  font: 12px/20px ui-monospace, SFMono-Regular, Consolas, monospace;
  user-select: none;
}
.dsh-fr-lt { font: 12.5px/20px ui-monospace, SFMono-Regular, Consolas, monospace; }
.dsh-fr-h1 { font-size: 18px; line-height: 26px; font-weight: 700; }
.dsh-fr-h2 { font-size: 16px; line-height: 24px; font-weight: 650; }
.dsh-fr-h3 { font-size: 14px; line-height: 22px; font-weight: 600; }
.dsh-fr-code { background: rgba(255,255,255,.04); }
.dsh-fr-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--dsw-color-text-tertiary, #7d8492);
  font-size: 13px;
  padding: 24px;
  text-align: center;
}
.dsh-fr-editor-wrap { flex: 1; display: flex; overflow: auto; }
.dsh-fr-editor-ln {
  flex: none;
  padding: 10px 0 40px;
  margin: 0;
  width: 52px;
  text-align: right;
  color: var(--dsw-color-text-tertiary, #6a707c);
  font: 12.5px/20px ui-monospace, SFMono-Regular, Consolas, monospace;
  user-select: none;
  border-right: 1px solid var(--dsw-color-border, rgba(255,255,255,.07));
}
.dsh-fr-editor {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  resize: none;
  padding: 10px 12px 40px;
  background: transparent;
  color: inherit;
  font: 12.5px/20px ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: pre;
  tab-size: 2;
}
.dsh-fr-rail {
  width: 312px;
  flex: none;
  border-left: 1px solid var(--dsw-color-border, rgba(255,255,255,.09));
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.dsh-fr-rail-head {
  height: 38px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--dsw-color-border, rgba(255,255,255,.07));
  font-size: 12px;
  color: var(--dsw-color-text-secondary, #9aa0ad);
}
.dsh-fr-rail-list { flex: 1; overflow: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.dsh-fr-card {
  border: 1px solid var(--dsw-color-border, rgba(255,255,255,.12));
  border-left: 2px solid #d9922e;
  border-radius: 8px;
  padding: 8px 10px;
  background: rgba(255,255,255,.025);
}
.dsh-fr-card-quote {
  font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  color: var(--dsw-color-text-secondary, #a8aeb9);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dsh-fr-card-text { margin-top: 6px; font-size: 12.5px; }
.dsh-fr-card-foot {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--dsw-color-text-tertiary, #7d8492);
  font-size: 11px;
}
.dsh-fr-card-actions { margin-left: auto; display: flex; gap: 6px; }
.dsh-fr-link { appearance: none; border: 0; background: none; color: #8ba0ff; cursor: pointer; font-size: 11.5px; padding: 0; }
.dsh-fr-link:hover { text-decoration: underline; }
.dsh-fr-empty-list { color: var(--dsw-color-text-tertiary, #7d8492); font-size: 12px; padding: 20px 6px; text-align: center; line-height: 1.8; }
.dsh-fr-foot {
  height: 52px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-top: 1px solid var(--dsw-color-border, rgba(255,255,255,.09));
  background: var(--dsw-color-bg-panel, rgba(255,255,255,.03));
  font-size: 12px;
  color: var(--dsw-color-text-secondary, #9aa0ad);
}
.dsh-fr-mask {
  position: absolute;
  inset: 0;
  background: rgba(10,11,14,.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 5;
}
.dsh-fr-dialog {
  width: 560px;
  max-height: 84%;
  overflow: auto;
  border-radius: 12px;
  border: 1px solid var(--dsw-color-border, rgba(255,255,255,.14));
  background: var(--dsw-color-bg-elevated, #1b1c22);
  padding: 16px 18px;
  box-shadow: 0 20px 48px rgba(0,0,0,.5);
}
.dsh-fr-dialog h3 { margin: 0 0 4px; font-size: 14px; }
.dsh-fr-dialog-sub { color: var(--dsw-color-text-secondary, #9aa0ad); font-size: 12px; margin-bottom: 12px; }
.dsh-fr-switch-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 12.5px; }
.dsh-fr-preview {
  margin: 10px 0 4px;
  border: 1px solid var(--dsw-color-border, rgba(255,255,255,.12));
  border-radius: 8px;
  background: rgba(0,0,0,.22);
  padding: 10px;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace;
}
.dsh-fr-dialog-foot { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
.dsh-fr-toast {
  position: absolute;
  left: 50%;
  bottom: 64px;
  transform: translateX(-50%);
  background: rgba(20,22,28,.95);
  border: 1px solid var(--dsw-color-border, rgba(255,255,255,.16));
  border-radius: 8px;
  padding: 7px 12px;
  font-size: 12.5px;
  z-index: 6;
  max-width: 70%;
  box-shadow: 0 8px 24px rgba(0,0,0,.4);
}
.dsh-fr-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  background: rgba(217,146,46,.14);
  color: #f0b45e;
  border-bottom: 1px solid rgba(217,146,46,.3);
}
.dsh-fr-composer {
  position: absolute;
  width: 300px;
  z-index: 7;
  border-radius: 10px;
  border: 1px solid var(--dsw-color-border, rgba(255,255,255,.16));
  background: var(--dsw-color-bg-elevated, #1c1e24);
  box-shadow: 0 16px 40px rgba(0,0,0,.5);
  padding: 10px;
}
.dsh-fr-composer-quote {
  font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  color: var(--dsw-color-text-secondary, #a8aeb9);
  background: rgba(255,255,255,.04);
  border-radius: 6px;
  padding: 6px 8px;
  margin-bottom: 8px;
  max-height: 62px;
  overflow: hidden;
}
.dsh-fr-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--dsw-color-border, rgba(255,255,255,.14));
  border-radius: 7px;
  background: rgba(0,0,0,.25);
  color: inherit;
  padding: 7px 8px;
  font: inherit;
  resize: vertical;
  min-height: 62px;
  outline: none;
}
.dsh-fr-input:focus { border-color: #4d6bfe; }
.dsh-fr-composer-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.dsh-fr-handle {
  position: absolute;
  z-index: 8;
}
.dsh-fr-handle-se { right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; }
.dsh-fr-handle-e { right: 0; top: 46px; bottom: 16px; width: 6px; cursor: ew-resize; }
.dsh-fr-handle-s { left: 16px; right: 16px; bottom: 0; height: 6px; cursor: ns-resize; }
.dsh-fr-pin {
  display: inline-block;
  margin-right: 6px;
  color: #f0b45e;
  font-size: 10px;
  transform: translateY(-1px);
}
.dsh-fr-previewbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 4px 12px;
  border-bottom: 1px solid var(--dsw-color-border, rgba(255,255,255,.07));
  background: rgba(255,255,255,.02);
  overflow-x: auto;
  white-space: nowrap;
  font-size: 12px;
}
.dsh-fr-muted { color: var(--dsw-color-text-tertiary, #7d8492); font-size: 11.5px; }
.dsh-fr-zoom {
  min-width: 42px;
  text-align: center;
  font: 12px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  color: var(--dsw-color-text-secondary, #9aa0ad);
}
.dsh-fr-divider {
  width: 1px;
  height: 16px;
  flex: none;
  background: var(--dsw-color-border, rgba(255,255,255,.12));
}
.dsh-fr-preview-wrap { padding: 16px; box-sizing: border-box; min-height: 100%; }
/* 表格分支要占满预览区，让内部的 .dsh-fr-sheet-scroll 成为唯一滚动容器，
   thead / 冻结行列的 sticky 才会相对它生效。其他分支保留原来的自然高度。 */
.dsh-fr-preview-wrap-sheet {
  height: 100%;
  padding: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.dsh-fr-page-wrap { width: max-content; margin: 0 auto; }
.dsh-fr-page-image {
  display: block;
  max-width: none;
  border-radius: 3px;
  background: #fff;
  box-shadow: 0 8px 28px rgba(0,0,0,.35);
}
.dsh-fr-image-wrap { width: max-content; max-width: 100%; margin: 0 auto; }
.dsh-fr-preview-image {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  box-shadow: 0 8px 28px rgba(0,0,0,.35);
}
.dsh-fr-preview-state {
  padding: 48px 24px;
  text-align: center;
  color: var(--dsw-color-text-tertiary, #7d8492);
  font-size: 13px;
}
.dsh-fr-preview-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 40px 24px;
  text-align: center;
  color: #f0b45e;
  font-size: 13px;
}
.dsh-fr-page-stack {
  position: relative;
}
.dsh-fr-textlayer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  user-select: text;
  cursor: text;
  line-height: 1;
}
.dsh-fr-textlayer span {
  position: absolute;
  display: block;
  margin: 0;
  padding: 0;
  color: transparent;
  background: transparent;
  white-space: pre;
  overflow: hidden;
  transform-origin: 0 0;
  user-select: text;
}
.dsh-fr-textlayer ::selection {
  background: rgba(59, 130, 246, .45);
  color: transparent;
}
.dsh-fr-textlayer-hint {
  margin-top: 8px;
  text-align: center;
  color: var(--dsw-color-text-tertiary, #7d8492);
  font-size: 11.5px;
}
.dsh-fr-sheet-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-fr-sheet-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  border: 0;
  border-radius: 6px;
  background: var(--dsw-color-bg-elevated, #17181d);
}
.dsh-fr-sheet {
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  width: auto;
  min-width: 0;
  border-top: 1px solid var(--dsw-color-border, #29303c);
  border-left: 1px solid var(--dsw-color-border, #29303c);
  font: 13px/26px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--dsw-color-text-primary, #e8eaf0);
}
.dsh-fr-sheet th,
.dsh-fr-sheet td {
  box-sizing: border-box;
  height: 26px;
  padding: 0 8px;
  border-right: 1px solid var(--dsw-color-border, #29303c);
  border-bottom: 1px solid var(--dsw-color-border, #29303c);
  overflow: hidden;
  white-space: pre;
  text-overflow: ellipsis;
  font-weight: 400;
}
.dsh-fr-sheet thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  height: 24px;
  line-height: 24px;
  background: var(--dsw-color-bg-panel, rgba(255,255,255,.04));
  color: var(--dsw-color-text-secondary, #9aa0ad);
  font-size: 11px;
  font-weight: 600;
  text-align: center;
}
.dsh-fr-sheet-corner {
  position: sticky;
  left: 0;
  top: 0;
  z-index: 3;
  width: 44px;
  min-width: 44px;
  background: var(--dsw-color-bg-panel, rgba(255,255,255,.06));
}
.dsh-fr-sheet-colhead { min-width: 0; }
.dsh-fr-sheet-rowhead {
  position: sticky;
  left: 0;
  z-index: 1;
  width: 44px;
  min-width: 44px;
  background: var(--dsw-color-bg-panel, rgba(255,255,255,.04));
  color: var(--dsw-color-text-secondary, #9aa0ad);
  font-size: 11px;
  text-align: center;
}
.dsh-fr-sheet td { background: transparent; }
.dsh-fr-sheet tbody tr:hover td { background: rgba(124,143,255,.06); }
.dsh-fr-sheet td.dsh-fr-sheet-num { text-align: right; font-variant-numeric: tabular-nums; }
.dsh-fr-sheet-colhead.dsh-fr-sheet-head-active,
.dsh-fr-sheet-rowhead.dsh-fr-sheet-head-active {
  background: rgba(124,143,255,.2);
  color: var(--dsw-color-text-primary, #e8eaf0);
}
.dsh-fr-sheet td.dsh-fr-sheet-selected { background: rgba(74,125,255,.13); }
.dsh-fr-sheet td.dsh-fr-sheet-selected-start { box-shadow: inset 0 0 0 2px #4a7dff; }
.dsh-fr-sheet td.dsh-fr-sheet-selected-end { position: relative; }
.dsh-fr-sheet td.dsh-fr-sheet-selected-end::after {
  content: '';
  position: absolute;
  right: 0;
  bottom: 0;
  width: 7px;
  height: 7px;
  border: 1px solid #fff;
  background: #4a7dff;
  pointer-events: none;
}
.dsh-fr-sheet-range {
  position: absolute;
  top: 4px;
  right: 8px;
  z-index: 5;
  padding: 2px 8px;
  border: 1px solid rgba(124,143,255,.45);
  border-radius: 4px;
  background: var(--dsw-color-bg-elevated, #17181d);
  color: var(--dsw-color-text-secondary, #9aa0ad);
  font-size: 11px;
  pointer-events: none;
}
.dsh-fr-preview-error-title {
  color: var(--dsw-color-text-primary, #e8eaf0);
  font-size: 14px;
  font-weight: 600;
}
.dsh-fr-preview-error-hint {
  max-width: 420px;
  color: var(--dsw-color-text-secondary, #9aa0ad);
  line-height: 1.6;
}
.dsh-fr-error-details {
  width: min(100%, 520px);
  text-align: left;
  color: var(--dsw-color-text-tertiary, #7d8492);
  font-size: 11.5px;
}
.dsh-fr-error-details summary { cursor: pointer; }
.dsh-fr-error-details pre {
  max-height: 140px;
  margin: 8px 0 0;
  padding: 8px;
  overflow: auto;
  border: 1px solid var(--dsw-color-border, rgba(255,255,255,.12));
  border-radius: 4px;
  background: rgba(0,0,0,.18);
  white-space: pre-wrap;
  word-break: break-all;
}
.dsh-fr-sheet-note {
  padding: 8px 12px;
  border-top: 1px solid var(--dsw-color-border, rgba(255,255,255,.08));
  color: var(--dsw-color-text-tertiary, #7d8492);
  font-size: 11.5px;
}
.dsh-fr-skeleton {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 28px 24px;
}
.dsh-fr-skeleton-bar,
.dsh-fr-skeleton-block {
  border-radius: 6px;
  background: linear-gradient(
    90deg,
    rgba(255,255,255,.045) 0%,
    rgba(255,255,255,.11) 50%,
    rgba(255,255,255,.045) 100%
  );
  background-size: 200% 100%;
  animation: dsh-fr-shimmer 1.25s ease-in-out infinite;
}
.dsh-fr-skeleton-bar { height: 14px; width: 46%; }
.dsh-fr-skeleton-block { height: 230px; }
.dsh-fr-skeleton-block-short { width: 72%; height: 130px; }
.dsh-fr-skeleton .dsh-fr-preview-state { padding: 4px 0 0; }
.dsh-fr-preview-actions {
  display: inline-flex;
  align-items: center;
  margin-left: 12px;
  vertical-align: middle;
}
@keyframes dsh-fr-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.dsh-fr-sheet-trunc,
.dsh-fr-sheet-confirm {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 8px;
  padding: 8px 12px;
  border: 1px solid rgba(240,180,94,.4);
  border-radius: 6px;
  background: rgba(240,180,94,.09);
  color: #f0b45e;
  font-size: 12.5px;
  line-height: 1.5;
}
.dsh-fr-sheet-trunc span,
.dsh-fr-sheet-confirm span { flex: 1 1 auto; min-width: 0; }
.dsh-fr-sheet-confirm {
  border-color: rgba(124,143,255,.45);
  background: rgba(124,143,255,.1);
  color: var(--dsw-color-text-primary, #e8eaf0);
}
.dsh-fr-sheet td.dsh-fr-sheet-frozen,
.dsh-fr-sheet td.dsh-fr-sheet-frozen-row,
.dsh-fr-sheet th.dsh-fr-sheet-frozen-row {
  background: var(--dsw-color-bg-elevated, #17181d);
}
.dsh-fr-sheet tbody tr:hover td.dsh-fr-sheet-frozen,
.dsh-fr-sheet tbody tr:hover td.dsh-fr-sheet-frozen-row,
.dsh-fr-sheet tbody tr:hover th.dsh-fr-sheet-frozen-row {
  background: #1d2030;
}
.dsh-fr-sheet td.dsh-fr-sheet-frozen-edge {
  box-shadow: inset -2px 0 0 rgba(124,143,255,.55);
}
.dsh-fr-sheet th.dsh-fr-sheet-frozen-row-edge,
.dsh-fr-sheet td.dsh-fr-sheet-frozen-row-edge {
  border-bottom: 2px solid rgba(124,143,255,.7);
}
.dsh-fr-sheet tr.dsh-fr-sheet-spacer,
.dsh-fr-sheet tr.dsh-fr-sheet-spacer td {
  height: auto;
  padding: 0;
  border: 0;
  background: transparent;
}
`;

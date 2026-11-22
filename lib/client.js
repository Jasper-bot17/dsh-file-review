window.__ModuleLoader__.load({
	id: "dsh-file-review",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/client/api.ts
		/** Host 半 HTTP API 客户端（同源 fetch） */
		const BASE = "/plugins/dsh-file-review/api";
		function qs(sessionId, extra) {
			const params = new URLSearchParams();
			if (sessionId) params.set("sessionId", sessionId);
			for (const [key, value] of Object.entries(extra)) if (typeof value === "string" && value.length > 0) params.set(key, value);
			const query = params.toString();
			return query ? `?${query}` : "";
		}
		async function request(url, init) {
			const response = await fetch(`${BASE}${url}`, {
				cache: "no-store",
				credentials: "same-origin",
				...init,
				headers: {
					"content-type": "application/json",
					...init?.headers ?? {}
				}
			});
			let payload = null;
			try {
				payload = await response.json();
			} catch {
				payload = null;
			}
			if (!response.ok) {
				const error = payload?.error;
				throw {
					code: error?.code ?? "HTTP_ERROR",
					message: error?.message ?? `请求失败（HTTP ${response.status}）`,
					status: response.status
				};
			}
			return payload;
		}
		async function listTree(sessionId, dir) {
			return (await request(`/tree${qs(sessionId, { dir })}`)).entries ?? [];
		}
		async function readFile(sessionId, path) {
			return (await request(`/file${qs(sessionId, { path })}`)).file;
		}
		async function statFile(sessionId, path) {
			return (await request(`/stat${qs(sessionId, { path })}`)).stat;
		}
		/** S2 预览元数据：文本 / 图片 / 分页文档（Office、PDF） */
		async function getPreview(sessionId, path, signal) {
			return (await request(`/preview${qs(sessionId, { path })}`, { signal })).preview;
		}
		/** xlsx 单表数据（DOM 表格渲染，文字原生可选）；full=true 走二次确认的「加载全部」 */
		async function getSheet(sessionId, path, sheet, signal, full = false) {
			return (await request(`/sheet${qs(sessionId, {
				path,
				sheet: String(sheet),
				...full ? { full: "1" } : {}
			})}`, { signal })).sheet;
		}
		/** 分页文档第 page 页的 PNG 地址（key 是 Host 侧 sha256，用来固定版本） */
		function renderUrl(sessionId, path, key, page) {
			return `${BASE}/render${qs(sessionId, {
				path,
				key,
				page: String(page)
			})}`;
		}
		/** 图片原文件地址（v 用文件指纹做缓存穿透） */
		function rawUrl(sessionId, path, v) {
			return `${BASE}/raw${qs(sessionId, {
				path,
				v
			})}`;
		}
		/** 分页文档某一页的文字层（透明覆盖在页图上，用于拖选文字） */
		async function getTextLayer(sessionId, path, page, signal) {
			return (await request(`/textlayer${qs(sessionId, {
				path,
				page: String(page)
			})}`, { signal })).textLayer;
		}
		async function saveFile(input) {
			return (await request("/file", {
				method: "PUT",
				body: JSON.stringify(input)
			})).file;
		}
		async function exportAnnotations(input) {
			return (await request("/export", {
				method: "POST",
				body: JSON.stringify(input)
			})).export.path;
		}
		/**
		* 把批注消息发进当前会话。
		* 浏览器侧拿不到会话态（shell.overlay 是 root scope），所以统一交给 Host 半：
		* Host 用官方 sessionController.prompt 以 queue 模式写入会话。
		*/
		async function sendAnnotations(input) {
			return request("/send", {
				method: "POST",
				body: JSON.stringify(input)
			});
		}
		function isApiError(error) {
			return typeof error === "object" && error !== null && "code" in error && "message" in error;
		}
		function formatBytes(bytes) {
			if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
			const units = [
				"B",
				"KB",
				"MB"
			];
			let value = bytes;
			let unit = 0;
			while (value >= 1024 && unit < units.length - 1) {
				value /= 1024;
				unit += 1;
			}
			return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
		}
		// src/client/css.ts
		/** 面板样式：颜色尽量跟随宿主 CSS 变量，取不到时退回深色中性色 */
		const PANEL_CSS = `
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
		// src/client/message.ts
		function trimQuote(quote, max = 300) {
			const clean = quote.replace(/\s+/g, " ").trim();
			if (clean.length <= max) return clean;
			return `${clean.slice(0, max - 1)}…`;
		}
		/** 批注消息是 markdown：路径/原文/意见里的反引号和换行必须转义，避免破坏模板 */
		function escapeMessageText(value) {
			return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\r?\n/g, " ");
		}
		/**
		* 生成发给 AI 的批注消息（S1 模板固定，改动需同步 Design 交互稿）。
		* 2026-11-18 复审补充：每条批注前带行号区间 L<start>-<end>，与批注卡口径一致。
		* 2026-11-20 S2 补充：整页/图片/工作表批注用 label，一律不输出【原文】。
		* 2026-11-20 S3 补充：分页文档文字层批注输出「第N页 【原文】"…"」，与行号批注同构。
		* 2026-11-20 xlsx DOM 表格补充：块批注（工作表/单元格/区域）一律不输出【原文】。
		*/
		function buildAnnotationMessage(options) {
			const { relPath, version, annotations, includePath, includeQuote } = options;
			const lines = ["请按以下批注修改文件：", ""];
			if (includePath) lines.push(`文件：${escapeMessageText(relPath)}（v${version}）`);
			lines.push(`共 ${annotations.length} 条批注`, "");
			annotations.forEach((annotation, index) => {
				const text = escapeMessageText(annotation.text);
				if (annotation.block) lines.push(`${index + 1}. ${escapeMessageText(annotation.block.label)} 【意见】${text}`);
				else if (annotation.page !== void 0) {
					const pageLabel = `第${annotation.page}页`;
					const quote = escapeMessageText(annotation.quote);
					if (includeQuote && quote.trim()) {
						lines.push(`${index + 1}. ${pageLabel} 【原文】"${quote}"`);
						lines.push(`   【意见】${text}`);
					} else lines.push(`${index + 1}. ${pageLabel} 【意见】${text}`);
				} else {
					const range = `L${annotation.from}-${annotation.to}`;
					const quote = escapeMessageText(annotation.quote);
					if (includeQuote) {
						lines.push(`${index + 1}. ${range} 【原文】"${quote}"`);
						lines.push(`   【意见】${text}`);
					} else lines.push(`${index + 1}. ${range} 【意见】${text}`);
				}
				if (index < annotations.length - 1) lines.push("");
			});
			lines.push("", "要求：只改批注涉及的内容，其余保持不变；改完告诉我改了哪几处。");
			return lines.join("\n");
		}
		function formatRelativeTime(timestamp) {
			const diff = Date.now() - timestamp;
			if (diff < 6e4) return "刚刚";
			if (diff < 36e5) return `${Math.floor(diff / 6e4)} 分钟前`;
			if (diff < 864e5) return `${Math.floor(diff / 36e5)} 小时前`;
			return new Date(timestamp).toLocaleDateString("zh-CN");
		}
		// src/client/store.ts
		let snapshot = {
			open: false,
			sessionId: null
		};
		const listeners = /* @__PURE__ */ new Set();
		function emit() {
			for (const listener of listeners) listener();
		}
		function setSnapshot(next) {
			snapshot = next;
			emit();
		}
		function openPanel(sessionId) {
			setSnapshot({
				open: true,
				sessionId: sessionId ? String(sessionId) : snapshot.sessionId
			});
		}
		function closePanel() {
			setSnapshot({
				...snapshot,
				open: false
			});
		}
		function rememberSession(sessionId) {
			if (!sessionId || sessionId === snapshot.sessionId) return;
			setSnapshot({
				...snapshot,
				sessionId: String(sessionId)
			});
		}
		function subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		function getSnapshot() {
			return snapshot;
		}
		function useReviewSnapshot() {
			return (0, react.useSyncExternalStore)(subscribe, getSnapshot);
		}
		let clientCtx = null;
		function bindClientContext(ctx) {
			clientCtx = ctx;
		}
		let inputActions = null;
		function captureInputActions(actions) {
			if (!actions || typeof actions !== "object") return;
			const candidate = actions;
			if (typeof candidate.setDraft !== "function" && typeof candidate.submit !== "function") return;
			inputActions = candidate;
		}
		let diagnostics = {
			leftKeys: [],
			overlayKeys: [],
			captured: false
		};
		function recordSlotProps(slot, props) {
			const keys = props && typeof props === "object" ? Object.keys(props) : [];
			diagnostics = slot === "left" ? {
				...diagnostics,
				leftKeys: keys
			} : {
				...diagnostics,
				overlayKeys: keys
			};
		}
		function getSlotDiagnostics() {
			return {
				...diagnostics,
				captured: inputActions !== null
			};
		}
		/**
		* 解析官方 session/prompt Remote。
		* 客户端未注入 remote 服务时，cordis 的属性访问本身就会抛错，
		* 所以每一次取服务都必须包在 try 里，这里返回 null 而不是抛异常。
		*/
		function resolvePromptApi() {
			const ctx = clientCtx;
			if (!ctx) return null;
			let remote = null;
			try {
				remote = ctx.remote;
			} catch {
				remote = null;
			}
			if (!remote) try {
				remote = ctx.get("remote");
			} catch {
				remote = null;
			}
			const session = remote?.session;
			if (!session || typeof session.prompt !== "function") return null;
			return session;
		}
		/** 还有没有可用的发送通道（Remote 或输入条动作） */
		function canSendToSession() {
			if (inputActions && typeof inputActions.setDraft === "function" && typeof inputActions.submit === "function") return true;
			return resolvePromptApi() !== null;
		}
		/** 兜底：把文本写进输入条草稿并提交，等价于用户手动发送 */
		function sendViaComposer(text) {
			const actions = inputActions;
			if (!actions || typeof actions.setDraft !== "function" || typeof actions.submit !== "function") return false;
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
		async function sendToSession(sessionId, text) {
			const api = resolvePromptApi();
			if (api?.prompt) {
				const controller = new AbortController();
				try {
					await api.prompt({
						requestId: crypto.randomUUID(),
						sessionId,
						mode: "queue",
						content: [{
							type: "text",
							text
						}],
						clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
					}, controller.signal);
					return;
				} catch (error) {
					if (sendViaComposer(text)) return;
					throw error instanceof Error ? error : new Error(String(error));
				}
			}
			if (sendViaComposer(text)) return;
			throw new Error("当前 DSH 版本未暴露 session/prompt，也未捕获输入条动作，请用「复制文本」手动发送");
		}
		// src/client/panel.tsx
		const GEOM_KEY = "dsh-file-review:geometry";
		const MIN_W = 720;
		const MIN_H = 420;
		const POLL_MS = 4e3;
		const SHEET_ROW_HEIGHT = 26;
		const SHEET_HEADER_HEIGHT = 24;
		const SHEET_VIEWPORT_ROWS = 80;
		const SHEET_OVERSCAN = 20;
		const SHEET_VIRTUAL_THRESHOLD = 160;
		function isAbortError(error) {
			return typeof error === "object" && error !== null && error.name === "AbortError";
		}
		/** 错误统一存成 `CODE|message`，UI 按 code 给一句人话，details 里再放原文 */
		function formatUiError(error) {
			if (isApiError(error)) return `${error.code}|${error.message}`;
			return `HTTP_ERROR|${error instanceof Error ? error.message : String(error)}`;
		}
		function splitUiError(value) {
			const [rawCode, ...rest] = (value ?? "").split("|");
			const code = rawCode || "HTTP_ERROR";
			return {
				code,
				message: rest.join("|") || value || "",
				title: {
					ERR_ENCRYPTED_FILE: "文件受密码保护",
					ENCRYPTED: "文件受密码保护",
					ERR_TOO_LARGE: "文件太大，无法预览",
					TOO_LARGE_PREVIEW: "文件太大，无法预览",
					ERR_CONVERT_TIMEOUT: "转换超时",
					RENDER_TIMEOUT: "转换超时",
					TIMEOUT: "转换超时",
					NO_RENDERER: "当前环境缺少 Office 转换组件",
					NO_TEXT_LAYER: "文字层暂不可用",
					CONVERT_FAILED: "Office 文档转换失败",
					UNSAFE_XML: "文件结构不安全，已拒绝解析",
					BAD_XML_ENTITY: "文件结构不合法，已拒绝解析",
					RENDER_FAILED: "页面渲染失败",
					NO_PAGE: "这一页不存在",
					NOT_SHEET: "不是可解析的表格",
					NO_SHEET: "没有这个工作表"
				}[code] ?? "预览失败",
				hint: {
					ERR_ENCRYPTED_FILE: "请先用 Office / PDF 工具解除密码，再回来预览。",
					ENCRYPTED: "请先用 Office / PDF 工具解除密码，再回来预览。",
					ERR_TOO_LARGE: "超过 30MB 的文件不预览，避免页面卡死；可以换小一点的文件。",
					TOO_LARGE_PREVIEW: "超过 30MB 的文件不预览，避免页面卡死；可以换小一点的文件。",
					ERR_CONVERT_TIMEOUT: "转换时间过长，已停止；可以点重试，或换一个文件。",
					RENDER_TIMEOUT: "转换时间过长，已停止；可以点重试，或换一个文件。",
					TIMEOUT: "转换时间过长，已停止；可以点重试，或换一个文件。",
					NO_RENDERER: "宿主里没有找到 LibreOffice Kit，请把环境信息发给维护者。",
					NO_TEXT_LAYER: "文字层组件加载失败；预览和整页批注仍可用，可以点重试。",
					CONVERT_FAILED: "文件可能已损坏，或格式不受支持；可以点重试。",
					UNSAFE_XML: "文件里有外部实体/DOCTYPE，出于安全考虑不解析。",
					BAD_XML_ENTITY: "文件里有超出 Unicode 范围的字符实体；可能不是真正的 Office 文件。"
				}[code] ?? "文件可能已损坏、受密码保护，或格式暂不支持。可以重试，或换一个文件。"
			};
		}
		function loadGeometry() {
			const fallback = () => {
				const w = Math.min(1240, Math.max(MIN_W, window.innerWidth - 96));
				const h = Math.min(780, Math.max(MIN_H, window.innerHeight - 96));
				return {
					x: Math.max(24, Math.round((window.innerWidth - w) / 2)),
					y: Math.max(24, Math.round((window.innerHeight - h) / 2)),
					w,
					h
				};
			};
			try {
				const raw = localStorage.getItem(GEOM_KEY);
				if (!raw) return fallback();
				const parsed = JSON.parse(raw);
				if (typeof parsed.x !== "number" || typeof parsed.y !== "number" || typeof parsed.w !== "number" || typeof parsed.h !== "number") return fallback();
				return {
					x: parsed.x,
					y: parsed.y,
					w: Math.max(MIN_W, parsed.w),
					h: Math.max(MIN_H, parsed.h)
				};
			} catch {
				return fallback();
			}
		}
		/** 给预览区的每一行加上 md 风格 class（文本原样保留，便于行号锚点与批注定位） */
		function decorateLines(content) {
			const lines = content.split("\n");
			const result = [];
			let inFence = false;
			for (const text of lines) {
				const trimmed = text.trim();
				let cls = "";
				if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
					inFence = !inFence;
					cls = " dsh-fr-code";
				} else if (inFence) cls = " dsh-fr-code";
				else if (/^#{1}\s/.test(trimmed)) cls = " dsh-fr-h1";
				else if (/^#{2}\s/.test(trimmed)) cls = " dsh-fr-h2";
				else if (/^#{3,6}\s/.test(trimmed)) cls = " dsh-fr-h3";
				result.push({
					text,
					cls
				});
			}
			return result;
		}
		function lineNumberOf(node) {
			if (!node) return null;
			const line = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest("[data-line]");
			if (!line) return null;
			const value = Number(line.getAttribute("data-line"));
			return Number.isFinite(value) ? value : null;
		}
		function elementOf(node) {
			if (!node) return null;
			return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
		}
		function columnLabel(index) {
			let value = index;
			let label = "";
			while (value > 0) {
				const remainder = (value - 1) % 26;
				label = String.fromCharCode(65 + remainder) + label;
				value = Math.floor((value - 1) / 26);
			}
			return label;
		}
		/** 卡片 footer 只放类型短标签：首行已显示具体 label，footer 再拼一遍会重复且挤按钮 */
		function annotationKindLabel(annotation) {
			if (annotation.block) {
				if (annotation.block.label === "图片") return "整图";
				if (annotation.block.label.startsWith("第")) return "整页";
				return "区域";
			}
			if (annotation.page !== void 0) return `第${annotation.page}页 · 选中文字`;
			return `L${annotation.from}${annotation.from === annotation.to ? "" : `-${annotation.to}`}`;
		}
		function parseCellRef(ref) {
			const match = /^([A-Za-z]+)(\d+)$/.exec(ref.trim());
			if (!match) return null;
			let col = 0;
			for (const letter of (match[1] ?? "").toUpperCase()) col = col * 26 + (letter.charCodeAt(0) - 64);
			const row = Number.parseInt(match[2] ?? "", 10);
			return Number.isInteger(col) && Number.isInteger(row) && col > 0 && row > 0 ? {
				row,
				col
			} : null;
		}
		function useInjectedStyle() {
			(0, react.useEffect)(() => {
				const id = "dsh-file-review-style";
				if (document.getElementById(id)) return;
				const style = document.createElement("style");
				style.id = id;
				style.dataset.dshPlugin = "dsh-file-review";
				style.textContent = PANEL_CSS;
				document.head.appendChild(style);
			}, []);
		}
		function FileReviewPanel() {
			useInjectedStyle();
			const snapshot = useReviewSnapshot();
			const sessionId = snapshot.sessionId;
			const [geometry, setGeometry] = (0, react.useState)(() => loadGeometry());
			const [rootEntries, setRootEntries] = (0, react.useState)([]);
			const [rootLoading, setRootLoading] = (0, react.useState)(false);
			const [dirs, setDirs] = (0, react.useState)({});
			const [activePath, setActivePath] = (0, react.useState)(null);
			const [file, setFile] = (0, react.useState)(null);
			const [fileLoading, setFileLoading] = (0, react.useState)(false);
			const [mode, setMode] = (0, react.useState)("preview");
			const [draft, setDraft] = (0, react.useState)("");
			const [dirty, setDirty] = (0, react.useState)(false);
			const [versions, setVersions] = (0, react.useState)({});
			const [annotations, setAnnotations] = (0, react.useState)([]);
			const [composer, setComposer] = (0, react.useState)(null);
			const [composerText, setComposerText] = (0, react.useState)("");
			const [sendOpen, setSendOpen] = (0, react.useState)(false);
			const [sendIncludePath, setSendIncludePath] = (0, react.useState)(true);
			const [sendIncludeQuote, setSendIncludeQuote] = (0, react.useState)(true);
			const [toast, setToast] = (0, react.useState)(null);
			const [banner, setBanner] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [preview, setPreview] = (0, react.useState)(null);
			const [previewLoading, setPreviewLoading] = (0, react.useState)(false);
			const [previewError, setPreviewError] = (0, react.useState)(null);
			const [previewCancelled, setPreviewCancelled] = (0, react.useState)(false);
			const [pageIndex, setPageIndex] = (0, react.useState)(1);
			const [zoom, setZoom] = (0, react.useState)(1);
			const [textLayer, setTextLayer] = (0, react.useState)(null);
			const [textLayerLoading, setTextLayerLoading] = (0, react.useState)(false);
			const [textLayerError, setTextLayerError] = (0, react.useState)(null);
			const [sheet, setSheet] = (0, react.useState)(null);
			const [sheetLoading, setSheetLoading] = (0, react.useState)(false);
			const [sheetError, setSheetError] = (0, react.useState)(null);
			const [sheetCancelled, setSheetCancelled] = (0, react.useState)(false);
			const [sheetIndex, setSheetIndex] = (0, react.useState)(0);
			const [sheetSel, setSheetSel] = (0, react.useState)(null);
			const [sheetWindow, setSheetWindow] = (0, react.useState)({
				start: 0,
				end: SHEET_VIEWPORT_ROWS
			});
			const [sheetFull, setSheetFull] = (0, react.useState)(false);
			const [fullConfirmOpen, setFullConfirmOpen] = (0, react.useState)(false);
			const rootRef = (0, react.useRef)(null);
			const contentRef = (0, react.useRef)(null);
			const sheetScrollRef = (0, react.useRef)(null);
			const previewAbort = (0, react.useRef)(null);
			const textLayerAbort = (0, react.useRef)(null);
			const sheetAbort = (0, react.useRef)(null);
			const toastTimer = (0, react.useRef)(null);
			const previewToken = (0, react.useRef)(0);
			const textLayerToken = (0, react.useRef)(0);
			const textLayerCache = (0, react.useRef)(/* @__PURE__ */ new Map());
			const sheetToken = (0, react.useRef)(0);
			const sheetCache = (0, react.useRef)(/* @__PURE__ */ new Map());
			const sheetDragging = (0, react.useRef)(false);
			const showToast = (0, react.useCallback)((text) => {
				setToast(text);
				if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
				toastTimer.current = window.setTimeout(() => setToast(null), 2800);
			}, []);
			(0, react.useEffect)(() => {
				try {
					localStorage.setItem(GEOM_KEY, JSON.stringify(geometry));
				} catch {}
			}, [geometry]);
			const refreshRoot = (0, react.useCallback)(async () => {
				if (!snapshot.open) return;
				setRootLoading(true);
				try {
					const entries = await listTree(sessionId, "");
					setRootEntries(entries);
				} catch (error) {
					showToast(`读取目录失败：${isApiError(error) ? error.message : String(error)}`);
				} finally {
					setRootLoading(false);
				}
			}, [
				sessionId,
				snapshot.open,
				showToast
			]);
			(0, react.useEffect)(() => {
				if (!snapshot.open) return;
				refreshRoot();
			}, [snapshot.open, refreshRoot]);
			const loadDirs = (0, react.useCallback)(async (dir) => {
				setDirs((previous) => ({
					...previous,
					[dir]: previous[dir] ?? {
						expanded: false,
						loaded: false,
						loading: false,
						entries: []
					}
				}));
				const state = dirs[dir];
				if (state?.loaded || state?.loading) return;
				setDirs((previous) => ({
					...previous,
					[dir]: {
						...previous[dir] ?? {
							expanded: true,
							loaded: false,
							loading: false,
							entries: []
						},
						loading: true
					}
				}));
				try {
					const entries = await listTree(sessionId, dir);
					setDirs((previous) => ({
						...previous,
						[dir]: {
							...previous[dir] ?? {
								expanded: true,
								loaded: false,
								loading: false,
								entries: []
							},
							loaded: true,
							loading: false,
							entries
						}
					}));
				} catch (error) {
					showToast(`读取目录失败：${isApiError(error) ? error.message : String(error)}`);
					setDirs((previous) => ({
						...previous,
						[dir]: {
							...previous[dir] ?? {
								expanded: true,
								loaded: false,
								loading: false,
								entries: []
							},
							loading: false
						}
					}));
				}
			}, [
				dirs,
				sessionId,
				showToast
			]);
			const toggleDir = (0, react.useCallback)((dir) => {
				const state = dirs[dir];
				if (state?.expanded) {
					setDirs((previous) => ({
						...previous,
						[dir]: {
							...previous[dir],
							expanded: false
						}
					}));
					return;
				}
				setDirs((previous) => ({
					...previous,
					[dir]: {
						...previous[dir] ?? {
							loaded: false,
							loading: false,
							entries: []
						},
						expanded: true
					}
				}));
				if (!state?.loaded) loadDirs(dir);
			}, [dirs, loadDirs]);
			const loadPreview = (0, react.useCallback)(async (meta) => {
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
				setSheetWindow({
					start: 0,
					end: SHEET_VIEWPORT_ROWS
				});
				setPageIndex(1);
				setZoom(1);
				if (meta.previewKind === "text") {
					setPreviewLoading(false);
					return;
				}
				if (meta.previewKind === "unsupported") {
					setPreviewLoading(false);
					setPreviewError("UNSUPPORTED_PREVIEW|该格式暂不支持预览（支持 docx / xlsx / pptx / pdf / 图片）");
					return;
				}
				setPreviewLoading(true);
				try {
					const info = await getPreview(sessionId, meta.path, controller.signal);
					if (token !== previewToken.current) return;
					setPreview(info);
					setPageIndex(info.pages?.[0]?.index ?? 1);
					if (info.kind === "sheet") setSheetIndex(info.active ?? 0);
				} catch (error) {
					if (token !== previewToken.current || isAbortError(error)) return;
					setPreviewError(formatUiError(error));
				} finally {
					if (token === previewToken.current) setPreviewLoading(false);
				}
			}, [sessionId]);
			const loadTextLayer = (0, react.useCallback)(async (meta, page) => {
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
						if (typeof oldest === "string") textLayerCache.current.delete(oldest);
					}
					setTextLayer(layer);
				} catch (error) {
					if (token !== textLayerToken.current || isAbortError(error)) return;
					setTextLayerError(formatUiError(error));
				} finally {
					if (token === textLayerToken.current) setTextLayerLoading(false);
				}
			}, [sessionId]);
			const loadSheet = (0, react.useCallback)(async (meta, index, full = false) => {
				const token = ++sheetToken.current;
				sheetAbort.current?.abort();
				const controller = new AbortController();
				sheetAbort.current = controller;
				const cacheKey = `${meta.path}:${meta.sha1}:${index}${full ? ":full" : ""}`;
				const cached = sheetCache.current.get(cacheKey);
				if (cached) {
					setSheet(cached);
					setSheetError(null);
					setSheetCancelled(false);
					setSheetLoading(false);
					setSheetFull(full);
					setFullConfirmOpen(false);
					setSheetWindow({
						start: 0,
						end: SHEET_VIEWPORT_ROWS
					});
					return;
				}
				setSheet(null);
				setSheetError(null);
				setSheetCancelled(false);
				setSheetLoading(true);
				setSheetFull(full);
				setFullConfirmOpen(false);
				setSheetWindow({
					start: 0,
					end: SHEET_VIEWPORT_ROWS
				});
				let timer;
				const timeoutSeconds = full ? 60 : 20;
				try {
					const data = await Promise.race([getSheet(sessionId, meta.path, index, controller.signal, full), new Promise((_, reject) => {
						timer = window.setTimeout(() => reject(/* @__PURE__ */ new Error(`SHEET_TIMEOUT:${timeoutSeconds}`)), timeoutSeconds * 1e3);
					})]);
					if (token !== sheetToken.current) return;
					sheetCache.current.set(cacheKey, data);
					if (sheetCache.current.size > 8) {
						const oldest = sheetCache.current.keys().next().value;
						if (typeof oldest === "string") sheetCache.current.delete(oldest);
					}
					setSheet(data);
				} catch (error) {
					if (token !== sheetToken.current || isAbortError(error)) return;
					if (error instanceof Error && error.message.startsWith("SHEET_TIMEOUT:")) {
						controller.abort();
						const seconds = error.message.split(":")[1] ?? String(timeoutSeconds);
						setSheetError(`ERR_CONVERT_TIMEOUT|表格解析超过 ${seconds} 秒，请重试`);
					} else setSheetError(formatUiError(error));
				} finally {
					if (timer !== void 0) window.clearTimeout(timer);
					if (token === sheetToken.current) setSheetLoading(false);
				}
			}, [sessionId]);
			const loadFile = (0, react.useCallback)(async (relativePath) => {
				setFileLoading(true);
				setComposer(null);
				setSendOpen(false);
				try {
					const next = await readFile(sessionId, relativePath);
					setFile(next);
					setDraft(next.content);
					setDirty(false);
					setMode("preview");
					setBanner(null);
					setVersions((previous) => ({
						...previous,
						[next.path]: previous[next.path] ?? 1
					}));
					loadPreview(next);
					setAnnotations((previous) => previous.map((annotation) => annotation.path === next.path && annotation.fileSha1 && annotation.fileSha1 !== next.sha1 && annotation.status === "open" ? {
						...annotation,
						status: "stale"
					} : annotation));
				} catch (error) {
					setFile(null);
					showToast(`打开文件失败：${isApiError(error) ? error.message : String(error)}`);
				} finally {
					setFileLoading(false);
				}
			}, [
				loadPreview,
				sessionId,
				showToast
			]);
			(0, react.useEffect)(() => {
				if (!snapshot.open || !activePath) return;
				if (file?.path === activePath) return;
				loadFile(activePath);
			}, [
				activePath,
				snapshot.open,
				file?.path,
				loadFile
			]);
			(0, react.useEffect)(() => {
				if (snapshot.open) return;
				previewAbort.current?.abort();
				textLayerAbort.current?.abort();
				sheetAbort.current?.abort();
				textLayerCache.current.clear();
				sheetCache.current.clear();
			}, [snapshot.open]);
			(0, react.useEffect)(() => () => {
				previewAbort.current?.abort();
				textLayerAbort.current?.abort();
				sheetAbort.current?.abort();
			}, []);
			(0, react.useEffect)(() => {
				if (!snapshot.open || !file) return;
				const timer = window.setInterval(async () => {
					try {
						if ((await statFile(sessionId, file.path)).sha1 !== file.sha1) setBanner(dirty ? "conflict" : "external");
						else setBanner(null);
					} catch {}
				}, POLL_MS);
				return () => window.clearInterval(timer);
			}, [
				snapshot.open,
				file,
				dirty,
				sessionId
			]);
			const requestClose = (0, react.useCallback)(() => {
				if (dirty && !window.confirm("有未保存的修改，关闭后丢失，确定关闭？")) return;
				setComposer(null);
				setSendOpen(false);
				closePanel();
			}, [dirty]);
			const refreshCurrent = (0, react.useCallback)(async () => {
				if (!file) return;
				if (dirty && !window.confirm("有未保存的修改，刷新会丢失，继续？")) return;
				const next = await readFile(sessionId, file.path).catch((error) => {
					showToast(`刷新失败：${isApiError(error) ? error.message : String(error)}`);
					return null;
				});
				if (!next) return;
				setFile(next);
				setDraft(next.content);
				setDirty(false);
				setBanner(null);
				loadPreview(next);
				setAnnotations((previous) => previous.map((annotation) => annotation.path === next.path && annotation.status === "open" ? {
					...annotation,
					status: "open"
				} : annotation));
				showToast("已刷新到最新版本");
			}, [
				dirty,
				file,
				loadPreview,
				sessionId,
				showToast
			]);
			const activeAnnotations = (0, react.useMemo)(() => file ? annotations.filter((annotation) => annotation.path === file.path) : [], [annotations, file]);
			const openAnnotations = (0, react.useMemo)(() => activeAnnotations.filter((annotation) => annotation.status === "open"), [activeAnnotations]);
			const markedLines = (0, react.useMemo)(() => {
				const lines = /* @__PURE__ */ new Set();
				for (const annotation of openAnnotations) {
					if (annotation.block || annotation.page !== void 0) continue;
					for (let line = annotation.from; line <= annotation.to; line += 1) lines.add(line);
				}
				return lines;
			}, [openAnnotations]);
			const decorated = (0, react.useMemo)(() => file ? decorateLines(file.content) : [], [file]);
			const version = file ? versions[file.path] ?? 1 : 1;
			const previewPages = preview?.pages ?? [];
			const currentPage = previewPages.find((page) => page.index === pageIndex) ?? previewPages[0];
			const pagePosition = Math.max(0, previewPages.findIndex((page) => page.index === (currentPage?.index ?? 0)));
			const blockTarget = (0, react.useMemo)(() => {
				if (preview?.kind === "image") return {
					page: 1,
					label: "图片"
				};
				if (preview?.kind === "sheet") {
					const name = sheet?.name ?? preview.sheets?.find((item) => item.index === sheetIndex)?.name ?? "表格";
					return {
						page: sheetIndex + 1,
						label: `工作表「${name}」`,
						sheet: name
					};
				}
				if (!currentPage) return null;
				return {
					page: currentPage.index,
					label: currentPage.label,
					...currentPage.sheet ? { sheet: currentPage.sheet } : {},
					...currentPage.range ? { range: currentPage.range } : {}
				};
			}, [
				currentPage,
				preview?.kind,
				preview?.sheets,
				sheet,
				sheetIndex
			]);
			const sheetCellMap = (0, react.useMemo)(() => {
				const map = /* @__PURE__ */ new Map();
				for (const cell of sheet?.cells ?? []) map.set(`${cell.row}:${cell.col}`, cell);
				return map;
			}, [sheet]);
			const sheetMerges = (0, react.useMemo)(() => {
				const spans = /* @__PURE__ */ new Map();
				const covered = /* @__PURE__ */ new Set();
				for (const ref of sheet?.merges ?? []) {
					const [startRef, endRef] = ref.split(":");
					const start = parseCellRef(startRef ?? "");
					const end = parseCellRef(endRef ?? startRef ?? "");
					if (!start || !end || end.row < start.row || end.col < start.col) continue;
					spans.set(`${start.row}:${start.col}`, {
						rowSpan: end.row - start.row + 1,
						colSpan: end.col - start.col + 1
					});
					for (let row = start.row; row <= end.row; row += 1) for (let col = start.col; col <= end.col; col += 1) if (row !== start.row || col !== start.col) covered.add(`${row}:${col}`);
				}
				return {
					spans,
					covered
				};
			}, [sheet]);
			const sheetSelection = (0, react.useMemo)(() => {
				if (preview?.kind !== "sheet") return null;
				if (sheetSel) return {
					fromRow: Math.min(sheetSel.anchorRow, sheetSel.focusRow),
					toRow: Math.max(sheetSel.anchorRow, sheetSel.focusRow),
					fromCol: Math.min(sheetSel.anchorCol, sheetSel.focusCol),
					toCol: Math.max(sheetSel.anchorCol, sheetSel.focusCol)
				};
				if (!composer?.block?.range || composer.block.sheet !== sheet?.name) return null;
				const [startRefRaw, endRefRaw] = composer.block.range.split(":");
				const start = parseCellRef(startRefRaw ?? "");
				const end = parseCellRef(endRefRaw ?? startRefRaw ?? "");
				if (!start || !end) return null;
				return {
					fromRow: Math.min(start.row, end.row),
					toRow: Math.max(start.row, end.row),
					fromCol: Math.min(start.col, end.col),
					toCol: Math.max(start.col, end.col)
				};
			}, [
				composer,
				preview?.kind,
				sheet?.name,
				sheetSel
			]);
			const sheetColumnWidths = (0, react.useMemo)(() => Array.from({ length: sheet?.colCount ?? 0 }, (_, index) => sheet?.columns[index] ?? 96), [sheet]);
			const sheetTableWidth = (0, react.useMemo)(() => 44 + sheetColumnWidths.reduce((sum, width) => sum + width, 0), [sheetColumnWidths]);
			const sheetFrozenRows = Math.min(sheet?.frozen?.rows ?? 0, sheet?.rowCount ?? 0);
			const sheetFrozenCols = Math.min(sheet?.frozen?.cols ?? 0, sheet?.colCount ?? 0);
			const sheetVirtual = (sheet?.rowCount ?? 0) > SHEET_VIRTUAL_THRESHOLD;
			const sheetFrozenRowsData = (0, react.useMemo)(() => sheet ? sheet.rows.slice(0, sheetFrozenRows) : [], [sheet, sheetFrozenRows]);
			const sheetRowOffsets = (0, react.useMemo)(() => {
				const rowCount = sheet?.rowCount ?? 0;
				const offsets = new Array(rowCount + 1);
				offsets[0] = 0;
				for (let index = 0; index < rowCount; index += 1) offsets[index + 1] = (offsets[index] ?? 0) + (sheet?.rows[index]?.height ?? SHEET_ROW_HEIGHT);
				return offsets;
			}, [sheet]);
			const sheetTotalHeight = sheetRowOffsets[sheetRowOffsets.length - 1] ?? 0;
			const sheetWindowStart = Math.min(Math.max(sheetWindow.start, sheetFrozenRows), sheet?.rowCount ?? 0);
			const sheetWindowEnd = Math.min(Math.max(sheetWindow.end, sheetWindowStart + (sheetVirtual ? 1 : sheet?.rowCount ?? 0)), sheet?.rowCount ?? 0);
			const sheetWindowRowsData = (0, react.useMemo)(() => {
				if (!sheet) return [];
				if (!sheetVirtual) return sheet.rows.slice(sheetFrozenRows);
				return sheet.rows.slice(sheetWindowStart, sheetWindowEnd);
			}, [
				sheet,
				sheetVirtual,
				sheetFrozenRows,
				sheetWindowStart,
				sheetWindowEnd
			]);
			const sheetTopSpacerHeight = sheetVirtual ? Math.max(0, (sheetRowOffsets[sheetWindowStart] ?? 0) - (sheetRowOffsets[sheetFrozenRows] ?? 0)) : 0;
			const sheetBottomSpacerHeight = sheetVirtual ? Math.max(0, sheetTotalHeight - (sheetRowOffsets[sheetWindowEnd] ?? 0)) : 0;
			const sheetFrozenLeft = (0, react.useMemo)(() => {
				const lefts = [44];
				for (const width of sheetColumnWidths) lefts.push((lefts[lefts.length - 1] ?? 44) + width);
				return lefts;
			}, [sheetColumnWidths]);
			const onSheetScroll = (0, react.useCallback)(() => {
				if (!sheet || !sheetVirtual) return;
				const element = sheetScrollRef.current;
				if (!element) return;
				const rowCount = sheet.rowCount;
				if (rowCount <= 0) return;
				const findRowAt = (target) => {
					let low = 0;
					let high = rowCount - 1;
					while (low < high) {
						const middle = low + high >> 1;
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
				setSheetWindow((previous) => previous.start === start && previous.end === end ? previous : {
					start,
					end
				});
			}, [
				sheet,
				sheetVirtual,
				sheetRowOffsets
			]);
			const sheetSelectionLabel = (0, react.useMemo)(() => {
				if (!sheetSelection || !sheet || preview?.kind !== "sheet") return null;
				const fromRef = `${columnLabel(sheetSelection.fromCol)}${sheetSelection.fromRow}`;
				const toRef = `${columnLabel(sheetSelection.toCol)}${sheetSelection.toRow}`;
				return `工作表「${sheet.name}」 ${fromRef === toRef ? fromRef : `${fromRef}:${toRef}`}`;
			}, [
				preview?.kind,
				sheet,
				sheetSelection
			]);
			const previewUiError = (0, react.useMemo)(() => previewError ? splitUiError(previewError) : null, [previewError]);
			const sheetUiError = (0, react.useMemo)(() => sheetError ? splitUiError(sheetError) : null, [sheetError]);
			const sheetFrozenTops = (0, react.useMemo)(() => {
				const tops = /* @__PURE__ */ new Map();
				for (const row of sheetFrozenRowsData) tops.set(row.index, SHEET_HEADER_HEIGHT + (sheetRowOffsets[row.index - 1] ?? 0));
				return tops;
			}, [sheetFrozenRowsData, sheetRowOffsets]);
			/** 表格行渲染：冻结行/冻结列都走 sticky，角格同时固定 top+left */
			const renderSheetRow = (row, frozenRow) => {
				if (!sheet) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, {});
				const selection = sheetSelection;
				const frozenTop = frozenRow ? sheetFrozenTops.get(row.index) ?? SHEET_HEADER_HEIGHT : null;
				const rowSelected = Boolean(selection) && row.index >= selection.fromRow && row.index <= selection.toRow;
				const frozenRowEdge = frozenRow && row.index === sheetFrozenRows;
				const stickyStyle = (col) => {
					const frozenCell = col !== void 0 && col <= sheetFrozenCols;
					if (!frozenRow && !frozenCell) return void 0;
					const style = { position: "sticky" };
					if (frozenTop !== null) style.top = `${frozenTop}px`;
					if (col !== void 0 && frozenCell) style.left = `${sheetFrozenLeft[col - 1] ?? 44}px`;
					style.zIndex = frozenRow && frozenCell ? 6 : frozenRow ? 2 : 3;
					return style;
				};
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
					style: row.height ? { height: `${row.height}px` } : void 0,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
						className: `dsh-fr-sheet-rowhead${rowSelected ? " dsh-fr-sheet-head-active" : ""}${frozenRow ? " dsh-fr-sheet-frozen-row" : ""}${frozenRowEdge ? " dsh-fr-sheet-frozen-row-edge" : ""}`,
						style: {
							position: "sticky",
							left: 0,
							...frozenTop !== null ? { top: `${frozenTop}px` } : {},
							zIndex: frozenRow ? 7 : 1
						},
						children: row.index
					}), Array.from({ length: sheet.colCount }, (_, index) => {
						const col = index + 1;
						const key = `${row.index}:${col}`;
						if (sheetMerges.covered.has(key)) return null;
						const cell = sheetCellMap.get(key);
						const span = sheetMerges.spans.get(key);
						const cellRef = cell?.ref ?? `${columnLabel(col)}${row.index}`;
						const cellPos = parseCellRef(cellRef);
						const selected = Boolean(selection) && row.index >= selection.fromRow && row.index <= selection.toRow && col >= selection.fromCol && col <= selection.toCol;
						const selectedStart = selected && row.index === selection.fromRow && col === selection.fromCol;
						const selectedEnd = selected && row.index === selection.toRow && col === selection.toCol;
						const frozenCell = col <= sheetFrozenCols;
						const cellClass = [
							cell?.kind === "number" ? "dsh-fr-sheet-num" : "",
							selected ? "dsh-fr-sheet-selected" : "",
							selectedStart ? "dsh-fr-sheet-selected-start" : "",
							selectedEnd ? "dsh-fr-sheet-selected-end" : "",
							frozenCell ? "dsh-fr-sheet-frozen" : "",
							frozenCell && col === sheetFrozenCols ? "dsh-fr-sheet-frozen-edge" : "",
							frozenRow ? "dsh-fr-sheet-frozen-row" : "",
							frozenRowEdge ? "dsh-fr-sheet-frozen-row-edge" : ""
						].filter(Boolean).join(" ");
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
							"data-cell": cellRef,
							className: cellClass || void 0,
							colSpan: span?.colSpan,
							rowSpan: span?.rowSpan,
							style: stickyStyle(col),
							onMouseDown: (event) => {
								if (event.button !== 0 || !cellPos) return;
								sheetDragging.current = true;
								setSheetSel({
									anchorRow: cellPos.row,
									anchorCol: cellPos.col,
									focusRow: cellPos.row,
									focusCol: cellPos.col
								});
							},
							onMouseEnter: () => {
								if (!sheetDragging.current || !cellPos) return;
								setSheetSel((previous) => previous ? {
									...previous,
									focusRow: cellPos.row,
									focusCol: cellPos.col
								} : previous);
							},
							children: cell?.text ?? ""
						}, col);
					})]
				}, row.index);
			};
			(0, react.useEffect)(() => {
				if (!file || preview?.kind !== "pages" || !currentPage) {
					setTextLayer(null);
					setTextLayerError(null);
					setTextLayerLoading(false);
					return;
				}
				loadTextLayer(file, currentPage);
			}, [
				currentPage?.index,
				file?.path,
				file?.sha1,
				loadTextLayer,
				preview?.kind
			]);
			(0, react.useEffect)(() => {
				setSheetSel(null);
				sheetDragging.current = false;
				if (!file || preview?.kind !== "sheet") {
					setSheet(null);
					setSheetError(null);
					setSheetLoading(false);
					return;
				}
				loadSheet(file, sheetIndex);
			}, [
				file?.path,
				file?.sha1,
				loadSheet,
				preview?.kind,
				sheetIndex
			]);
			(0, react.useEffect)(() => {
				if (preview?.kind !== "pages" || !currentPage) return;
				const width = contentRef.current?.clientWidth ?? 0;
				if (width <= 0) return;
				const fit = Math.round((width - 48) / currentPage.width * 100) / 100;
				setZoom(Math.min(1, Math.max(.4, fit)));
			}, [
				currentPage?.index,
				currentPage?.width,
				geometry.w,
				preview?.kind
			]);
			const handleSelection = (0, react.useCallback)(() => {
				if (!file || mode === "edit") return;
				const selection = window.getSelection();
				if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
				const text = selection.toString();
				if (text.trim().length < 2) return;
				const range = selection.getRangeAt(0);
				const root = rootRef.current;
				if (!root) return;
				let next = null;
				if (file.text) {
					const from = lineNumberOf(range.startContainer);
					const to = lineNumberOf(range.endContainer);
					if (!from || !to) return;
					next = {
						x: 0,
						y: 0,
						from: Math.min(from, to),
						to: Math.max(from, to),
						quote: trimQuote(text)
					};
				} else if (preview?.kind === "pages" && currentPage) {
					const start = range.startContainer;
					if (!(start.nodeType === Node.ELEMENT_NODE ? start : start.parentElement)?.closest(".dsh-fr-textlayer")) return;
					next = {
						x: 0,
						y: 0,
						from: currentPage.index,
						to: currentPage.index,
						quote: trimQuote(text),
						page: currentPage.index,
						pageLabel: currentPage.label
					};
				} else if (preview?.kind === "sheet" && sheet) {
					const startElement = elementOf(range.startContainer);
					const endElement = elementOf(range.endContainer);
					if (!startElement?.closest(".dsh-fr-sheet")) return;
					const startCell = startElement.closest("[data-cell]")?.getAttribute("data-cell") ?? "";
					const endCell = endElement?.closest("[data-cell]")?.getAttribute("data-cell") ?? startCell;
					const cellRange = startCell ? endCell && endCell !== startCell ? `${startCell}:${endCell}` : startCell : "";
					const startPos = parseCellRef(startCell);
					const endPos = parseCellRef(endCell || startCell);
					if (startPos && endPos) setSheetSel({
						anchorRow: startPos.row,
						anchorCol: startPos.col,
						focusRow: endPos.row,
						focusCol: endPos.col
					});
					const label = `工作表「${sheet.name}」${cellRange ? ` ${cellRange}` : ""}`;
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
							...cellRange ? { range: cellRange } : {},
							selected: true
						}
					};
				}
				if (!next) return;
				const rootRect = root.getBoundingClientRect();
				const rect = range.getBoundingClientRect();
				setComposer({
					...next,
					x: Math.max(12, Math.min(rootRect.width - 320, rect.left - rootRect.left - 20)),
					y: Math.max(60, Math.min(rootRect.height - 300, rect.bottom - rootRect.top + 8))
				});
				setComposerText("");
				selection.removeAllRanges();
			}, [
				currentPage,
				file,
				mode,
				preview?.kind,
				sheet
			]);
			const addAnnotation = (0, react.useCallback)(() => {
				if (!file || !composer) return;
				const text = composerText.trim();
				if (!text) {
					showToast("先写一句批注意见");
					return;
				}
				const annotation = {
					id: crypto.randomUUID(),
					path: file.path,
					fileSha1: file.sha1,
					from: composer.from,
					to: composer.to,
					quote: composer.quote,
					text,
					status: "open",
					createdAt: Date.now(),
					...composer.block ? { block: composer.block } : {},
					...composer.page !== void 0 ? { page: composer.page } : {}
				};
				setAnnotations((previous) => [...previous, annotation]);
				setComposer(null);
				setComposerText("");
				showToast("已添加批注");
			}, [
				composer,
				composerText,
				file,
				showToast
			]);
			const addBlockAnnotation = (0, react.useCallback)(() => {
				if (!file || !blockTarget) return;
				setComposer({
					x: 24,
					y: 104,
					from: blockTarget.page,
					to: blockTarget.page,
					quote: blockTarget.label,
					block: blockTarget
				});
				setComposerText("");
			}, [blockTarget, file]);
			const save = (0, react.useCallback)(async () => {
				if (!file || busy) return;
				setBusy(true);
				try {
					const saved = await saveFile({
						sessionId,
						path: file.path,
						content: draft,
						baseSha1: file.sha1
					});
					setFile({
						...file,
						content: draft,
						sha1: saved.sha1,
						size: saved.size,
						mtimeMs: saved.mtimeMs
					});
					setDirty(false);
					setBanner(null);
					setVersions((previous) => ({
						...previous,
						[file.path]: (previous[file.path] ?? 1) + 1
					}));
					showToast(`已保存 v${(versions[file.path] ?? 1) + 1}（原文件备份为 .bak）`);
				} catch (error) {
					if (isApiError(error) && error.code === "CONFLICT") {
						setBanner("conflict");
						showToast("文件已被外部修改，请先刷新");
					} else showToast(`保存失败：${isApiError(error) ? error.message : String(error)}`);
				} finally {
					setBusy(false);
				}
			}, [
				busy,
				draft,
				file,
				sessionId,
				showToast,
				versions
			]);
			const jumpTo = (0, react.useCallback)((annotation) => {
				if (annotation.block) {
					if (preview?.kind === "sheet") {
						setSheetIndex(Math.max(0, annotation.block.page - 1));
						const [startRef, endRef] = (annotation.block.range ?? "").split(":");
						const start = parseCellRef(startRef ?? "");
						const end = parseCellRef(endRef ?? startRef ?? "");
						setSheetSel(start && end ? {
							anchorRow: start.row,
							anchorCol: start.col,
							focusRow: end.row,
							focusCol: end.col
						} : null);
					} else setPageIndex(annotation.block.page);
					return;
				}
				if (annotation.page !== void 0) {
					setPageIndex(annotation.page);
					return;
				}
				(contentRef.current?.querySelector(`[data-line="${annotation.from}"]`))?.scrollIntoView({
					block: "center",
					behavior: "smooth"
				});
			}, [preview?.kind]);
			const resolveAnnotation = (0, react.useCallback)((id) => {
				setAnnotations((previous) => previous.map((annotation) => annotation.id === id ? {
					...annotation,
					status: "resolved"
				} : annotation));
			}, []);
			const reopenAnnotation = (0, react.useCallback)((id) => {
				setAnnotations((previous) => previous.map((annotation) => annotation.id === id ? {
					...annotation,
					status: "open"
				} : annotation));
			}, []);
			const deleteAnnotation = (0, react.useCallback)((id) => {
				setAnnotations((previous) => previous.filter((annotation) => annotation.id !== id));
			}, []);
			const message = (0, react.useMemo)(() => {
				if (!file) return "";
				return buildAnnotationMessage({
					relPath: file.path,
					version,
					annotations: openAnnotations,
					includePath: sendIncludePath,
					includeQuote: sendIncludeQuote
				});
			}, [
				file,
				openAnnotations,
				sendIncludePath,
				sendIncludeQuote,
				version
			]);
			const copyText = (0, react.useCallback)(async (text) => {
				try {
					await navigator.clipboard.writeText(text);
					showToast("已复制到剪贴板");
				} catch {
					const area = document.createElement("textarea");
					area.value = text;
					document.body.appendChild(area);
					area.select();
					document.execCommand("copy");
					area.remove();
					showToast("已复制到剪贴板");
				}
			}, [showToast]);
			const send = (0, react.useCallback)(async () => {
				if (!file || busy) return;
				if (!sessionId) {
					showToast("当前没有会话，先把文件发给 AI 的会话里打开面板");
					return;
				}
				setBusy(true);
				try {
					await sendAnnotations({
						sessionId,
						markdown: message
					});
					setAnnotations((previous) => previous.map((annotation) => annotation.path === file.path && annotation.status === "open" ? {
						...annotation,
						sentAt: Date.now()
					} : annotation));
					setSendOpen(false);
					showToast("已发给 AI，等它改完刷新预览");
				} catch (error) {
					showToast(`发送失败：${isApiError(error) ? error.message : String(error)}；已复制文本备用`);
					await copyText(message);
				} finally {
					setBusy(false);
				}
			}, [
				busy,
				copyText,
				file,
				message,
				sessionId,
				showToast
			]);
			const exportCurrent = (0, react.useCallback)(async () => {
				if (!file) return;
				try {
					const exported = await exportAnnotations({
						sessionId,
						path: file.path,
						content: message
					});
					showToast(`已导出：${exported}`);
				} catch (error) {
					showToast(`导出失败：${isApiError(error) ? error.message : String(error)}`);
				}
			}, [
				file,
				message,
				sessionId,
				showToast
			]);
			const beginDrag = (0, react.useCallback)((event) => {
				if (event.target.closest("button")) return;
				event.preventDefault();
				const start = {
					mouseX: event.clientX,
					mouseY: event.clientY,
					x: geometry.x,
					y: geometry.y
				};
				const onMove = (move) => {
					setGeometry((previous) => ({
						...previous,
						x: start.x + (move.clientX - start.mouseX),
						y: Math.max(0, start.y + (move.clientY - start.mouseY))
					}));
				};
				const onUp = () => {
					window.removeEventListener("mousemove", onMove);
					window.removeEventListener("mouseup", onUp);
				};
				window.addEventListener("mousemove", onMove);
				window.addEventListener("mouseup", onUp);
			}, [geometry.x, geometry.y]);
			const beginResize = (0, react.useCallback)((axis) => (event) => {
				event.preventDefault();
				event.stopPropagation();
				const start = {
					mouseX: event.clientX,
					mouseY: event.clientY,
					w: geometry.w,
					h: geometry.h
				};
				const onMove = (move) => {
					setGeometry((previous) => ({
						...previous,
						w: axis === "s" ? previous.w : Math.max(MIN_W, start.w + (move.clientX - start.mouseX)),
						h: axis === "e" ? previous.h : Math.max(MIN_H, start.h + (move.clientY - start.mouseY))
					}));
				};
				const onUp = () => {
					window.removeEventListener("mousemove", onMove);
					window.removeEventListener("mouseup", onUp);
				};
				window.addEventListener("mousemove", onMove);
				window.addEventListener("mouseup", onUp);
			}, [geometry.h, geometry.w]);
			(0, react.useEffect)(() => {
				if (!snapshot.open) return;
				const onKeyDown = (event) => {
					if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
						event.preventDefault();
						if (mode === "edit" && dirty) save();
						return;
					}
					if (event.key !== "Escape") return;
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
				window.addEventListener("keydown", onKeyDown);
				return () => window.removeEventListener("keydown", onKeyDown);
			}, [
				composer,
				dirty,
				mode,
				requestClose,
				save,
				sendOpen,
				snapshot.open
			]);
			if (!snapshot.open) return null;
			const renderTreeLevel = (dir, entries, depth) => entries.map((entry) => {
				const paddingLeft = 6 + depth * 12;
				if (entry.dir) {
					const state = dirs[entry.path];
					const expanded = state?.expanded ?? false;
					const children = state?.entries ?? [];
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-fr-tree-row",
						style: { paddingLeft },
						onClick: () => toggleDir(entry.path),
						title: entry.path,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-fr-tree-icon",
							children: expanded ? "▾" : "▸"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dsh-fr-tree-name",
							children: entry.name
						})]
					}), expanded ? renderTreeLevel(entry.path, children, depth + 1) : null] }, entry.path);
				}
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: `dsh-fr-tree-row${entry.path === activePath ? " dsh-fr-tree-row-active" : ""}`,
					style: { paddingLeft },
					onClick: () => {
						if (dirty && activePath !== entry.path && !window.confirm("有未保存修改，切换文件会丢失，继续？")) return;
						setActivePath(entry.path);
					},
					title: entry.path,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-fr-tree-icon",
						children: "📄"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dsh-fr-tree-name",
						children: entry.name
					})]
				}, entry.path);
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dsh-fr-root",
				ref: rootRef,
				style: {
					left: geometry.x,
					top: geometry.y,
					width: geometry.w,
					height: geometry.h
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						className: "dsh-fr-head",
						onMouseDown: beginDrag,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-fr-title",
								children: "文件预览与批注"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dsh-fr-meta",
								children: file ? `${file.path} · v${version} · ${formatBytes(file.size)}${dirty ? " · 未保存" : ""}` : "在左栏选择文件"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dsh-fr-btn",
								onClick: () => void refreshRoot(),
								disabled: rootLoading,
								children: rootLoading ? "读取中…" : "刷新"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dsh-fr-btn",
								disabled: !file || file.readonly,
								onClick: () => {
									if (mode === "edit" && dirty && !window.confirm("退出编辑会丢弃未保存修改，继续？")) return;
									setMode(mode === "edit" ? "preview" : "edit");
								},
								children: mode === "edit" ? "预览" : "编辑"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dsh-fr-btn dsh-fr-close",
								onClick: requestClose,
								title: "关闭（Esc）",
								children: "✕"
							})
						]
					}),
					banner === "external" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-fr-banner",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "文件已在外部修改，当前预览不是最新版本。" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-fr-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dsh-fr-btn",
								onClick: () => void refreshCurrent(),
								children: "刷新到最新"
							})
						]
					}) : null,
					banner === "conflict" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-fr-banner",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "文件已在外部修改，同时你有未保存的修改，请先刷新再保存。" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-fr-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dsh-fr-btn",
								onClick: () => void refreshCurrent(),
								children: "刷新（丢弃我的修改）"
							})
						]
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-fr-body",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("aside", {
								className: "dsh-fr-tree",
								children: rootEntries.length === 0 && !rootLoading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsh-fr-empty-list",
									children: "工作区为空或未加载"
								}) : renderTreeLevel("", rootEntries, 0)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("main", {
								className: "dsh-fr-main",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dsh-fr-toolbar",
										children: file ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: file.path }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["· ", formatBytes(file.size)] }),
											file.readonly ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "· 只读" }) : null,
											file.tooLarge ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "· 超过 2MB，仅支持查看" }) : null,
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-fr-spacer" }),
											mode === "edit" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: "dsh-fr-btn dsh-fr-btn-primary",
												onClick: () => void save(),
												disabled: busy || !dirty,
												children: busy ? "保存中…" : `保存 v${version + 1}`
											}) : null,
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: "dsh-fr-btn",
												onClick: () => void refreshCurrent(),
												children: "刷新"
											})
										] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: fileLoading ? "打开中…" : "← 从左侧选择一个文件" })
									}),
									file && file.previewKind !== "text" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dsh-fr-previewbar",
										children: preview?.kind === "pages" && currentPage ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: "dsh-fr-btn",
												onClick: () => {
													const target = previewPages[Math.max(0, pagePosition - 1)];
													if (target) setPageIndex(target.index);
												},
												disabled: pagePosition <= 0,
												children: "‹ 上一页"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: "dsh-fr-btn",
												onClick: () => {
													const target = previewPages[Math.min(previewPages.length - 1, pagePosition + 1)];
													if (target) setPageIndex(target.index);
												},
												disabled: pagePosition >= previewPages.length - 1,
												children: "下一页 ›"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsh-fr-muted",
												children: currentPage.label
											}),
											textLayer?.hasText ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsh-fr-muted",
												children: "· 可拖选文字"
											}) : null,
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "dsh-fr-muted",
												children: [
													pagePosition + 1,
													" / ",
													preview.pageCount ?? previewPages.length
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-fr-divider" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: "dsh-fr-btn",
												onClick: () => setZoom((value) => Math.max(.3, Math.round((value - .1) * 10) / 10)),
												title: "缩小",
												children: "−"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "dsh-fr-zoom",
												children: [Math.round(zoom * 100), "%"]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: "dsh-fr-btn",
												onClick: () => setZoom((value) => Math.min(2.5, Math.round((value + .1) * 10) / 10)),
												title: "放大",
												children: "＋"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-fr-divider" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: "dsh-fr-btn",
												onClick: addBlockAnnotation,
												children: "＋ 批注本页"
											}),
											preview.truncated ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "dsh-fr-muted",
												children: [
													"仅渲染前 ",
													previewPages.length,
													" 页（共 ",
													preview.pageCount,
													" 页）"
												]
											}) : null
										] }) : preview?.kind === "sheet" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
											(preview.sheets ?? []).map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												className: `dsh-fr-btn${item.index === sheetIndex ? " dsh-fr-btn-primary" : ""}`,
												onClick: () => setSheetIndex(item.index),
												children: [
													"工作表「",
													item.name,
													"」"
												]
											}, item.index)),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: "dsh-fr-muted",
												children: "· 可拖选文字"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-fr-spacer" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: "dsh-fr-btn",
												onClick: addBlockAnnotation,
												disabled: !sheet || sheetLoading || Boolean(sheetError),
												children: "＋ 批注本表"
											})
										] }) : preview?.kind === "image" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: "dsh-fr-muted",
												children: [
													preview.mime,
													" · ",
													formatBytes(preview.size ?? file.size)
												]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-fr-spacer" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: "dsh-fr-btn",
												onClick: addBlockAnnotation,
												children: "＋ 批注图片"
											})
										] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: "dsh-fr-muted",
											children: previewLoading ? "准备预览…" : previewError ? "预览不可用" : ""
										})
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dsh-fr-content",
										ref: contentRef,
										onMouseUp: () => {
											sheetDragging.current = false;
											handleSelection();
										},
										onMouseLeave: () => {
											sheetDragging.current = false;
										},
										children: !file ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dsh-fr-empty",
											children: "预览区。选中文字后可以添加批注。"
										}) : file.previewKind !== "text" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: preview?.kind === "sheet" ? "dsh-fr-preview-wrap dsh-fr-preview-wrap-sheet" : "dsh-fr-preview-wrap",
											children: previewLoading ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsh-fr-skeleton",
												"aria-label": "正在准备预览",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "dsh-fr-skeleton-bar" }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "dsh-fr-skeleton-block" }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "dsh-fr-skeleton-block dsh-fr-skeleton-block-short" }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsh-fr-preview-state",
														children: ["正在转换文档，首次打开可能需要几秒…", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsh-fr-preview-actions",
															children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "dsh-fr-btn",
																onClick: () => {
																	previewAbort.current?.abort();
																	setPreviewLoading(false);
																	setPreviewCancelled(true);
																},
																children: "取消"
															})
														})]
													})
												]
											}) : previewError && previewUiError ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsh-fr-preview-error",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "dsh-fr-preview-error-title",
														children: previewUiError.title
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "dsh-fr-preview-error-hint",
														children: previewUiError.hint
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
														className: "dsh-fr-error-details",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "查看技术详情" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: previewUiError.message || previewError })]
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														className: "dsh-fr-btn",
														onClick: () => void loadPreview(file),
														children: "重试"
													})
												]
											}) : preview?.kind === "image" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "dsh-fr-image-wrap",
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
													className: "dsh-fr-preview-image",
													src: rawUrl(sessionId, file.path, file.sha1),
													alt: file.name,
													draggable: false
												})
											}) : preview?.kind === "sheet" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "dsh-fr-sheet-wrap",
												children: sheetLoading ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-fr-skeleton",
													"aria-label": "正在解析表格",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "dsh-fr-skeleton-bar" }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "dsh-fr-skeleton-block" }),
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
															className: "dsh-fr-preview-state",
															children: ["正在解析表格…", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																className: "dsh-fr-preview-actions",
																children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																	className: "dsh-fr-btn",
																	onClick: () => {
																		sheetAbort.current?.abort();
																		setSheetLoading(false);
																		setSheetCancelled(true);
																	},
																	children: "取消"
																})
															})]
														})
													]
												}) : sheetError && sheetUiError ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-fr-preview-error",
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
															className: "dsh-fr-preview-error-title",
															children: sheetUiError.title
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
															className: "dsh-fr-preview-error-hint",
															children: sheetUiError.hint
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
															className: "dsh-fr-error-details",
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", { children: "查看技术详情" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: sheetUiError.message || sheetError })]
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															className: "dsh-fr-btn",
															onClick: () => file && void loadSheet(file, sheetIndex),
															children: "重试"
														})
													]
												}) : sheet ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
													sheetSelectionLabel ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "dsh-fr-sheet-range",
														children: sheetSelectionLabel
													}) : null,
													sheet.truncated ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsh-fr-sheet-trunc",
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: sheetFull ? `已加载前 ${sheet.rowCount.toLocaleString()} 行 · 共 ${sheet.totalRows.toLocaleString()} 行 × ${sheet.totalCols} 列，已达加载上限` : `只显示前 ${sheet.rowCount.toLocaleString()} 行 · 共 ${sheet.totalRows.toLocaleString()} 行 × ${sheet.totalCols} 列，已截断` }), !sheetFull ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															className: "dsh-fr-btn",
															onClick: () => setFullConfirmOpen(true),
															children: "加载全部（较慢）"
														}) : null]
													}) : null,
													fullConfirmOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsh-fr-sheet-confirm",
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
																"完整加载 ",
																sheet.totalRows.toLocaleString(),
																" 行会更慢，继续吗？"
															] }),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "dsh-fr-btn dsh-fr-btn-primary",
																onClick: () => file && void loadSheet(file, sheetIndex, true),
																children: "确认加载"
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "dsh-fr-btn",
																onClick: () => setFullConfirmOpen(false),
																children: "取消"
															})
														]
													}) : null,
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsh-fr-sheet-scroll",
														ref: sheetScrollRef,
														onScroll: onSheetScroll,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
															className: "dsh-fr-sheet",
															style: { width: `${sheetTableWidth}px` },
															children: [
																/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("colgroup", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("col", { style: { width: "44px" } }), sheetColumnWidths.map((width, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("col", { style: { width: `${width}px` } }, index))] }),
																/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", { className: "dsh-fr-sheet-corner" }), Array.from({ length: sheet.colCount }, (_, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
																	className: `dsh-fr-sheet-colhead${sheetSelection && index + 1 >= sheetSelection.fromCol && index + 1 <= sheetSelection.toCol ? " dsh-fr-sheet-head-active" : ""}`,
																	children: columnLabel(index + 1)
																}, index))] }) }),
																/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tbody", { children: [
																	sheetFrozenRowsData.map((row) => renderSheetRow(row, true)),
																	sheetVirtual ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", {
																		className: "dsh-fr-sheet-spacer",
																		style: { height: `${sheetTopSpacerHeight}px` },
																		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { colSpan: sheet.colCount + 1 })
																	}) : null,
																	sheetWindowRowsData.map((row) => renderSheetRow(row, false)),
																	sheetVirtual ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tr", {
																		className: "dsh-fr-sheet-spacer",
																		style: { height: `${sheetBottomSpacerHeight}px` },
																		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", { colSpan: sheet.colCount + 1 })
																	}) : null
																] })
															]
														}), sheet.cells.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
															className: "dsh-fr-sheet-note",
															children: "这个工作表是空的"
														}) : null]
													})
												] }) : sheetCancelled ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: "dsh-fr-preview-state",
													children: ["已取消表格解析", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsh-fr-preview-actions",
														children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
															className: "dsh-fr-btn",
															onClick: () => file && void loadSheet(file, sheetIndex),
															children: "重新加载"
														})
													})]
												}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: "dsh-fr-preview-state",
													children: "暂无表格数据"
												})
											}) : preview?.kind === "pages" && currentPage ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsh-fr-page-wrap",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsh-fr-page-stack",
														style: {
															width: Math.max(1, Math.round(currentPage.width * zoom)),
															height: Math.max(1, Math.round(currentPage.height * zoom))
														},
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
															className: "dsh-fr-page-image",
															src: renderUrl(sessionId, file.path, preview.key, currentPage.index),
															width: Math.max(1, Math.round(currentPage.width * zoom)),
															height: Math.max(1, Math.round(currentPage.height * zoom)),
															alt: currentPage.label,
															draggable: false
														}), textLayer && textLayer.hasText ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
															className: "dsh-fr-textlayer",
															children: textLayer.blocks.map((block, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: {
																	left: `${block.x * 100}%`,
																	top: `${block.y * 100}%`,
																	width: `${Math.max(block.w, .002) * 100}%`,
																	height: `${Math.max(block.h, .004) * 100}%`,
																	fontSize: `${Math.max(1, block.h * currentPage.height * zoom)}px`
																},
																children: block.text
															}, `${block.text}-${index}`))
														}) : null]
													}),
													textLayerLoading ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "dsh-fr-textlayer-hint",
														children: "正在提取文字层…"
													}) : null,
													!textLayerLoading && textLayerError ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														className: "dsh-fr-textlayer-hint",
														children: [
															"文字层不可用：",
															textLayerError,
															"；可用「＋ 批注本页」"
														]
													}) : null,
													!textLayerLoading && !textLayerError && textLayer && !textLayer.hasText ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														className: "dsh-fr-textlayer-hint",
														children: "这页没有可选文字（扫描件？），可用「＋ 批注本页」"
													}) : null
												]
											}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "dsh-fr-preview-state",
												children: previewCancelled ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: ["已取消预览", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: "dsh-fr-preview-actions",
													children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
														className: "dsh-fr-btn",
														onClick: () => file && void loadPreview(file),
														children: "重新加载"
													})
												})] }) : "暂无预览"
											})
										}) : mode === "edit" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: "dsh-fr-editor-wrap",
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", {
												className: "dsh-fr-editor-ln",
												children: draft.split("\n").map((_, index) => String(index + 1)).join("\n")
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
												className: "dsh-fr-editor",
												value: draft,
												spellCheck: false,
												readOnly: file.readonly,
												onChange: (event) => {
													setDraft(event.target.value);
													setDirty(event.target.value !== file.content);
												}
											})]
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dsh-fr-lines",
											children: decorated.map((line, index) => {
												const lineNumber = index + 1;
												const marked = markedLines.has(lineNumber);
												return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: `dsh-fr-line${line.cls}${marked ? " dsh-fr-line-marked" : ""}`,
													"data-line": lineNumber,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: "dsh-fr-ln",
														children: lineNumber
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "dsh-fr-lt",
														children: [marked ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: "dsh-fr-pin",
															children: "●"
														}) : null, line.text || " "]
													})]
												}, lineNumber);
											})
										})
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
								className: "dsh-fr-rail",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-fr-rail-head",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "批注" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-fr-spacer" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
											openAnnotations.length,
											" 条未解决 / ",
											activeAnnotations.length,
											" 条"
										] })
									]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsh-fr-rail-list",
									children: activeAnnotations.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsh-fr-empty-list",
										children: [
											"选中左侧文字 → 点「＋ 批注」",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
											"Office / PDF 用预览工具栏的「＋ 批注本页」。",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
											"批注会带回当前会话，让 AI 直接改。"
										]
									}) : activeAnnotations.map((annotation) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dsh-fr-card",
										style: annotation.status === "resolved" ? {
											opacity: .55,
											borderLeftColor: "#6ee7a8"
										} : void 0,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "dsh-fr-card-quote",
												children: annotation.block ? annotation.block.label : `“${annotation.quote}”`
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
												className: "dsh-fr-card-text",
												children: annotation.text
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: "dsh-fr-card-foot",
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: annotationKindLabel(annotation) }),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: formatRelativeTime(annotation.createdAt) }),
													annotation.status === "stale" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "已过期" }) : null,
													annotation.sentAt ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "已发送" }) : null,
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: "dsh-fr-card-actions",
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "dsh-fr-link",
																onClick: () => jumpTo(annotation),
																children: "定位"
															}),
															annotation.status === "resolved" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "dsh-fr-link",
																onClick: () => reopenAnnotation(annotation.id),
																children: "重新打开"
															}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "dsh-fr-link",
																onClick: () => resolveAnnotation(annotation.id),
																children: "解决"
															}),
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
																className: "dsh-fr-link",
																onClick: () => deleteAnnotation(annotation.id),
																children: "删除"
															})
														]
													})
												]
											})
										]
									}, annotation.id))
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
						className: "dsh-fr-foot",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [file ? `${openAnnotations.length} 条批注待处理` : "未选择文件", !sessionId ? " · 未绑定会话" : ""] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-fr-spacer" }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dsh-fr-btn",
								disabled: !file || openAnnotations.length === 0,
								onClick: () => void exportCurrent(),
								children: "导出批注"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: "dsh-fr-btn dsh-fr-btn-primary",
								disabled: !file || openAnnotations.length === 0,
								onClick: () => setSendOpen(true),
								children: "发给 AI"
							})
						]
					}),
					composer ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dsh-fr-composer",
						style: {
							left: composer.x,
							top: composer.y
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-fr-composer-quote",
								children: [
									"“",
									composer.quote,
									"”"
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: "dsh-fr-input",
								autoFocus: true,
								placeholder: "写一句你的意见，例如：这里数字不对，改成 42",
								value: composerText,
								onChange: (event) => setComposerText(event.target.value),
								onKeyDown: (event) => {
									if ((event.ctrlKey || event.metaKey) && event.key === "Enter") addAnnotation();
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dsh-fr-composer-foot",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-fr-btn",
									onClick: () => setComposer(null),
									children: "取消"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: "dsh-fr-btn dsh-fr-btn-primary",
									onClick: addAnnotation,
									children: "添加批注"
								})]
							})
						]
					}) : null,
					sendOpen && file ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-fr-mask",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dsh-fr-dialog",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: "发给 AI" }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-fr-dialog-sub",
									children: [
										"把 ",
										openAnnotations.length,
										" 条批注作为一条用户消息发到当前会话，AI 会按批注改文件。"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "dsh-fr-switch-row",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: sendIncludePath,
										onChange: (event) => setSendIncludePath(event.target.checked)
									}), "附带文件路径与版本"]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: "dsh-fr-switch-row",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: sendIncludeQuote,
										onChange: (event) => setSendIncludeQuote(event.target.checked)
									}), "附带原文摘录"]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "dsh-fr-preview",
									children: message
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "dsh-fr-dialog-foot",
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											className: "dsh-fr-btn",
											onClick: () => void copyText(message),
											children: "复制文本"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											className: "dsh-fr-btn",
											onClick: () => void exportCurrent(),
											children: "导出为 .md"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dsh-fr-spacer" }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											className: "dsh-fr-btn",
											onClick: () => setSendOpen(false),
											children: "取消"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											className: "dsh-fr-btn dsh-fr-btn-primary",
											onClick: () => void send(),
											disabled: busy,
											children: busy ? "发送中…" : "发送"
										})
									]
								})
							]
						})
					}) : null,
					toast ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-fr-toast",
						children: toast
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-fr-handle dsh-fr-handle-e",
						onMouseDown: beginResize("e")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-fr-handle dsh-fr-handle-s",
						onMouseDown: beginResize("s")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dsh-fr-handle dsh-fr-handle-se",
						onMouseDown: beginResize("se")
					})
				]
			});
		}
		// src/client/index.tsx
		/** 插件 id 必须与 package.json name / bundle banner id 一致 */
		const name = "dsh-file-review";
		const inject = ["slots"];
		function EntryButton(props) {
			(0, react.useEffect)(() => {
				rememberSession(props.sessionId);
				recordSlotProps("left", props);
				captureInputActions(props.inputActions);
			}, [props.sessionId, props.inputActions]);
			return (0, react.createElement)("button", {
				className: "dsh-fr-btn",
				type: "button",
				title: "打开文件预览与批注（预览工作区文件、选中批注、发给 AI）",
				style: {
					height: "28px",
					padding: "0 10px",
					margin: "0 2px"
				},
				onClick: () => openPanel(props.sessionId)
			}, "📝 批注");
		}
		/**
		* 输入条 overlay 槽位的无 UI 捕获组件。
		* 官方会话只在 conversation.input.overlay 的 props 里下发 inputActions（setDraft/submit，
		* 与输入条自身同一个 shell.actions 实例）；入口按钮所在的 input.left 不一定带，
		* 所以这里单独注册一个只做捕获、返回 null 的组件。
		*/
		function OverlayCapture(props) {
			rememberSession(props?.sessionId);
			recordSlotProps("overlay", props);
			captureInputActions(props?.inputActions);
			return null;
		}
		function apply(ctx) {
			bindClientContext(ctx);
			let slots = null;
			try {
				slots = ctx.get("slots") ?? null;
			} catch {
				slots = null;
			}
			if (!slots) return;
			const service = slots;
			service.inject("conversation.input.left", () => service.register({
				name: "conversation.input.left",
				id: "file-review-entry",
				order: 40,
				label: "文件预览与批注"
			}, (props) => (0, react.createElement)(EntryButton, {
				sessionId: props?.sessionId,
				inputActions: props?.inputActions
			})));
			service.inject("conversation.input.overlay", () => service.register({
				name: "conversation.input.overlay",
				id: "file-review-capture",
				order: 40,
				label: "文件预览与批注（发送通道）"
			}, OverlayCapture));
			service.inject("shell.overlay", () => service.register({
				name: "shell.overlay",
				id: "file-review-panel"
			}, () => (0, react.createElement)(FileReviewPanel)));
			try {
				globalThis["__dshFileReview"] = {
					diag: () => getSlotDiagnostics(),
					captureInputActions
				};
			} catch {}
		}
		exports.apply = apply;
		exports.buildAnnotationMessage = buildAnnotationMessage;
		exports.canSendToSession = canSendToSession;
		exports.captureInputActions = captureInputActions;
		exports.getSlotDiagnostics = getSlotDiagnostics;
		exports.inject = inject;
		exports.name = name;
		exports.sendToSession = sendToSession;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
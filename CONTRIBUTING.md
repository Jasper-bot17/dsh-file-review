# 贡献指南

感谢参与 `dsh-file-review`。这是一个 DSH Web GUI 插件：在面板里预览 AI 产出的文件、直接编辑或加批注，并把批注一键发回给 AI。所有贡献（代码、文档、设计、测试用例、issue）都欢迎。

## 先读这些

1. `README.md`：项目定位、功能边界、安全约束。
2. `docs/architecture.md`：Host/Client 结构、API、数据模型与构建约束。
3. `docs/usage.md`：用户可见行为（改行为前先对齐文档）。
4. DSH 插件开发指南：<https://github.com/anweat/dsh-plugin-dev-guide>
5. `CHANGELOG.md`：当前版本做了什么、哪些还在加固。

## 开发环境

- Node.js >= 22.13（推荐 24 LTS；`pdfjs-dist 6.5.438` 在 22.0–22.12 不可用）。
- 工程依赖一律用 **npm**（仓库带 `package-lock.json`）。`dsh plugin` 内部装插件用 DSH 自带 pnpm，那只服务装插件场景；**不要在工程里跑 `pnpm install`**，否则会生成第二套锁文件。
- 插件以「本地路径」方式安装进 desktop profile 验证：

  ```powershell
  & "C:\Program Files\nodejs\npm.cmd" install
  & "C:\Program Files\nodejs\npm.cmd" run verify   # build + bundle 契约 + Host/Client 自测
  dsh plugin --profile desktop add <本仓库路径>
  ```

  profile 变更后需要重启 `dsh web`；仅改 Client bundle 时 rebuild + 刷新页面即可。

- 构建约束（违反会导致页面停在 loading 或 boot 失败）：
  - Client 半必须在 `package.json` 里有 `"dsh": { "client": { "platform": "web" } }` 和 `"./client"` 导出。
  - Client bundle 必须是 CJS closure factory：banner `window.__ModuleLoader__.load({ id: "<包名>", factory: (require) => {`、footer `return module.exports; } });`。
  - `react`、`react-dom`、`@deepseek-ai/*` 客户端包等平台模块必须外部化，不得打进 bundle。
  - `@deepseek-ai/*` 只允许 `import type`；值导入仅限外部化白名单。
  - 前端扩展只走 Slot：当前使用 `shell.overlay`、`conversation.input.left`；不注册 `root`、不 shadow `sidebar`。
  - 具体命令与外部化清单以 `tsdown.config.ts`、`package.json` 与 `scripts/check-client-bundle.mjs` 为准。

## 提 PR 流程

1. 从 `main` 切分支：`feat/xxx`、`fix/xxx`、`docs/xxx`。
2. 保持改动聚焦，一个 PR 只做一件事；顺手重构请单独提。
3. 提交信息用 Conventional Commits：`feat: ...`、`fix: ...`、`docs: ...`、`refactor: ...`、`chore: ...`。
4. PR 描述里写清：改了什么、为什么、**怎么验证的**（命令/截图/录屏）。
5. 通过 CI（`npm ci` + `npm run verify`）后才合并；未过 CI 未验证的 PR 不合并。CI 跑在 `windows-latest`：`scripts/test-host.mjs` 里有 `USERPROFILE`/`TEMP` 兜底与 `C:\Windows\win.ini` 绝对路径断言，换 ubuntu 会红，测试口径不要随手改。

## 代码约定

- 语言：TypeScript；代码与注释英文，面向用户的文案中文（README/UI 文案）。
- Host 半：所有文件系统操作必须限制在**当前会话工作区内**（realpath 校验，拒绝 `..` 穿越与系统目录、拒绝盘根当工作区）；写回前生成 `.bak`。
- Client 半：不直接读写文件系统，一律走 `/plugins/dsh-file-review/api/*`；不传绝对路径，只传 sessionId + 工作区相对路径。
- 批注持久化：存储位置由 Host 从会话工作区推导（`<工作区>/.dsh-file-review/`），写入用临时文件 + rename，同一文件按批注 id 合并（含删除墓碑）、串行写入，单文件上限 **512 KB / 500 条批注**；并发写不会 409（409 只用于文件内容保存）；导出 `.md` 只写工作区内派生路径。
- 不引入体积大、非离线可用的运行时依赖；Office/PDF 预览库需确认许可证与离线可用性。
- 不提交 `node_modules/`、构建产物以外的临时文件、`.bak`、密钥或带个人信息的样本文件。

## 提交内容边界

- 一份文件同一时间只由一人修改；多人协作请先开 issue 或在 PR 里说明。
- 修改他人负责的模块，先在 issue/PR 里 @ 相关负责人。

## 测试与验收清单（PR 自检）

- [ ] `npm run verify` 通过（TypeScript + bundle 契约 + Host 自测 + Client 装载自测）
- [ ] 离线 bundle 校验通过（banner/footer/平台模块外部化）
- [ ] 本地装进 desktop profile 后，会话不再停在 loading
- [ ] 手动验证主链路：打开面板 → 选文件 → 预览 → 编辑保存（有 `.bak`）/ 选中批注 → 发给 AI
- [ ] 越界路径被拒绝（如 `../`、系统目录、盘根）有明确报错
- [ ] 「给人看」的改动（预览/导出/生图）附**截图对照**，按 `docs/usage.md` 里的交互预期自查；口头「能显示」不算通过
- [ ] 文档（README / 本文件 / CHANGELOG）随行为变更同步更新

## 报告问题

- 功能缺陷/建议：开 GitHub issue，附 DSH 版本、OS、复现步骤、期望/实际结果、截图或录屏。模板见 `.github/ISSUE_TEMPLATE/`。
- 安全漏洞：**不要公开开 issue**，按 [SECURITY.md](SECURITY.md) 的私密通道报告（GitHub Security Advisories，或邮件 `jasper_ssh@126.com`）。
- 提交前先搜是否已有同类 issue。

## 许可证

贡献即表示同意以 [MIT](LICENSE) 许可证发布你的贡献。

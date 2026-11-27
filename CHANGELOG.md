# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-11-27

在 v0.1.0 闭环上补齐日常使用最痛的三块：批注不会丢、多文件能对照、文件被改能及时发现。

### 新增

- **批注持久化**：批注改动自动保存到当前会话工作区 `.dsh-file-review/`（服务端派生存储文件名，临时文件 + rename 原子写，单文件上限 **512 KB / 500 条批注**）；同文件并发写入按批注 id 合并 + 删除墓碑，不丢批注；重开面板 / 刷新页面后自动还原，存储缺失或损坏时按空批注处理；支持导出 `.annotations.md`；文件被外部改动后旧批注标 stale，不把旧行号当准
- **多文件标签**：一次最多打开 8 个文件，标签切换 / 关闭，超出提示先关一个
- **快捷键**：`Ctrl/Cmd + S` 保存、`Ctrl/Cmd + Enter` 发送批注（确认框内）、`Esc` 关闭面板 / 取消编辑
- **外部修改提示**：文件被 AI 或编辑器改动后面板提示「内容已更新」，可一键刷新；有未保存编辑时先提示冲突（行级 diff 高亮留 0.3.0）

### 修复

- CI 的 `actions/checkout`、`actions/setup-node` 从 v4 升到 v5（Node 20 已 EOL，action 运行时改 Node 24；GitHub 托管 `windows-latest` runner 满足最低 v2.327.1，无需额外处理）
- README 及仓库其余文本文件统一清除 UTF-8 BOM，全仓按无 BOM UTF-8 保存
- pptx 拖选批注在最终构建上复跑并补回归用例（此前只在 112,657 B 的中间构建上验过）
- `ERR_CONVERT_TIMEOUT` 用真实超大文档补样本与回归，不再只是能力限制记录
- README 界面预览从设计参考稿渲染更换为真机截图 / 录屏（同名替换，引用不变）

### 变更

- 文档重写：README（截图/GIF、安装、使用、配置、快捷键、FAQ、架构入口、路线图）；新增 `docs/usage.md`、`docs/architecture.md`、`docs/troubleshooting.md`；`docs/install.md` 补 v0.2.0 验收项
- Node.js 口径统一为 **>= 22.13**（推荐 24 LTS）：`pdfjs-dist 6.5.438` 在 22.0–22.12 不可用，README / CONTRIBUTING / install 三处同步修正
- `SECURITY.md` 支持版本更新为 0.2.x，补批注持久化的路径与写入边界
- `CONTRIBUTING.md` 修正失效的设计文档引用，补文档索引与批注持久化约定；feature request 模板补影响范围项

### 验证记录

- `npm run verify`：bundle 契约 **12/12**、Host 自测 **81/81**、client bundle **47/47**，`EXIT=0`；两轮重编字节一致，Coding 已明确「不再重编」
- 发布构建：`lib/index.js` **80,855 B**（SHA256 `CA9EFE04EA363DD28B6011C543FCEE96EA56FB5D0AEBA03D30C24D416B945B59`）、`lib/client.js` **121,632 B**（SHA256 `0F56EEDDC3FB2FF2111DD9E774F428BB9A68DFF2C05BC20481EA1EDCA7C2DC55`）
- 持久化安全复核：`v0.2.0-持久化探针.mjs` **22/22** 通过（无会话 / 伪 sessionId / 越界路径 / 512 KB 上限 / 并发合并 / 墓碑 / 坏 JSON 降级 / `/tree` 过滤 `.bak` 与 `.dsh-file-review/`）
- 待隔离实例复核（Claw，发版前）：pptx 拖选在最终构建复跑、`ERR_CONVERT_TIMEOUT` 真实超大文档样本、headed Edge 全量回归

### 已知限制

- 行级 diff 高亮未做（0.3.0）：当前只提示「内容已更新」并提供刷新
- 扫描件、纯图片 PDF 无文字层，只能整页批注
- Office 转换速度依赖本机转换链，部分环境较慢
- Windows PowerShell 下建议用 `npm.cmd` 绕过执行策略

## [Unreleased]

### 计划中（0.3.0）

- AI 改完原地刷新并高亮行级 diff、拖拽打开文件、批注导出增强

## [0.1.0] - 2026-11-22

首个公开版本，交付「预览 → 编辑/批注 → 回传 AI」闭环。

### 新增

- **文本类文件**：`.md` `.txt` `.csv` `.json` `.yaml` 与代码文件预览；直接编辑保存（写回前自动生成 `.bak`，外部改动冲突返回 409 而非覆盖）
- **选中文本批注**：锚点＝行号区间；批注列表可编辑/删除、可导出 `.annotations.md`
- **批注发给 AI**：格式化为含「文件路径 + 版本 + `L<起>-<止>` 行号 + 原文摘录 + 意见」的消息，走 Host `/plugins/dsh-file-review/api/send` → `ctx.sessionController.prompt` 发进当前会话
- **docx / pptx / pdf 预览**：页图 + 透明文字层，可像文本一样选中原文加批注；无文字层时保留整页批注兜底
- **xlsx 预览**：DOM 表格渲染，含行号列标、网格线、列宽、合并单元格、选区/区域选择与单元格/区域批注；冻结窗格（`sheetView` pane + sticky 行/列 + 角格双固定）；大表默认渲染 1,000 行并给明确截断条、可确认后加载全部（上限 20,000 行 / 30 万格）
- **图片批注**：png/jpg/jpeg/gif/webp/bmp 整图批注，消息为 `图片 【意见】…`，不带页号/行号
- **错误态**：`ERR_ENCRYPTED_FILE` / `ERR_TOO_LARGE` / `ERR_CONVERT_TIMEOUT` / `BAD_XML_ENTITY` 统一错误卡（一句人话 + 折叠技术详情 + 重试），表格失败时批注入口置灰但已有批注保留
- **面板**：`shell.overlay` 浮层面板 + `conversation.input.left`「📝 批注」入口；文件树懒加载；深色模式
- 安装：`dsh plugin --profile desktop add <路径>` 装进 desktop profile，重启宿主后生效

### 安全

- Host 路由只读写**当前会话工作区**内路径（realpath 校验，拒绝 `..`、系统目录、盘根当工作区）
- 只接受本机 DSH GUI（127.0.0.1）的请求（`isTrustedRequest`，否则 403 `FORBIDDEN`）；Office 转页图与 PDF 文字层在本地完成，不上传文件
- xlsx 手写 XML/zip 解析：条目数与单条大小上限、单格 64KB 上限、禁用外部实体；非法数值实体返回 400 `BAD_XML_ENTITY`
- 批注消息中的文件路径与原文摘录做 Markdown 转义

### 修复

- `/tree?cwd=C:\` 曾返回 200 列出盘根 → 统一 `sessionWorkspace()` 校验，盘根返回 403 `BAD_WORKSPACE`（新增回归用例）
- 点「发送」曾抛 `Uncaught (in promise)`（client `ctx.remote` 在 try 外、会话槽位未下发 `inputActions`）→ 改走 Host 发送路由，保留输入条兜底
- xlsx 曾走「转 PDF → 页图」链路，LibreOffice 默认不打印网格线和行列标导致「不像表格」→ 改 DOM 表格渲染
- 批注消息行号格式修正：每条首行 `L<起>-<止>`；块批注（工作表/单元格/区域/图片）不带【原文】
- `assertPdfReadable` 在普通 PDF 上提前 `document.destroy()` 导致 `/preview` 500 → 只 `await task.promise`，`task.destroy()` 统一放 `finally`；补「普通 PDF 返回 200 + 不走转换器」回归
- xlsx cells 解析由回溯正则改为有界游标扫描：260KB / 2 万个未闭合 `<c` 从 7.9s 降到 2.8ms，400KB 病态样本 94ms

### 性能

- 表格虚拟滚动按真实行高前缀和定位，冻结行/列 sticky，滚动不脱位
- pdfjs 数据零拷贝、`pdfjs-dist` pin `6.5.438`；首次转换 loading 骨架 + 可取消，取消/关闭时 abort 请求，转换前清理预览缓存

### 文档与发布

- `README.md`：定位、功能边界、安装实测、界面预览、安全边界、路线图
- `docs/install.md`：安装、卸载、重启影响、免重启隔离实例验收、验收清单、已知问题
- `SECURITY.md`：私密漏洞报告与安全边界
- `CONTRIBUTING.md`、`CHANGELOG.md`、issue 模板（bug / feature / config）、`.github/workflows/ci.yml`（`windows-latest`，`npm ci` + `npm run verify`）
- `docs/release-notes-0.1.0.md`：Release notes 草稿

### 验证记录

- `npm run verify`：bundle 契约 12/12、Host 72/72、client 44/44、exit=0；重编产物字节一致
- 发布构建：`lib/index.js` 72,845 B SHA256 `5AC6508ADCB1483063C9954A23F5D7CE98F7EB46EB4520A8D760474CE71C4763`；`lib/client.js` 113,216 B SHA256 `DC1BD77D2CB68AA02629862D2751DCD5D16259B9E5E1C2AE98A2789DC24ED23D`
- 16 样本安全矩阵 `ALL_DONE`；400KB 病态 sheet 94ms（≤100ms）；非法 XML 实体 400
- headed Edge 真实鼠标：V-08 冻结、V-18 截断/加载全部、V-20 加密错误卡、V-14 四档缩放偏移 0.03px、pdf 拖选批注

### 已知限制

- `ERR_CONVERT_TIMEOUT` 暂无真实样本，按能力限制记录，不阻塞发布
- pptx 拖选回归在 112,657 B 的 client 构建上完成（其后文本层代码未变，未在最终构建复跑）
- README 截图为设计参考稿渲染（假数据、已脱敏），真机截图出来后同名替换
- Windows PowerShell 下建议用 `npm.cmd` 绕过执行策略

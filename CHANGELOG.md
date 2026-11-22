# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 计划中（S3）

- AI 改完原地刷新并高亮 diff、批注持久化、多文件标签、快捷键、拖拽打开
- 转换超时（`ERR_CONVERT_TIMEOUT`）补真实样本与回归

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
- 仅监听 `127.0.0.1` 的 Web GUI；Office 转页图与 PDF 文字层在本地完成，不上传文件
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

- `npm run verify`：bundle 契约 12/12、Host 71/71、client 44/44、exit=0；重编产物字节一致
- 发布候选构建：`lib/index.js` 72,180 B SHA256 `B161042AC422E7B841A4BE05EB4A98263A59F566F6BE3FCB3316FB002019AB73`；`lib/client.js` 113,216 B SHA256 `DC1BD77D2CB68AA02629862D2751DCD5D16259B9E5E1C2AE98A2789DC24ED23D`
- 16 样本安全矩阵 `ALL_DONE`；400KB 病态 sheet 94ms（≤100ms）；非法 XML 实体 400
- headed Edge 真实鼠标：V-08 冻结、V-18 截断/加载全部、V-20 加密错误卡、V-14 四档缩放偏移 0.03px、pdf 拖选批注

### 已知限制

- `ERR_CONVERT_TIMEOUT` 暂无真实样本，按能力限制记录，不阻塞发布
- pptx 拖选回归在 112,657 B 的 client 构建上完成（其后文本层代码未变，未在最终构建复跑）
- README 截图为设计参考稿渲染（假数据、已脱敏），真机截图出来后同名替换
- Windows PowerShell 下建议用 `npm.cmd` 绕过执行策略

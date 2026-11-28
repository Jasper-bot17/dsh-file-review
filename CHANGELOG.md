# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.0] - 未发布

在 v0.2.0 基线上解决两件影响体感的事：页图放大后糊、视频/音频没法看。

### 新增

- **视频与音频预览**：新增 `media` 预览类型，复用 `/raw` 出口做 HTTP Range 流式（无 Range 回 `200`；`bytes=a-b` / `bytes=-n` 回 `206 + Content-Range + Accept-Ranges`；越界回 `416 + bytes */size`；补 `HEAD`）；视频 `mp4` / `m4v` / `webm` / `ogv` / `mov`（H.264 MOV 正常播放）、音频 `mp3` / `wav` / `m4a` / `aac` / `flac` / `ogg` / `oga` / `opus`；前端原生 `<video>/<audio>` + `preload="metadata"`，可拖动进度条、暂停；单文件上限 **4 GB**，流式读取不整读内存
- **时间码批注**：播放器工具栏「＋ 批注视频/音频 00:42」，批注带 `at` 秒数、卡片类型显示「媒体」，点批注卡 seek 到对应秒；消息 `1. 视频 00:42 【意见】…`，不带【原文】、不出现 `L0-0`
- **更多图片格式**：`avif`、`ico` 走原图预览 + 整图批注（扩展名白名单与 MIME 已补）
- **格式支持矩阵**：README 新增矩阵（文本/代码 60 种扩展名、Office/PDF、xlsx、图片、媒体、不支持格式的处理与批注锚点）

### 变更

- **预览画质**：页图渲染 DPI 从固定 120 提升到 **240**（docx 2040×2640 / pptx 3200×1801 / pdf 2040×2640，A4 约 2040px 宽），放大到 250% 也清晰；预览缓存 key 带 DPI，切档不复用旧缓存（旧 120 缓存目录不会被复用）
- 图片预览始终走原图，不做重采样
- 媒体文件同样受「工作区路径锁死 + 本机请求」校验，与文档预览一致

### 修复

- `tiff` / `heic` 等浏览器不认识的格式（415 `UNSUPPORTED_PREVIEW` 专属标题「这个格式暂不支持预览」+「tiff / heic 请先转成 PNG」）、HEVC / 非 H.264 `mov` 等浏览器不支持的编码，不再黑屏或永久转圈，统一走错误卡：一句人话 + 可折叠详情 + 重新加载 + 转码建议，批注入口置灰
- HEVC 兜底：`loadedmetadata` 后 `videoWidth === 0`，或 2.5 s 看门狗发现 `readyState === 0` 且 `duration` 为空，即判不支持（不按 `ftyp` 容器 brand 预拦截，H.264 `mov` 不再误杀）
- 媒体时间码批注刷新后丢失 `at`：Host `sanitizeAnnotationBlock` 白名单保留有限数 `at`（`Math.max(0, at)`），并补 Host 回归（PUT `block.at=3` → GET 断言读回 3）

### 验证记录

- `npm run verify` 全绿：契约 **12/12**、Host **93/93**、client **52/52**、**EXIT=0**
- 产物：`lib/index.js` **85,688 B** SHA256 `F23F7B636B0ED44D064945F06FA42BF24758D5FF08C6CD2E9B995CD55A3810EB`；`lib/client.js` **128,270 B** SHA256 `B5B5C81B01BE94ECA745F9B315D7133C276B0CD97CF04F266A5BBA5E960DC8DB`
- DPI 实测（Coding）：docx 2040×2640 / 252 KB / 8.6 s，pptx 3200×1801 / 80 KB / 9.4 s，pdf 2040×2640 / 309 KB / 2.8 s（Kit 冷启动占大头；渲染器 16 MiB 像素缓冲上限，A4 实际封顶约 416 DPI）
- 媒体 Range：`/raw` 200/206/416、`HEAD`、后缀 range、越界、背压经 Searching 逐行核验通过（核验报告 `预览画质与媒体预览-核验.md`）
- Claw 隔离实例验收（2026-11-28）：HEVC 打开 **234 ms** 出「无法播放这个文件 / 浏览器不支持它的编码」错误卡、批注按钮 `disabled=true` 且导出/发送同步置灰；TIFF **117 ms** 出专属「这个格式暂不支持预览 / 转成 PNG」；h264 `.mp4`、`.mov` 回归正常（duration 5、640×360、readyState 4）；时间码批注刷新前「视频 00:03 / 媒体」卡片与 seek 正常；120 vs 240 同页对比 V-22 由 Design 判过（细线单根实线、8 pt 字缘无伪彩），证据 `dpi-hairline-compare.png` / `dpi-compare-crop.png`；「`at` 刷新保留」待 Claw 重启隔离实例复测

### 已知限制

- 时间码批注以秒为单位（精度约 ±1 s），毫秒级定位不做
- 视频/音频能否播放取决于浏览器原生编解码能力：H.264 `mov` 可播，HEVC 等不保证，由客户端看门狗（无帧 / 2.5 s 无元数据）判不出帧即出错误卡
- `tiff` / `heic` 不做内嵌转码，只提示转换
- 媒体单文件上限 4 GB
- 不读 `ftyp` 容器 brand 做 Host 侧预判（会误杀 H.264 `mov`）；HEVC / 无帧情况统一由客户端 `loadedmetadata` + 2.5 s 看门狗判定

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

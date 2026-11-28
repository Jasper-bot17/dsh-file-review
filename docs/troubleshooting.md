# 排障指南

按现象查。每条给「先看哪里 → 常见原因 → 处理」。带 ★ 的步骤能直接定位大多数问题。

## 1. 安装 / 加载

### 入口「📝 批注」不出现

1. ★ 确认装进了 desktop profile：
   ```powershell
   dsh plugin --profile desktop add "<工程绝对路径>"
   ```
2. ★ Host 半只在桌面宿主**启动时**组装：`add` 之后必须**重启桌面宿主**（不是刷新页面）。
3. 想确认是否进了组合树：在隔离 `DSH_HOME` 里装 web profile 后 `dsh --profile web --dump-config` 搜 `dsh-file-review`；**不要**对 desktop profile 跑 `--dump-config`（会报 `profile "desktop" is managed exclusively by the Electron application`，exit 1）。
4. 看宿主启动日志里有没有插件 apply 报错（缺服务、entry 冲突会整页停在 loading 并列出原因）。

### 页面一直 loading

- 多半是插件 boot 失败。检查：
  - `package.json` 是否有 `"dsh": { "client": { "platform": "web" } }` 和 `"./client"` 导出；
  - `npm run check` 是否通过（banner / footer / id / 平台模块外部化）；
  - 插件 `apply(ctx)` 是否抛错（宿主日志会列 entry 与缺失服务）。
- 改了 Client 半只需 rebuild + 刷新页面；改了 Host 半必须重启宿主。

### `npm install` / `npm.cmd` 报错

- Windows PowerShell 执行策略拦截 `npm.ps1`：用 `& "C:\Program Files\nodejs\npm.cmd" install`。
- 工程里**不要**跑 `pnpm install`：会生成第二套锁文件，和 `package-lock.json` 冲突。`dsh plugin` 内部用 DSH 自带 pnpm，那是另一条线。
- Node 版本：要求 **>= 22.13**（推荐 24 LTS）。22.0–22.12 会在 PDF 解析处失败。
- `dsh plugin` 的 pnpm store 在 C 盘无法硬链时会警告并切到别的盘，属正常。

## 2. 预览

### 文档打不开 / 转圈后报错

- 加密文件 → 错误卡 `ERR_ENCRYPTED_FILE`，去掉密码或让 AI 导出无密码副本。
- 超大文件 → `TOO_LARGE`，缩小文件或拆分。
- 转换超时 → `ERR_CONVERT_TIMEOUT`，可重试；重复失败时先看该文件是否损坏（用 Office 打开试试）。
- 坏 XML（xlsx）→ `BAD_XML_ENTITY` / 解析失败，通常文件本身异常。

### PPT/Word/PDF 能看但选不中文字

- 扫描件 / 纯图片 PDF 没有文字层，只能「＋ 批注本页」整页批注。
- 缩放 150% / 200% 下选区偏移是已知验证项（v0.1.0 实测偏移 0.03px）；若明显偏移，记录缩放比例并开 issue。

### 表格只显示 1,000 行

有意设计：大表默认渲染前 1,000 行，顶部截断条写明总行数；点「加载全部」（二次确认）继续，上限 20,000 行 / 30 万格。不是加载失败。

### 表格没有网格线 / 行号列标

v0.1.0 起 xlsx 走 DOM 表格渲染，正常带网格与行列标；如果看到的是「转页图」样式，说明装的是旧版本（≤ 0.1.0 早期构建），升级后重启宿主。

## 3. 编辑与保存

### 保存报 409

文件在你编辑期间被外部（AI / 编辑器 / 另一个窗口）改了。面板会提示「内容已更新」：先刷新看新内容，再决定是否合并；不要强制覆盖。

### 保存后磁盘没变化

- 检查是否命中了「只读」预览态（确认文件类型走的是可编辑链路：文本类才可编辑；Office / PDF / 图片只读）。
- 看 Network 里 `PUT /plugins/dsh-file-review/api/file` 的状态码与响应体。
- 保存前会生成 `.bak`，可对比 `.bak` 与当前文件确认写入是否发生。

### 带 BOM 的文本 / 乱码

- 插件按 UTF-8 读写；原文件是 GBK 等编码时会显示乱码，保存前确认编码。
- 仓库自身的文本文件统一无 BOM（0.2.0 起）；如果你用工具生成文件，注意别带 BOM。

## 4. 批注与发送

### 点「发给 AI」没反应

- v0.2.0 走 Host `POST /plugins/dsh-file-review/api/send`：Network 里应看到该请求与状态码。
- 失败时面板会提示，并保留「复制到剪贴板」兜底。
- 确认当前会话处于可接收输入的状态（正在生成/中断中也可能拒绝）。

### 批注没还原 / 提示存储损坏

- 存储位置：`<当前会话工作区>/.dsh-file-review/`；换会话 / 换工作区看不到另一边的批注（按设计隔离）。
- 坏 JSON 会降级为空批注并提示，不会白屏；需要时删除对应文件重新建批注。
- 存储目录建议加进项目 `.gitignore`。

### 批注指向的原文变了

文件被改动后，旧批注会标 stale（锚号不再保证指向原文）。刷新后重新确认，或删掉旧批注重加。

## 5. 性能与资源

- 首次打开大文档要转换，慢是正常的；有 loading 骨架且可取消。
- 连续打开多个大文件会占内存，标签最多 8 个；用完关标签。
- 隔离验收实例（`DSH_HOME` + `dsh web --port`）用完要结束进程，避免占内存/端口。

## 6. 媒体与画质（v0.3.0）

### 页图放大后还是糊

1. 确认版本 ≥ v0.3.0：页图默认 **240 DPI**（A4 约 2040px 宽），默认面板宽 816px 放到 250% 正好 1:1。
2. 更宽窗口下仍嫌糊属已知问题，等 0.3.1 的「单页按需 300/400 DPI」；渲染器有 16 MiB 像素缓冲，A4 实际封顶约 **416 DPI**，不要往上调。
3. 确认预览命中新缓存：缓存目录名带 DPI（`<sha256>-240`），旧 120 DPI 目录不会被复用。

### 视频 / 音频打不开、黑屏或一直转圈

1. 看错误卡文案：如果是「浏览器不支持这个编码」，转成 **MP4(H.264) + AAC** 或 **WebM(VP9) + Opus** 即可；H.264 的 `mov` 可播，HEVC 编码或非 H.264 的 `mov`（包括 QuickTime 无帧）会在约 2.5 s 内出错误卡，属浏览器能力限制。
2. 裸 ADTS `.aac` 在部分 Chromium 下不稳，同样按错误卡处理（可转 `m4a`）。
3. 若只有一张黑屏、没有错误卡，把 Console / Network 里 `/raw` 的状态码发到 issue。

### 进度条拖不动

1. 确认是 v0.3.0+：`/raw` 支持 Range——`200` 全量、`206 + Content-Range`、`416 + bytes */size`，并补了 `HEAD`。
2. 若前面有代理 / 反向代理，确认没有剥掉 `Range` 请求头和 `Accept-Ranges` 响应头。

### 时间码批注

播放器工具栏点「＋ 批注视频 00:42」按当前秒加批注；点批注卡会 seek 回该秒。消息里是 `视频 00:42 【意见】…`，不带【原文】。

### 文件过大 / 格式不支持

- 媒体单文件上限 **4 GB**，超出直接给「文件过大」错误卡，不会整读进内存。
- `tiff` / `heic` 浏览器不认，先转 PNG（`magick x.tiff x.png`）；面板给 415 `UNSUPPORTED_PREVIEW` 专属「这个格式暂不支持预览」提示。

## 7. 取证与提 issue

提 issue 前收集：

1. DSH 版本（`dsh --version`）、插件版本（package.json 或 commit）、OS、Node 版本；
2. 复现步骤、期望 / 实际结果；
3. 截图或录屏（脱敏：别带本机路径、用户名、业务数据）；
4. 浏览器 Console / Network 里 `plugins/dsh-file-review/api/*` 的状态码与响应体；
5. 宿主日志里的插件 apply 报错（如有）。

模板见 [`.github/ISSUE_TEMPLATE/bug_report.md`](../.github/ISSUE_TEMPLATE/bug_report.md)。安全漏洞不要公开开 issue，按 [SECURITY.md](../SECURITY.md) 走私密通道。

## 8. 快速自检脚本

```powershell
# 工程自检（构建 + bundle 契约 + Host/Client 用例）
& "C:\Program Files\nodejs\npm.cmd" run verify

# 检查是否装进 profile（隔离实例方式，不碰正在用的 GUI）
$env:DSH_HOME = "D:\dsh-lab\home"
dsh plugin --profile web add "<工程绝对路径>"
dsh --profile web --dump-config | Select-String "dsh-file-review"
```

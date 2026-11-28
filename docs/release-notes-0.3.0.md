# v0.3.0 — 看得更清，也看得见视频和音频

> 状态：定稿发布（2026-11-28）。verify 全绿、媒体验收与 `at` 刷新保留均已复测通过。

v0.2.0 解决了「批注会丢、只能看一个文件、文件被改发现不了」；用起来后暴露两个更直接的短板：**页图放大就糊**，以及**视频、音频根本打不开**。v0.3.0 就干这两件事，顺带把图片格式补齐。

## 亮点

- **画质**：页面渲染 DPI 从固定 120 提到 **240**（docx 2040×2640、pptx 3200×1801、pdf 2040×2640；A4 约 2040px 宽），默认面板宽约 816px 放到 250% 正好 1:1 清晰，不再糊；图片预览始终原图，不重采样。
- **视频**：`mp4` / `m4v` / `webm` / `ogv` / `mov`（H.264）内嵌原生播放器，Host 复用 `/raw` 做 HTTP Range 流式（`200`/`206`/`416` + `HEAD`），可拖动进度条、暂停、切换文件；单文件上限 4 GB，流式不整读。HEVC / 非 H.264 `mov` 由 2.5 s 看门狗出错误卡，不黑屏。
- **音频**：`mp3` / `wav` / `m4a` / `aac` / `flac` / `ogg` / `oga` / `opus` 内嵌播放器，同样支持拖动与暂停。
- **时间码批注**：在某一秒点「＋ 批注视频 00:42」，批注消息带 `视频 00:42 【意见】…`，点批注卡 seek 回该秒。
- **更多图片**：`avif`、`ico`；`tiff` / `heic` 走 415 `UNSUPPORTED_PREVIEW` 专属错误卡（「这个格式暂不支持预览」+ 转 PNG 建议），不黑屏。
- **格式支持矩阵**：README 新增完整矩阵，一眼看清每种格式能不能看、批注落在哪、放不了时给什么提示。

## 同时修复

- `tiff` / `heic` 等不支持格式与 HEVC / 非 H.264 编码的错误提示改成可操作建议（转 PNG / 转 MP4）；HEVC 用 `loadedmetadata` + 2.5 s 看门狗判定，不按容器 brand 误杀 H.264 `mov`；媒体时间码批注刷新后丢 `at` 的问题已修（Host 白名单保留 `at` + 回归用例）。

## 文档

- README：新增「支持格式」矩阵、路线图更新、媒体界面预览（设计参考稿，真机截图验收后替换）。
- `docs/usage.md` / `docs/troubleshooting.md`：已补媒体播放、时间码批注与画质相关说明。
- `CHANGELOG.md`：新增 `[0.3.0]`。

## 升级

```powershell
# 工程内
& "C:\Program Files\nodejs\npm.cmd" ci
& "C:\Program Files\nodejs\npm.cmd" run verify

# 插件装进 desktop profile（首次或每次构建后）
dsh plugin --profile desktop add "<仓库绝对路径>"
```

- 从 v0.2.0 升级：host 半需重启桌面宿主才生效，client 半刷新即可；重启会断当前 GUI 会话。
- 批注数据不迁移：v0.2.0 的 `.dsh-file-review/` 批注仍按工作区路径读取，无需手工处理；媒体预览不产生新持久化数据。
- 旧构建的预览缓存（120 DPI）不会被新版本复用，首次预览 docx/pptx/pdf 会重新转换一次。

## 验证

- `npm run verify` 全绿：契约 **12/12**、Host **93/93**、client **52/52**、**EXIT=0**
- 产物：`lib/index.js` **85,688 B** SHA256 `F23F7B636B0ED44D064945F06FA42BF24758D5FF08C6CD2E9B995CD55A3810EB`；`lib/client.js` **128,270 B** SHA256 `B5B5C81B01BE94ECA745F9B315D7133C276B0CD97CF04F266A5BBA5E960DC8DB`
- DPI 实测：docx 2040×2640 / 252 KB / 8.6 s，pptx 3200×1801 / 80 KB / 9.4 s，pdf 2040×2640 / 309 KB / 2.8 s（与 200 DPI 差 0.4–2.4 s，主要耗时在 Kit 冷启动；渲染器 16 MiB 像素缓冲，A4 实际封顶约 416 DPI）
- 媒体 Range：`200` / `206 + Content-Range + Accept-Ranges` / `416 + bytes */size`、`HEAD`、后缀 range、背压经 Searching 逐行核验通过
- Claw 隔离实例验收：HEVC **234 ms** 出卡且批注 / 导出 / 发送置灰；TIFF **117 ms** 出专属文案；h264 `.mp4` / `.mov` 回归正常（duration 5、640×360、readyState 4）；时间码批注：00:03 加批注后刷新，卡片仍显示「视频 00:03 / 媒体」，点「定位」跳回 3 s 并播放（store 中 `block.at=3` 保留）；120 vs 240 对比 V-22 由 Design 判过，证据 `D:\dsh-lab\ui\quality\dpi-hairline-compare.png`、`dpi-compare-crop.png`。

## 已知限制

- 时间码批注以秒为单位（精度约 ±1 s），毫秒级定位不做。
- 视频/音频能否播放取决于浏览器原生编解码能力：H.264 + AAC 的 `mp4`、VP9 + Opus 的 `webm` 最稳，H.264 `mov` 可播；HEVC / 非 H.264 `mov` 给错误卡与转码建议。
- `tiff` / `heic` 不做内嵌转码，只提示转换。
- 媒体单文件上限 4 GB。
- 宽窗口下更高清的「单页按需 300/400 DPI」留 0.3.1。

## 安全

同 v0.2.0：[SECURITY.md](../SECURITY.md)（GitHub Security Advisories 私密通道 + 备用邮箱）。媒体预览与文档预览共用同一套工作区 realpath 校验，只接受本机 DSH GUI 请求。

## 致谢

- DSH 插件开发指南：<https://github.com/anweat/dsh-plugin-dev-guide>
- 同类先例：[actcwlf/dsh-any-preview](https://github.com/actcwlf/dsh-any-preview)、[dadgrand/dsh-file-preview](https://github.com/dadgrand/dsh-file-preview)

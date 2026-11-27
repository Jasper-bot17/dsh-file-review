# v0.2.0 — 批注会记住，文件能对照

v0.1.0 把「预览 → 改 / 批注 → 回传 AI」跑通之后，日常使用暴露出三块短板：批注一刷新就没了、一次只能看一个文件、文件被 AI 改了发现不了。v0.2.0 就是补这三件事，顺手把工程卫生做干净。

## 亮点

- **批注持久化**：批注自动存到当前会话工作区 `.dsh-file-review/`，重开面板 / 刷新页面后还原；文件被改动后旧批注标 stale，不假装还指向原文；支持导出 `.annotations.md`。
- **多文件标签**：一次最多开 8 个文件，标签切换 / 关闭，对照多个产出不用反复翻文件树。
- **快捷键**：`Ctrl/Cmd + S` 保存、`Ctrl/Cmd + Enter` 发送批注、`Esc` 关闭 / 取消。
- **外部修改提示**：AI 或编辑器改动文件后面板提示「内容已更新」，一键刷新；有未保存编辑先提示冲突。
- **真机截图**：README 的界面预览从设计参考稿换成真机截图与录屏 GIF。

## 同时修复

- CI `actions/checkout`、`actions/setup-node` 升 v5（Node 20 EOL）。
- 全仓文本文件清除 UTF-8 BOM。
- pptx 拖选批注在最终构建上复跑并补回归。
- `ERR_CONVERT_TIMEOUT` 用真实超大文档补样本与回归。
- Node 版本口径统一 >= 22.13（`pdfjs-dist 6.5.438` 要求），推荐 24 LTS。

## 文档

- README 重写：截图/GIF、安装、使用、配置、快捷键、FAQ、架构入口、路线图。
- 新增 [`docs/usage.md`](usage.md)、[`docs/architecture.md`](architecture.md)、[`docs/troubleshooting.md`](troubleshooting.md)。
- [`docs/install.md`](install.md) 补 v0.2.0 验收项；`SECURITY.md` 支持版本 → 0.2.x；`CONTRIBUTING.md` 修死链与 Node 口径。

## 升级

从 0.1.0 升级：

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npm.cmd" run verify
dsh plugin --profile desktop add "<工程绝对路径>"
```

装进 desktop profile 后需**重启桌面宿主**才生效（Host 半只在启动时组装；重启会断当前会话、端口会变）。完整步骤见 [install.md](install.md)。

既有批注不会被自动迁移（0.1.0 未持久化）；升级后第一次打开文件重新加批注即可，之后会写入 `.dsh-file-review/`。

## 验证

- `npm run verify` 全绿：bundle 契约 **12/12**、Host 自测 **81/81**、client bundle **47/47**，`EXIT=0`；两轮重编字节一致。
- 发布构建：`lib/index.js` 80,855 B（SHA256 `CA9EFE04…B945B59`）、`lib/client.js` 121,632 B（SHA256 `0F56EEDD…7C2DC55`）。
- 持久化安全探针 22/22 通过（越界路径 / 512 KB 上限 / 并发合并 / 墓碑 / 坏 JSON 降级）。
- 完整样本矩阵与 headed Edge 回归结果见仓库 `CHANGELOG.md` 的 0.2.0 验证记录。

## 已知限制

- 行级 diff 高亮留 0.3.0；当前只有「内容已更新」提示与刷新。
- 扫描件、纯图片 PDF 只能整页批注。
- Office 转换速度依赖本机转换链。

## 安全

漏洞请走 [SECURITY.md](../SECURITY.md) 的私密通道，不要公开开 issue。

## 致谢

- [DSH 插件开发指南](https://github.com/anweat/dsh-plugin-dev-guide)
- 同类先例 [actcwlf/dsh-any-preview](https://github.com/actcwlf/dsh-any-preview)、[dadgrand/dsh-file-preview](https://github.com/dadgrand/dsh-file-preview)

# v0.1.0 — 预览、批注，直接回给 AI

首个公开版本。目标：把「AI 产出文件 → 人打开发现问题 → 反复用聊天描述 → AI 重做」这条高 token 成本的循环，换成一次结构化回传。

## 亮点

- **在工作区里就地预览**：`shell.overlay` 浮层面板，输入条左侧「📝 批注」入口，不打断会话。
- **文本直接编辑**：md/txt/csv/json/yaml 与常见代码文件可直接改、保存（自动 `.bak`，并发改动返回 409 不覆盖）。
- **选中就批注**：文本按行号区间，Office/PDF 按页 + 文字层选区，xlsx 按单元格/区域，图片按整图。
- **批注一键回传 AI**：格式化为「文件路径 + 版本 + 位置 + 原文摘录 + 意见」，走 Host 路由注入当前会话；消息可直接发送，也可先确认再发。
- **四类 Office / PDF 格式**：docx / xlsx / pptx / pdf 均为本地解析，不上传文件。
- **本地安全边界**：只读写当前会话工作区（realpath 校验、拒绝 `..` 与盘根），只监听 127.0.0.1。

## 安装

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npm.cmd" run build
& "C:\Program Files\nodejs\npm.cmd" run verify

dsh plugin --profile desktop add "C:\path\to\dsh-file-review"
```

装进 desktop profile 后需重启桌面宿主才生效（会断当前会话、端口会变）。完整步骤见 [docs/install.md](install.md)。

## 已验证

- 发布构建：`lib/index.js` 72,845 B（SHA256 `5AC6508ADCB1483063C9954A23F5D7CE98F7EB46EB4520A8D760474CE71C4763`）、`lib/client.js` 113,216 B（SHA256 `DC1BD77D2CB68AA02629862D2751DCD5D16259B9E5E1C2AE98A2789DC24ED23D`），`npm run verify` → 契约 12/12、Host 72/72、client 44/44、exit=0，重编字节一致。
- 16 样本安全矩阵 `ALL_DONE`：路径越界 403/400、zip 条目超限 404 `ZIP_TOO_MANY_ENTRIES`、超大文件 413、400KB 病态 sheet 94ms（门槛 ≤100ms）、非法 XML 实体 400。
- 视觉与交互（headed Edge 真实鼠标）：V-08 冻结窗格、V-18 大表截断 + 加载全部、V-20 加密错误卡、V-14 四档缩放偏移 0.03px、pdf 拖选批注落在最终构建上。
- 真机：desktop profile 安装、批注入口出现、文本/Office 批注发送链路均跑通。

## 已知限制

- `ERR_CONVERT_TIMEOUT` 暂无真实样本，按能力限制记录。
- pptx 拖选回归是在 112,657 B 的 client 构建上完成的（其后文本层代码未变，未在最终构建复跑）。
- README 截图目前为设计参考稿渲染（假数据、已脱敏），真机截图出来后同名替换。
- 扫描件、纯图片 PDF 只能整页批注，没有可选文字层。

## 安全

漏洞请走 [SECURITY.md](../SECURITY.md) 的私密通道，不要公开开 issue。

## 致谢

- [DSH 插件开发指南](https://github.com/anweat/dsh-plugin-dev-guide)
- 同类先例 `dsh-file-preview`、`dsh-any-preview`：它们做预览，本项目补上「批注 → 回传 AI」闭环

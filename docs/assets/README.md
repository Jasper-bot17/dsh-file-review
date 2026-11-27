# docs/assets — README 与发布素材

README 里引用的图都在这里。**v0.1.0 版是设计参考稿渲染（假数据、已脱敏）；v0.2.0 起改用真机截图**，文件名不变，README 引用不用改。

## 规范

| 类型 | 尺寸 | 体积 | 格式 |
|---|---|---|---|
| 头图 `hero.png` | 1600×640（2.5:1） | ≤ 300 KB | PNG |
| 功能截图 | 1600×1000（16:10） | ≤ 500 KB | PNG |
| 架构图 `architecture.png` | 1600×900 | ≤ 500 KB | PNG |
| 演示 GIF `demo-flow.gif` | 1280×800 | ≤ 5 MB，10–15 s | GIF（10 fps） |

## 文件清单（当前 20 张图 + 本说明）

- 头图与流程：`hero.png`、`demo-flow.gif`
- 架构：`architecture.png`
- 文本：`panel-main.png`、`panel-composer.png`、`panel-confirm.png`、`panel-dark.png`
- Office / PDF：`office-preview.png`、`office-select.png`、`office-select-dark.png`、`office-loading.png`、`office-error.png`、`office-nolayer.png`
- 表格：`xlsx-preview.png`、`xlsx-preview-dark.png`、`xlsx-frozen.png`、`xlsx-truncated.png`
- 图片与错误态：`image-preview.png`、`image-encrypted.png`

**引用口径（2026-11-27）**：素材 **20/20 全被引用**——README 19 张 + `docs/architecture.md` 1 张（`assets/architecture.png`），全仓 md 坏链 0、missing 0。

## v0.2.0 换图计划

| 动作 | 文件 |
|---|---|
| 真机截图替换（17 张） | 除 `hero.png`、`architecture.png`、`demo-flow.gif` 外的全部截图 |
| 新增 3 张 | `tabs-multifile.png`（多文件标签）、`persist-restore.png`（批注持久化还原）、`external-update.png`（外部修改提示） |
| 重录 | `demo-flow.gif`（4 幕真机：打开面板 → 选中写批注 → 确认 → 发送） |
| 保留 | `hero.png`（营销头图，不是截图）、`architecture.png`（设计图） |

拍摄清单、场景与演示文件、每张图验收要点见仓库外的 `design/v0.2.0-素材拍摄清单.md`；演示工作区是 `D:\dsh-lab\ui\demo-workspace`（全假数据）。

## 这些图怎么来的

- **截图（v0.1.0）**：原型 HTML 在 Edge 无头 2 倍渲染，裁到面板范围再缩到目标尺寸：

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu `
  --hide-scrollbars --force-device-scale-factor=2 --window-size=1630,995 `
  --screenshot="raw.png" "file:///.../mockup-s1.html?theme=dark"
# 截图 3260×1990 → 裁 BOX=(320,100,2880,1700) → resize 到 1600×1000（GIF 为 1280×800）
```

- **截图（v0.2.0 起）**：隔离实例里 headed Edge + CDP，按 `.dsh-fr-panel` 的 rect 裁剪，再补边到 16:10、1600×1000。
- **架构图**：`design/architecture.html` 无头渲染 2 倍后裁 `(0,0)-(3200,1800)` → 1600×900。
- **GIF**：关键帧用 ffmpeg 合成，`fps=10` + `palettegen(max_colors=192)`，时长 10–15 s、≤5 MB。

## 替换约定

1. 真机截图保持同名、同尺寸、同体积上限，直接覆盖；
2. 截图只用演示工作区的假数据，别把本机路径、用户名、真实业务信息截进去；
3. 替换后跑一次引用检查（README 里 `docs/assets/xxx.png` 全部存在、无 missing）；
4. 深色图用 CDP 模拟 `prefers-color-scheme: dark`，不改系统主题。

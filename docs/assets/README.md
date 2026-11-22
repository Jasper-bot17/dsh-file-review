# docs/assets — README 与发布素材

README 里引用的图都在这里；文件是**设计参考稿渲染**（假数据、已脱敏：无本机绝对路径、无用户名），真机截图出来后**同名替换**，README 引用不用改。

## 规范

| 类型 | 尺寸 | 体积 | 格式 |
|---|---|---|---|
| 头图 `hero.png` | 1600×640（2.5:1） | ≤ 300 KB | PNG |
| 功能截图 | 1600×1000（16:10） | ≤ 500 KB | PNG |
| 演示 GIF `demo-flow.gif` | 1280×800 | ≤ 5 MB，10–15 s | GIF（10 fps） |

## 文件清单（19 个）

- 头图与流程：`hero.png`、`demo-flow.gif`
- 文本：`panel-main.png`、`panel-composer.png`、`panel-confirm.png`、`panel-dark.png`
- Office / PDF：`office-preview.png`、`office-select.png`、`office-select-dark.png`、`office-loading.png`、`office-error.png`、`office-nolayer.png`
- 表格：`xlsx-preview.png`、`xlsx-preview-dark.png`、`xlsx-frozen.png`、`xlsx-truncated.png`
- 图片与错误态：`image-preview.png`、`image-encrypted.png`

README 当前引用 13 个；`demo-flow.gif` 待插入，深色 / 加载 / 错误三张为可选项。各图建议 caption 与插入位置见仓库外的 `README截图清单.md`。

## 这些图怎么来的

用原型 HTML（设计稿，非插件真实截图）在 Edge 无头模式 2 倍渲染，再裁到面板范围、缩到上表尺寸：

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu `
  --hide-scrollbars --force-device-scale-factor=2 --window-size=1630,995 `
  --screenshot="raw.png" "file:///.../mockup-s1.html?theme=dark"
# 截图 3260×1990 → 裁 BOX=(320,100,2880,1700) → resize 到 1600×1000（GIF 为 1280×800）
```

GIF 由四帧（默认面板 / 批注气泡 / 发送确认 / 已发送 toast）用 ffmpeg 合成：`fps=10` + `palettegen(max_colors=192)`。

## 替换约定

1. 真机截图保持同名、同尺寸、同体积上限，直接覆盖；
2. 截图前用假数据，别把本机路径、用户名、真实业务信息截进去；
3. 替换后跑一次引用检查（README 里 `docs/assets/xxx.png` 全部存在、无 missing）。

# 安装与验证

> 口径来自 2026-11-18 在 Windows 11 + Node.js v24.18.0 + DSH desktop 上的实测；其他平台按需替换路径。命令用 PowerShell 写，cmd/bash 下换成对应语法即可。

## 1. 环境基线

| 项 | 要求 / 实测值 |
|---|---|
| Node.js | >= 22（实测 v24.18.0） |
| npm | 随 Node（Windows 下 `npm.ps1` 可能被执行策略拦截，用 `npm.cmd`） |
| DSH CLI | `dsh` 在 PATH（DSH 桌面应用自带；或 `npm i -g` 安装） |
| desktop profile | `~/.dsh/profiles/desktop` |
| GUI 端口 | 每次启动会变，文档/脚本不要写死 |

**两条依赖线要分开**：

- **装插件/激活（`dsh plugin`）**：内部固定使用 DSH 自带的 pnpm，不需要手动装或调用。
- **装工程依赖（本仓库）**：用 **npm**，和仓库里的 `package-lock.json` 对齐。

```powershell
& "C:\Program Files\nodejs\npm.cmd" install   # 裸 npm 被 PS 执行策略拦截时用全路径 npm.cmd
& "C:\Program Files\nodejs\npm.cmd" run build
& "C:\Program Files\nodejs\npm.cmd" run verify
```

**不要**在工程里跑 `pnpm install`：会生成第二套锁文件，与 `package-lock.json` 冲突。

## 2. 安装到 desktop profile（开发期）

```powershell
$proj = "C:\path\to\dsh-file-review"   # 换成工程绝对路径
dsh plugin --profile desktop add $proj
```

会发生的三件事：

1. `profiles\desktop\package.json` 的 `dependencies` 增加一条 `"<包名>": "link:<工程绝对路径>"`；
2. 同文件的 `dsh.profile.bundles` 数组追加 `<包名>`；
3. `node_modules\` 生成指向工程目录的 junction。

**不需要**手工编辑 `cordis.patch.yml`（插件自带的 patch 由 bundle 层合并）。

验证是否装进组合树：**`dsh --profile desktop --dump-config` 不可用**——desktop profile 由 Electron 宿主独占管理，会报 `profile "desktop" is managed exclusively by the Electron application`（exit 1）。两种可行验证：

1. 装到隔离 `DSH_HOME` 的 web profile，用 `dsh --profile web --dump-config` 查是否出现插件行（§4）；
2. 重启桌面宿主后，看会话输入框左侧的「📝 批注」入口是否出现。

卸载：

```powershell
dsh plugin --profile desktop remove dsh-file-review
```

> 实测：add/remove 都会自动 reconcile `dependencies` + `bundles`；remove 后 `node_modules` 里可能残留指向源目录的 junction（pnpm 未清，不影响后续 add）。

## 3. 重启影响

- **桌面宿主启动时才组装插件树**：`dsh plugin add` 只改 profile 文件，运行中的 GUI 不会自动加载 → **Host 半插件必须重启桌面应用**。
- **Client 半（`lib/client.js`）改动**：重新 build 后**刷新页面**即可，不用重启。
- **重启代价**：正在跑的轮次/会话会断、GUI 端口会变、未落盘内容有丢失风险。选空闲窗口并提前通知。
- 不建议强杀进程，尽量正常退出。

## 4. 免重启验收（隔离实例，可复用）

目的：不碰正在用的桌面 GUI，验证「插件装进去 → 宿主组装 → 浏览器能拿到 client bundle」整条链路。

```powershell
# 1) 隔离 DSH_HOME（不污染真实配置）
$env:DSH_HOME = "D:\dsh-lab\home"

# 2) 首次会生成 shipped web profile；把工程装进这个隔离 profile
dsh plugin --profile web add "C:\path\to\dsh-file-review"

# 3) 组合树里应出现插件行
dsh --profile web --dump-config | Select-String "dsh-file-review"

# 4) 后台起一个独立 web 实例（端口自选，别撞在用的）
dsh web --port 50123 --no-open --host 127.0.0.1
# 日志会打印 http://127.0.0.1:50123/?token=<TOKEN>，记下 token

# 5) 带 token 访问首页拿 cookie，再读页面里的 combo 链接
#    <script/link href="plugins/??<包>/client.js,...,&rev=...">
# 6) GET 该 combo URL，应 200 且内含 window.__ModuleLoader__.load({ id: "<包名>", ... })
```

**注意**：单个包直链 `/plugins/<包名>/client.js` 返回 404 是正常的——client 模块只从组合路由 `/plugins/??<id>/client.js,<id2>/client.js&rev=...` 出去；`/plugins/<包名>/assets/*` 才是包内静态资源路由。

验完记得结束该进程（内存紧张时尤其重要）。

## 5. 验收清单（装到 desktop 后逐条勾）

- [ ] `dsh plugin --profile desktop add <工程绝对路径>` exit 0，输出含 `+ <包名> <version> <- <路径>`
- [ ] 隔离 web profile 的 `--dump-config` 能搜到 `- id: dsh-file-review`（或重启后看到入口按钮）
- [ ] 重启桌面宿主后，GUI 正常启动、原有会话还在
- [ ] 会话输入区左侧出现「📝 批注」入口
- [ ] 打开工作区文本文件能预览；编辑保存后磁盘内容变化、生成 `.bak`
- [ ] 选中文本能加批注；批注列表可删；「发给 AI」后会话里出现对应消息
- [ ] 越界路径（工作区外、`..`、盘根）被拒并有明确报错
- [ ] `dsh plugin --profile desktop remove dsh-file-review` 后重启，入口消失、profile 干净

## 6. 已知问题

1. PowerShell 5.1 禁止执行 `.ps1`（ExecutionPolicy Restricted）→ 用 `powershell -NoProfile -ExecutionPolicy Bypass -File xxx.ps1`。
2. PowerShell 5.1 `Get-Content` 默认按 GBK 读 UTF-8 中文会乱码 → 显式 `-Encoding UTF8`。
3. `dsh plugin` 的 pnpm store 在 C 盘无法硬链时会警告并自动切到别的盘，属正常。
4. 桌面 GUI 端口每次启动变化，文档/脚本别写死；从 `dsh web` 日志或窗口地址栏取。
5. 验收用的隔离实例用完必须杀进程，避免挤占正在使用的 GUI。
6. `dsh --profile <p> --dump-config` 是**只读**组合检查，不启动服务，可以随便跑。

# GitObsidian

Obsidian vault Git 同步插件 —— **Simple Git Sync**

一个零依赖的 Obsidian 插件，把笔记同步到 GitHub。支持**选择只提交哪些文件夹**，点状态栏直接操作，不用进设置。

**一个 vault 对应一个 Git 仓库**：仓库根目录就是 vault 根目录。多个 vault 分别连接各自的仓库；文件夹选择只控制该 vault 内的本地提交范围。

## 为什么做这个

现有的 obsidian-git 插件功能强大但偏重：移动端不稳定、配置项多、冲突处理复杂。这个插件只做三件事：

1. **上传** — 提交并推送
2. **下载** — 拉取远程
3. **同步** — 提交 + 拉取 + 推送

外加一个**文件夹选择器**：一个仓库里多个笔记文件夹，可以只提交其中某几个的本地改动。

## 特性

- **状态栏操作面板** — 点右下角 `Git · 就绪`，所有操作直接可点
- **文件夹选择器** — 勾选哪些文件夹参与提交和推送；拉取仍更新整个仓库
- **自动同步** — 按间隔自动 commit + pull + push
- **新设备接入** — 克隆仓库并作为 vault 打开后，自动读取 `origin` 地址
- **安装到 .obsidian** — 源码目录 → 插件目录，一键重载
- **零依赖** — 纯 JS 单文件，不需要 npm install，不需要构建
- **令牌安全** — 存在 `.obsidian/plugins/*/data.json`，用本地规则排除；若已被 Git 跟踪则停止同步

## 目录

```
GitObsidian/
├── simple-git-sync/
│   ├── main.js                 # 插件主文件
│   ├── manifest.json
│   ├── README.md
│   ├── USAGE.md                # 详细使用说明
│   └── test-harness{,2,3,4,5,6,7,8}.js   # 测试脚本
├── install.ps1                 # 安装到指定 vault
├── push-to-github.ps1          # 一键推送
└── README.md
```

## 安装

```powershell
.\install.ps1 -Vault "D:\path\to\vault"
```

或手动：把 `simple-git-sync/main.js` 和 `manifest.json` 复制到 `<vault>/.obsidian/plugins/simple-git-sync/`。

重启 Obsidian → 设置 → 第三方插件 → 关闭「限制模式」→ 启用 **Simple Git Sync**。

## 配置

设置 → 第三方插件 → Simple Git Sync：

| 项 | 说明 |
| --- | --- |
| 仓库地址 | `https://github.com/用户名/仓库名.git` |
| 分支 | 默认 `main` |
| GitHub 用户名 | 你的账号名 |
| 访问令牌 (PAT) | Fine-grained token，权限 **Contents: Read and write** |
| 插件源码目录 | 供「安装到 .obsidian」使用 |
| 自动同步 | 建议开，10 分钟 |

### 申请 PAT

GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token

- **Repository access**: All repositories（或选中需要的）
- **Repository permissions → Contents**: **Read and write**
- **Metadata**: 自动勾选 Read-only

> ⚠️ 如果只选 "Only select repositories"，新建的仓库默认不在授权列表里，会报 403。

## 使用

点状态栏 `Git · 就绪`：

```
┌─ Git 同步 ──────────────────────┐
│ 仓库：已初始化                   │
│ 同步范围：SIGMOD2027             │
│ 上次同步：2026/11/3 20:45:12     │
│                                  │
│ 同步                             │
│ [同步选中] [全部同步] [上传] [下载]│
│                                  │
│ 文件夹                           │
│ [选择要同步的文件夹]             │
│                                  │
│ 维护                             │
│ [安装到 .obsidian] [取消合并] [刷新] │
└──────────────────────────────────┘
```

详细用法见 [USAGE.md](simple-git-sync/USAGE.md)。

新设备上先克隆对应的笔记仓库，再在 Obsidian 中把克隆目录作为 vault 打开。插件会读取该仓库的 `origin`；令牌等本地设置仍需在新设备配置。

## 三种同步范围的优先级

1. **选中的文件夹**（`selectedFolders`）
2. **同步范围**（`syncPaths` 多行路径）
3. **整仓**

## 测试

用 Node 直接加载插件代码（mock 掉 obsidian 模块），对本地 bare 仓库跑真实 git 操作：

```powershell
node simple-git-sync/test-harness.js  <临时目录>
node simple-git-sync/test-harness2.js <临时目录>
node simple-git-sync/test-harness3.js <临时目录>
node simple-git-sync/test-harness4.js <临时目录>
node simple-git-sync/test-harness5.js <临时目录>
node simple-git-sync/test-harness6.js <临时目录>
node simple-git-sync/test-harness7.js <临时目录>
node simple-git-sync/test-harness8.js <临时目录>
```

| 套件 | 断言数 | 覆盖 |
| --- | --- | --- |
| test-harness.js | 14 | init / 上传 / 下载 / 同步 / 无改动 / 非仓库 |
| test-harness2.js | 12 | 远程非空 / 冲突 / 取消合并 / 令牌脱敏 |
| test-harness3.js | 15 | 限定目录同步、pathSpec 边界、范围不存在时停止提交 |
| test-harness4.js | 20 | 安装命令、文件筛选、manifest 校验、绝对路径 |
| test-harness5.js | 19 | 文件夹选择器、部分提交、过滤不存在目录 |
| test-harness6.js | 21 | 操作面板、首次上传、全部同步 |
| test-harness7.js | 12 | 一 vault 一仓库、克隆后同步与 origin 识别 |
| test-harness8.js | 23 | 本地排除规则与令牌文件保护 |

共 136 个断言。运行时请给每套测试传入独立临时目录。

## 已知限制

- 仅桌面端（需要 `child_process` 调原生 git）
- clone 是仓库级，不能只拉一个文件夹
- 文件夹选择和同步范围只限制本地提交；`git pull` 会更新整个仓库
- 父目录仓库包含多个 vault 的布局不再支持；请为每个 vault 建立独立仓库
- 冲突不自动解决，只提示；用「取消未完成的合并」回滚
- 大文件建议 Git LFS，本插件未集成

## 设计取舍

| 项 | 选择 | 原因 |
| --- | --- | --- |
| 冲突 | 只提示，不自动解决 | 自动合并 Markdown 很危险 |
| 认证 | 只用 HTTPS + PAT | 跨平台一致，SSH 在 Windows 上坑多 |
| 依赖 | 零 | 不需要构建，改完直接重载 |
| 行尾 | `.gitattributes` 写 `* -text` | 防 Windows CRLF / Mac LF 互踩 |
| 凭据 | 所有 git 调用加 `credential.helper=` | 避免系统凭据管理器弹窗卡死自动同步 |

## 许可

MIT

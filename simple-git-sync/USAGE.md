# Simple Git Sync 使用说明

## 管理范围：整个 vault

插件管理的是**整个 Obsidian vault**，不只是笔记。

```
vault/
├── .obsidian/          ← 同步（除 workspace.json 和 data.json）
│   ├── app.json            编辑器设置
│   ├── appearance.json     主题
│   ├── core-plugins.json   核心插件开关
│   ├── community-plugins.json  第三方插件开关
│   ├── graph.json          图谱设置
│   └── plugins/            已安装的插件
├── .git/               ← 不同步（git 自己用）
├── .gitignore          ← 同步
├── .gitattributes      ← 同步
└── 你的笔记/            ← 同步
```

**为什么管 vault 而不是只管笔记**：Mac clone 下来后，插件装好了、主题对了、快捷键同步了，只需要填一次 PAT 就能用。只管笔记的话，每次换设备都要手动装插件。

## 不会影响日常用笔记

Obsidian 默认**不显示以 `.` 开头的文件/文件夹**，所以：

| 硬盘上有的 | Obsidian 里看得见吗 |
|---|---|
| `.git/` | ❌ 隐藏 |
| `.obsidian/` | ❌ 隐藏 |
| `.gitignore` | ❌ 隐藏 |
| `.gitattributes` | ❌ 隐藏 |
| `SIGMOD2027/` | ✅ 可见 |

**你打开 Obsidian 只会看到自己的笔记文件夹，和用普通 Obsidian 没区别。**

## 不同步的两个文件

| 文件 | 不同步原因 |
| --- | --- |
| `.obsidian/workspace.json` | 每台设备的窗口布局不同（面板位置、大小），同步必冲突 |
| `.obsidian/plugins/*/data.json` | **存着 GitHub 访问令牌**，绝对不能提交 |

这两个已在 `.gitignore` 里排除。

## 最常用：点右下角状态栏

**点状态栏的 `Git · 就绪`，直接弹出操作面板**。

```
┌─ Git 同步 ──────────────────────┐
│ 仓库：已初始化                   │
│ 同步范围：SIGMOD2027             │
│ 上次同步：2026/11/3 21:05:12     │
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

## 核心概念：一个仓库，多个文件夹，选着同步

```
GitHub: BertQLi/MyObsidian
├── .obsidian/
├── SIGMOD2027/
├── 笔记A/
└── 笔记B/
```

**勾选的才同步，没勾的原封不动。**

实测：三个文件夹都改了，只勾「笔记A」→ 只有笔记A 被提交推送，另外两个仍在工作区未提交。

## 三种同步范围的优先级

1. **选中的文件夹**（`selectedFolders`）—— 最优先
2. **同步范围**（`syncPaths` 多行路径）
3. **整仓** —— 两者都为空时

## 新增笔记文件夹

1. 在 vault 里建文件夹，比如 `笔记C`
2. 点状态栏 → 「选择要同步的文件夹」
3. 勾上 `笔记C`，保存

## 新设备接入（Mac）

```bash
git clone https://github.com/BertQLi/MyObsidian.git ~/MyObsidian
git config --global core.precomposeunicode true   # 中文文件名 NFC/NFD
```

1. Obsidian 打开这个文件夹作为 vault
2. 插件**已经在了**（`.obsidian/plugins/simple-git-sync/`）
3. 设置 → 第三方插件 → 关闭限制模式 → 启用 **Simple Git Sync**
4. 填配置：仓库地址、用户名、PAT（`data.json` 含令牌所以没同步，要填一次）
5. 点状态栏 → 「选择要同步的文件夹」

## 改插件后怎么生效

| 位置 | 作用 |
| --- | --- |
| `D:\...\note\obsidian-simple-git-sync\simple-git-sync\` | 源码（独立仓库，GitObsidian） |
| `vault\.obsidian\plugins\simple-git-sync\` | Obsidian 实际加载的副本（同步到笔记仓库） |

改完源码 → 点状态栏 → 「安装到 .obsidian」→ 弹窗点「立即重载插件」。

插件设置里的「插件源码目录」填绝对路径：
```
D:/Personal/博士/并行训练/note/obsidian-simple-git-sync/simple-git-sync
```

## 安全

- PAT 存在 `.obsidian/plugins/simple-git-sync/data.json`，已在 `.gitignore`
- 令牌只在执行 git 时通过 URL 临时传入，不写进 `.git/config`
- 所有 git 调用加 `credential.helper=`，避免凭据管理器弹窗卡死自动同步

## 当前状态（2026-11-03）

```
笔记仓库:   https://github.com/BertQLi/MyObsidian.git
仓库内容:   .obsidian 配置 + 插件 + SIGMOD2027/（11 个文件）
选中文件夹: SIGMOD2027
自动同步:   关（设置里可开，建议 10 分钟）
插件源码:   https://github.com/BertQLi/GitObsidian.git
备份:       D:\Personal\博士\并行训练\note\_backup\
```


## 多 vault 模式（一个仓库管多个 vault）

### 结构

```
MyObsidian/                  ← git 仓库根
├── .gitignore
├── 并行训练-vault/          ← Obsidian vault 1（有自己的 .obsidian/）
│   ├── .obsidian/
│   ├── SIGMOD2027/
│   └── 其他笔记/
└── 私人笔记-vault/          ← Obsidian vault 2
    ├── .obsidian/
    └── 日记/
```

**Obsidian 打开的是子文件夹**（比如 `MyObsidian/并行训练-vault`），不是 `MyObsidian` 本身。

### 插件怎么识别

启动时自动检测：

| 检测项 | 方法 |
| --- | --- |
| 仓库根在哪 | `git rev-parse --show-toplevel` |
| 当前 vault 相对仓库的位置 | `git rev-parse --show-prefix` |

操作面板会显示「本 vault 位置」：
- `仓库根` —— 单 vault 模式（vault 就是仓库根）
- `仓库内 并行训练-vault` —— 多 vault 模式

### 同步行为

**在哪个 vault 里点同步，就只同步哪个 vault。**

实测：vaultA 里点同步，只有 `vaultA/` 的文件被提交推送，`vaultB/` 的改动原封不动留在本地。

实现方式：所有 git 操作加 `-- .` 限定，git 在子目录执行时天然把当前目录当范围。

### 两层选择

```
MyObsidian 仓库
├── vaultA          ← 第一层：当前打开哪个 vault
│   ├── 笔记X       ← 第二层：vault 内选哪个文件夹（文件夹选择器）
│   └── 笔记Y
└── vaultB
```

两个选择可以叠加：只同步 `vaultA/笔记X`，`vaultA/笔记Y` 和整个 `vaultB` 都不动。

### 迁移到多 vault

1. 建一个父目录当仓库根，比如 `D:\...\note\MyObsidian\`
2. 把现有 vault 移进去：`MyObsidian\并行训练-vault\`
3. 在仓库根 `git init` 并关联远程
4. Obsidian 重新打开 `MyObsidian\并行训练-vault` 作为 vault

> 注意：移动后 Obsidian 的 vault 列表会失效，需要在「打开其他仓库」里重新添加路径。

## 已知限制

- 仅桌面端
- clone 是仓库级，不能只拉一个文件夹
- 冲突不自动解决，只提示
- 大文件建议 Git LFS，未集成
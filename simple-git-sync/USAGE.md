# Simple Git Sync 使用说明

## 一个 vault 对应一个仓库

插件管理的是**整个 Obsidian vault**，仓库根目录必须就是 vault 根目录。多个 vault 各自使用独立的 GitHub 仓库。

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
├── .gitignore          ← 本地保留，不同步
├── .gitattributes      ← 本地保留，不同步
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

这些文件由本地 `.git/info/exclude` 规则排除；如果此前已被 Git 跟踪，插件会停止同步并提示处理。

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

## 可选：只提交部分文件夹

```
GitHub: BertQLi/MyObsidian
├── .obsidian/
├── SIGMOD2027/
├── 笔记A/
└── 笔记B/
```

**勾选范围只控制本地提交和推送。拉取远程时，其他文件夹也可能更新。**

实测：三个文件夹都改了，只勾「笔记A」→ 只有笔记A 被提交推送，另外两个仍在工作区未提交。

## 三种同步范围的优先级

1. **选中的文件夹**（`selectedFolders`）—— 最优先
2. **同步范围**（`syncPaths` 多行路径）
3. **整仓** —— 两者都为空时

## 新增笔记文件夹

1. 在 vault 里建文件夹，比如 `笔记C`
2. 点状态栏 → 「选择要同步的文件夹」
3. 勾上 `笔记C`，保存

## 新设备接入

```bash
git clone https://github.com/你的用户名/笔记仓库.git <vault目录>
```

1. Obsidian 打开这个文件夹作为 vault
2. 如果插件文件也在笔记仓库中，它已随仓库克隆；否则按安装说明放入 `.obsidian/plugins/simple-git-sync/`
3. 设置 → 第三方插件 → 关闭限制模式 → 启用 **Simple Git Sync**
4. 插件会自动读取这个仓库的 `origin` 地址；按需要填写用户名和 PAT（`data.json` 不同步）
5. 点状态栏执行「下载」或「同步」；只有想限制本地提交范围时才选择文件夹

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

- PAT 存在 `.obsidian/plugins/simple-git-sync/data.json`，同步前由本地排除规则保护
- 令牌只在执行 git 时通过 URL 临时传入，不写进 `.git/config`
- 所有 git 调用加 `credential.helper=`，避免凭据管理器弹窗卡死自动同步

## 多个 vault 的管理方式

每个 vault 单独对应一个 GitHub 仓库：工作笔记、私人笔记可以有各自的历史、远程地址和同步状态。Obsidian 打开的目录同时就是该仓库的根目录。

旧版支持“一个父仓库包含多个 vault”。这会让拉取影响兄弟 vault，因此当前插件会识别并拒绝这种布局。迁移时请先保留旧仓库备份，再把每个 vault 放到父仓库之外，分别建立独立仓库。需要保留各 vault 的旧提交历史时，应先规划 Git 历史拆分，不要直接删除旧仓库。

## 已知限制

- 仅桌面端
- clone 是仓库级，不能只拉一个文件夹
- 冲突不自动解决，只提示
- 大文件建议 Git LFS，未集成

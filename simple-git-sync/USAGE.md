# Simple Git Sync 使用说明

## 最常用：点右下角状态栏

**点状态栏的 `Git · 就绪`，直接弹出操作面板**，不用进设置、不用记命令。

```
┌─ Git 同步 ──────────────────────┐
│ 仓库：已初始化                   │
│ 同步范围：SIGMOD2027             │
│ 上次同步：2026/11/3 20:45:12     │
│ 结果：已同步 SIGMOD2027          │
│                                  │
│ 同步                             │
│ [同步选中] [全部同步] [上传] [下载]│
│                                  │
│ 文件夹                           │
│ [选择要同步的文件夹]             │
│                                  │
│ 维护                             │
│ [安装到 .obsidian] [取消未完成的合并] [刷新] │
│                                  │
│ ▸ 详细信息                       │
└──────────────────────────────────┘
```

点按钮执行完，面板会自动刷新显示最新状态。

## 按钮说明

| 按钮 | 作用 |
| --- | --- |
| **同步选中** | 只同步勾选的文件夹（日常用这个） |
| **全部同步** | 同步整个仓库 |
| **上传** | 只提交 + 推送，不拉取 |
| **下载** | 只拉取远程，不推送 |
| **选择要同步的文件夹** | 弹出勾选框，选哪些文件夹参与同步 |
| **安装到 .obsidian** | 源码 → 插件目录，可一键重载 |
| **取消未完成的合并** | 冲突时回滚 |
| **刷新** | 重新读取状态 |

## 核心概念：一个仓库，多个文件夹，选着同步

```
GitHub: BertQLi/MyObsidian
├── SIGMOD2027/
├── 笔记A/
└── 笔记B/

本地 vault: D:\Personal\博士\并行训练\note\并行训练\
├── .obsidian/        ← 只在本地，不同步
├── SIGMOD2027/
├── 笔记A/
└── 笔记B/
```

**勾选的才同步，没勾的原封不动。**

实测：三个文件夹都改了，只勾「笔记A」→ 只有笔记A 被提交推送，另外两个仍在工作区未提交。

状态栏显示 `Git · 就绪 · SIGMOD2027`，一眼看出当前同步范围。

## 命令面板（备用）

点状态栏不方便时，`Ctrl+P` 搜 "Git" 也有全部命令：

| 命令 | 作用 |
| --- | --- |
| 打开操作面板 | 等同于点状态栏 |
| 选择要同步的文件夹 | |
| 同步选中的文件夹 | |
| 同步（提交 + 拉取 + 推送） | |
| 上传 / 下载 | |
| 安装到 .obsidian | |
| 查看仓库状态 | |
| 取消未完成的合并 | |
| 初始化仓库并首次上传 | |

## 三种同步范围的优先级

1. **选中的文件夹**（`selectedFolders`）—— 最优先
2. **同步范围**（`syncPaths`）—— 多行路径
3. **整仓** —— 两者都为空时

## 新增笔记文件夹

1. 在 vault 里建文件夹，比如 `笔记C`
2. 点状态栏 → 「选择要同步的文件夹」
3. 勾上 `笔记C`，保存

之后同步就会包含它。

## 关于 clone

**clone 是仓库级的，不能只 clone 一个文件夹。**

但仓库小的时候（几 MB），clone 一次不费事。换设备时 `git clone` 拿到所有文件夹，之后用文件夹选择器控制推哪些。

## .obsidian 配置

**完全不在版本控制里**（`.gitignore` 里有 `.obsidian/`）。

好处：仓库是纯笔记，干净。
代价：换设备要手动装插件、填令牌。

⚠️ `.obsidian/` **没有版本保护**。不要用 `git clean -fdx`、`git reset --hard`（实测会把 `.obsidian` 清空）。

备份：`D:\Personal\博士\并行训练\note\_backup\`

## 改插件后怎么生效

| 位置 | 作用 |
| --- | --- |
| `D:\...\note\obsidian-simple-git-sync\simple-git-sync\` | 源码（独立仓库） |
| `vault\.obsidian\plugins\simple-git-sync\` | Obsidian 实际加载的副本 |

改完源码 → 点状态栏 → 「安装到 .obsidian」→ 弹窗点「立即重载插件」。

## 安全

- PAT 存在 `.obsidian/plugins/simple-git-sync/data.json`
- `.obsidian/` 整个被 gitignore，令牌不会上传
- 令牌只在执行 git 时通过 URL 临时传入，不写进 `.git/config`
- 所有 git 调用加 `credential.helper=`，避免凭据管理器弹窗卡死自动同步

## 当前状态（2026-11-03）

```
仓库:       https://github.com/BertQLi/MyObsidian.git
远程内容:   .gitattributes + .gitignore + SIGMOD2027/（纯笔记）
选中文件夹: SIGMOD2027
自动同步:   关（设置里可开，建议 10 分钟）
```

## Mac 端接入

```bash
git clone https://github.com/BertQLi/MyObsidian.git ~/MyObsidian
git config --global core.precomposeunicode true
```

1. Obsidian 打开这个文件夹作为 vault
2. 手动装插件：拷 `main.js` + `manifest.json` 到 `.obsidian/plugins/simple-git-sync/`
3. 插件设置填仓库地址、用户名、PAT
4. 点状态栏 → 「选择要同步的文件夹」

## 已知限制

- 仅桌面端
- clone 是仓库级，不能只拉一个文件夹
- 冲突不自动解决，只提示
- 大文件建议 Git LFS，未集成

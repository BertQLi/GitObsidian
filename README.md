# Simple Git Sync — 插件开发环境

Obsidian 插件 `Simple Git Sync` 的源码仓库。**与笔记仓库完全独立。**

## 目录

```
obsidian-simple-git-sync/
├── simple-git-sync/
│   ├── main.js              # 插件主文件（零依赖，纯 JS）
│   ├── manifest.json
│   ├── README.md
│   ├── USAGE.md
│   └── test-harness{,2,3,4}.js   # 测试脚本
├── install.ps1              # 安装到指定 vault
├── push-to-github.ps1       # 一键推送（首次建仓用）
└── .git/
```

## 与笔记仓库的关系

| | 路径 | 内容 |
| --- | --- | --- |
| 笔记仓库 | `D:\Personal\博士\并行训练\note\并行训练\` | 只有笔记 + Obsidian 配置 |
| 开发环境 | `D:\Personal\博士\并行训练\note\obsidian-simple-git-sync\` | 插件源码（本仓库） |

笔记仓库里 `.obsidian/plugins/simple-git-sync/` 是**安装副本**（只有 main.js + manifest.json），从本仓库复制过去。

## 开发流程

1. 改 `simple-git-sync/main.js`
2. Obsidian 命令面板跑 **「安装到 .obsidian」**（插件设置里源码目录填本仓库的绝对路径）
3. 弹窗点 **「立即重载插件」**

## 测试

```powershell
node simple-git-sync/test-harness.js  <临时目录>
node simple-git-sync/test-harness2.js <临时目录>
node simple-git-sync/test-harness3.js <临时目录>
node simple-git-sync/test-harness4.js <临时目录>
```

55 个断言，覆盖主流程、边界、限定目录、安装命令。

## 推送到 GitHub（以后要建仓库时）

```powershell
# 1. GitHub 网页建空私有仓库（不勾 README）
# 2. 运行：
.\push-to-github.ps1 -Repo "https://github.com/你的用户名/simple-git-sync.git"
```

之后日常：
```powershell
git add -A
git commit -m "修复 xxx"
git push
```

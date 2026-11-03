# Simple Git Sync（Obsidian 插件）

极简版 Obsidian ⇄ GitHub 同步插件。零第三方依赖，纯 JS，无需构建，单文件 735 行。

## 功能

- **初始化仓库并首次上传** — 把当前 vault 目录变成 git 仓库，内容直接落到仓库根目录
- **上传（提交 + 推送）**
- **下载（拉取远程）**
- **同步（提交 + 拉取 + 推送）** — 可设自动同步间隔
- **安装到 .obsidian** — 把源码目录的 main.js/manifest.json 复制到插件目录，一键重载
- **查看仓库状态** — 点状态栏
- **取消未完成的合并** — 冲突回滚

## 限定同步范围（双轨同步）

设置里的**同步范围**填多行目录，只同步这些路径：

```
notes
.obsidian
```

这样笔记自动同步时**完全不碰** `plugins/`，插件源码手动推。留空则同步整个仓库。

实现方式：git pathspec 限定（`git add -A -- notes .obsidian`）。

## 安装

```powershell
.\install.ps1 -Vault "D:\path\to\vault"
```

或手动复制 `main.js`、`manifest.json` 到 `<vault>/.obsidian/plugins/simple-git-sync/`。

重启 Obsidian → 设置 → 第三方插件 → 关闭「限制模式」→ 启用 **Simple Git Sync**。

## 配置

| 项 | 说明 |
| --- | --- |
| 仓库地址 | `https://github.com/用户名/仓库名.git` |
| GitHub 用户名 | |
| 访问令牌 (PAT) | Fine-grained token，权限 Contents: Read and write + Metadata: Read |
| 插件源码目录 | 默认 `plugins/simple-git-sync`，供「安装到 .obsidian」使用 |
| 同步范围 | 每行一个目录，留空 = 整仓 |
| 自动同步 | 建议开，10 分钟 |

## 安全

- 令牌保存在 `.obsidian/plugins/simple-git-sync/data.json`
- 该路径已自动写入 `.gitignore`，不会被推送到仓库
- 推送/拉取时令牌通过 URL 参数临时传入，不写入 `.git/config`
- 所有 git 调用都加 `-c credential.helper=`，避免凭据管理器弹窗卡死自动同步

## 设计取舍

- 只支持桌面端（需要 `child_process` 调原生 git）
- 冲突不自动解决，只提示；用「取消未完成的合并」回滚
- 「安装到 .obsidian」手动触发而非自动：源码有语法错误时，自动复制会让 Obsidian 下次启动直接加载失败

## 测试

用 Node 直接加载插件代码（mock 掉 obsidian 模块），对本地 bare 仓库跑真实 git 操作：

| 套件 | 断言数 | 覆盖 |
| --- | --- | --- |
| test-harness.js | 14 | init / 上传 / 下载 / 同步 / 无改动 / 非仓库 |
| test-harness2.js | 9 | 远程非空 / 冲突 / 取消合并 / 令牌 URL / SSH 地址 |
| test-harness3.js | 12 | 限定目录同步、pathSpec 边界、目录不存在退化 |
| test-harness4.js | 17 | 安装命令、文件筛选、manifest 校验、幂等 |

**52 个断言全绿。**

```powershell
node test-harness.js  <临时目录>
node test-harness2.js <临时目录>
node test-harness3.js <临时目录>
node test-harness4.js <临时目录>
```

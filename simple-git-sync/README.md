# Simple Git Sync（Obsidian 插件）

极简版 Obsidian ⇄ GitHub 同步插件。零第三方依赖，纯 JS，无需构建。

每个 vault 对应一个 Git 仓库，仓库根目录就是 vault 根目录。克隆到新设备后，插件会自动读取 `origin` 地址。

## 功能

- **初始化仓库并首次上传** — 把当前 vault 目录变成 git 仓库，内容直接落到仓库根目录
- **上传（提交 + 推送）**
- **下载（拉取远程）**
- **同步（提交 + 拉取 + 推送）** — 可设自动同步间隔
- **安装到 .obsidian** — 把源码目录的 main.js/manifest.json 复制到插件目录，一键重载
- **查看仓库状态** — 点状态栏
- **取消未完成的合并** — 冲突回滚

## 限定同步范围（双轨同步）

设置里的**同步范围**填多行目录，只提交这些路径的本地改动：

```
notes
.obsidian
```

这样笔记自动同步时不会提交 `plugins/` 的本地改动，插件源码可以手动推。拉取远程仍会更新整个仓库。留空则提交当前 vault 的全部文件。

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
- 同步前会写入本地 `.git/info/exclude` 排除规则；若配置文件已被 Git 跟踪，同步会停止并提示处理
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
| test-harness2.js | 12 | 远程非空 / 冲突 / 取消合并 / 令牌脱敏 |
| test-harness3.js | 15 | 限定目录同步、pathSpec 边界、范围不存在时停止提交 |
| test-harness4.js | 20 | 安装命令、文件筛选、manifest 校验、幂等 |
| test-harness5.js | 19 | 文件夹选择器、部分提交、过滤不存在目录 |
| test-harness6.js | 21 | 操作面板、首次上传、全部同步 |
| test-harness7.js | 12 | 一 vault 一仓库、克隆后同步与 origin 识别 |
| test-harness8.js | 23 | 本地排除规则与令牌文件保护 |

**136 个断言。**

```powershell
node test-harness.js  <临时目录>
node test-harness2.js <临时目录>
node test-harness3.js <临时目录>
node test-harness4.js <临时目录>
node test-harness5.js <临时目录>
node test-harness6.js <临时目录>
node test-harness7.js <临时目录>
node test-harness8.js <临时目录>
```

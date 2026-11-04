# GitObsidian

**Simple Git Sync**：私人 Obsidian vault 的桌面 Git 同步插件。一个 vault 对应一个 GitHub 仓库，仓库根目录就是 vault 根目录。纯 JavaScript、无第三方运行依赖。

## 日常操作

点状态栏 `Git · 就绪`，使用主按钮 **立即同步**：

1. 保存本地改动（提交当前配置的范围）。
2. 合并远程改动。
3. 上传当前分支。

定时同步使用完全相同的逻辑。面板显示进行到哪一步，处理期间阻止重复点击。遇到冲突暂停定时同步，保留现场供手动处理。

- **提交范围…**：可选的文件夹范围；默认整个 vault。选择文件夹与手填路径二选一，后一次配置生效。
- **检查更新**：从本项目的正式 GitHub Release 检查并安装新版。
- **高级操作**：仅上传、仅下载、临时同步整个 vault、取消合并、从本地源码安装。

范围只决定本次创建的提交。下载和推送仍按整个 Git 分支进行；已有提交中其他目录的改动也会被推送。

## 安装与新设备

从 [最新 Release](https://github.com/BertQLi/GitObsidian/releases/latest) 下载 `main.js` 和 `manifest.json`，复制到：

```
<vault>/.obsidian/plugins/simple-git-sync/
```

在 Obsidian 的第三方插件设置中启用 Simple Git Sync。也可使用 `install.ps1 -Vault <目录>` 安装本地源码。

第一台设备：填写空 GitHub 仓库地址、用户名和 PAT，点“初始化并首次同步”。后续设备先克隆笔记仓库，再作为 vault 打开，安装插件；插件自动读取 `origin` 地址。本地凭据单独配置。

本插件目录由自身的更新器管理，默认从笔记同步中排除。其他插件和可共享的 `.obsidian` 配置仍可随 vault 同步；设备布局和插件 `data.json` 排除。

## 自动更新

默认开启：启动 30 秒后检查，成功检查间隔至少 24 小时。只安装 `BertQLi/GitObsidian` 正式 Release，不从开发中的 `main` 分支取代码。

更新前校验 发布包的 SHA-256、文件大小、插件 ID、版本、最低 Obsidian 版本和 JavaScript 语法；全部验证完成后才替换文件。`data.json` 保留，上一版代码备份在插件目录的 `.update-backup/`。安装或重载失败时恢复上一版；不支持即时重载的宿主提示重启。

设置中可关闭自动更新。更新检查不发送笔记仓库 PAT。

## 开发与发布

源码在 `simple-git-sync/main.js`。发布时修改 `manifest.json` 版本、更新 `RELEASE_NOTES.md`，测试并提交推送后运行：

```bash
python3 scripts/release.py
```

发布脚本使用本机 Git 凭据管理器，将校验过的文件上传到草稿 Release，全部上传成功后发布。运行时不需要 Python。

## 测试

每套传入独立、已存在的临时目录：

```bash
node simple-git-sync/test-harness.js <临时目录>
# 其余为 test-harness2.js 到 test-harness9.js
```

| 套件 | 断言 | 覆盖 |
| --- | --- | --- |
| test-harness.js | 14 | 初始化、上传、下载、同步 |
| test-harness2.js | 13 | 冲突、暂停重试、认证错误脱敏 |
| test-harness3.js | 15 | 提交范围与失效路径保护 |
| test-harness4.js | 20 | 本地源码安装 |
| test-harness5.js | 19 | 文件夹选择和部分提交 |
| test-harness6.js | 23 | 主按钮、高级操作、重复点击 |
| test-harness7.js | 12 | 独立仓库、新设备克隆接入 |
| test-harness8.js | 23 | 本地排除与令牌保护 |
| test-harness9.js | 13 | 更新校验、回滚、重载和设置保留 |

共 152 个断言。Git 测试使用本地 bare 仓库；更新测试模拟 HTTP 响应并操作真实临时文件。

## 边界

- 仅桌面端，需要原生 Git。
- 父仓库包含多个 vault 的旧布局需迁移后使用。
- 冲突手动处理；大附件需另行管理，未集成 Git LFS。
- PAT 仍保存在本地设置并用于 Git HTTPS 认证，错误信息会脱敏；已被跟踪的私有配置会阻止同步。Git 历史中已有的令牌需撤销并轮换。

更多操作见 [使用说明](simple-git-sync/USAGE.md)。

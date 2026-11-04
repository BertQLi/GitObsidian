# Simple Git Sync

私人 Obsidian vault 的 Git 同步和插件自动更新工具。一个 vault 对应一个仓库，纯 JavaScript、仅桌面端。

日常点击状态栏中的“立即同步”，依次提交配置范围、合并远程、上传当前分支。定时同步使用同一逻辑；单独上传、下载等功能收在高级操作中。

自动更新默认开启，每天从本项目正式 GitHub Release 检查新版，校验文件后安装和重载，失败恢复上一版并保留用户设置。

安装、开发和测试说明见 [项目 README](../README.md)，详细使用方法见 [USAGE.md](USAGE.md)。

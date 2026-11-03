# 把插件安装到指定 vault
param(
  [string]$Vault = "D:\Personal\博士\并行训练\note\并行训练"
)
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dst = Join-Path $Vault ".obsidian\plugins\simple-git-sync"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item (Join-Path $src "manifest.json") $dst -Force
Copy-Item (Join-Path $src "main.js") $dst -Force
Write-Host "已安装到: $dst"
Write-Host "请重启 Obsidian 并在 设置 → 第三方插件 中启用 Simple Git Sync"

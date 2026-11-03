# 一键把插件开发环境推送到 GitHub
#
# 用法：
#   1. 先在 GitHub 网页建一个空的私有仓库（不要勾 README）
#   2. 在 PowerShell 里运行：
#        .\push-to-github.ps1 -Repo "https://github.com/你的用户名/simple-git-sync.git"
#
# 认证：使用 Git Credential Manager，第一次会弹窗登录一次，之后免密。

param(
  [Parameter(Mandatory = $true)]
  [string]$Repo,

  [string]$Branch = "main",

  [string]$UserName = "BertQ",

  [string]$UserEmail = "BertQ@users.noreply.github.com"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "=== 检查 ===" -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $root ".git"))) {
  Write-Host "错误：当前目录不是 git 仓库" -ForegroundColor Red
  exit 1
}
if ($Repo -notmatch '^https://') {
  Write-Host "错误：仓库地址必须是 https:// 开头（SSH 在 Windows 上坑多）" -ForegroundColor Red
  exit 1
}
Write-Host "  目录: $root"
Write-Host "  远程: $Repo"
Write-Host "  分支: $Branch"

Write-Host ""
Write-Host "=== 1. 配置 git 身份 ===" -ForegroundColor Cyan
git config user.name $UserName
git config user.email $UserEmail
git config core.autocrlf false
Write-Host "  ok"

Write-Host ""
Write-Host "=== 2. 关联远程 ===" -ForegroundColor Cyan
$existing = git remote 2>$null
if ($existing -contains "origin") {
  git remote set-url origin $Repo
  Write-Host "  已更新 origin"
} else {
  git remote add origin $Repo
  Write-Host "  已添加 origin"
}

Write-Host ""
Write-Host "=== 3. 提交未提交的改动 ===" -ForegroundColor Cyan
git add -A
$status = git status --porcelain
if ($status) {
  git commit -m "update: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-Null
  Write-Host "  已提交"
} else {
  Write-Host "  无改动"
}

Write-Host ""
Write-Host "=== 4. 推送到 GitHub ===" -ForegroundColor Cyan
Write-Host "  （第一次会弹出 GitHub 登录窗口）"
git push -u origin $Branch
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "推送失败。常见原因：" -ForegroundColor Yellow
  Write-Host "  - 远程仓库非空（建仓库时勾了 README）→ 先 git pull --allow-unrelated-histories"
  Write-Host "  - 仓库地址写错或没有权限"
  Write-Host "  - 凭据过期 → git config --global credential.helper manager 后重试"
  exit 1
}

Write-Host ""
Write-Host "=== 完成 ===" -ForegroundColor Green
git log --oneline -1
Write-Host ""
Write-Host "以后更新只需：" -ForegroundColor Cyan
Write-Host "  git add -A; git commit -m 'xxx'; git push"

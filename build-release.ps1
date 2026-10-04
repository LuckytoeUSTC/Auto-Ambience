param([string]$Version = '1.1.0')
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw '请输入有效版本号，例如 1.0.0' }
$releaseDir = Join-Path $PSScriptRoot 'releases'
[IO.Directory]::CreateDirectory($releaseDir) | Out-Null
$output = Join-Path $releaseDir "Auto-Ambience-v$Version.zip"
# 仅打包 Git 已跟踪的文件，避免把运行日志与未跟踪的个人文件加入发布版。
& git -C $PSScriptRoot archive --format=zip --prefix=Auto-Ambience/ --output=$output HEAD
if ($LASTEXITCODE -ne 0) { throw '打包失败。请先在 Git 仓库中提交要发布的文件。' }
Get-Item -LiteralPath $output | Select-Object FullName, Length
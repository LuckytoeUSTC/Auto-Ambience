<#
  AutoAmbience 省电核心
  -Action status   只读自检，不改任何东西
  -Action save     进入省电：截图当前壁纸 -> 设为系统静态壁纸 -> 关闭 Lively
  -Action restore  恢复动态：启动 Lively -> 还原原系统壁纸
  -Action auto     后台监听：按电源状态自动切换
  可选参数：-Threshold 20 -Interval 30 -Force
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('status', 'save', 'restore', 'auto', 'check', 'wallpaper')]
  [string]$Action,
  [int]$Threshold = 20,
  [int]$Interval = 30,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ThresholdExplicit = $PSBoundParameters.ContainsKey('Threshold')

$SaverDir  = $PSScriptRoot
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $SaverDir '..\..'))
$ManualConfigPath = Join-Path $ProjectRoot '手动配置.json'
$StatePath = Join-Path $SaverDir '省电状态.json'
$Snapshot  = Join-Path $SaverDir '省电快照.jpg'
$Original  = Join-Path $SaverDir '原系统壁纸.jpg'
$LogPath   = Join-Path $SaverDir '省电日志.txt'
$MutexName = 'AutoAmbiencePowerSaver'

$LivelyCandidates = @(
  'C:\Program Files\Lively Wallpaper\Lively.exe',
  (Join-Path $env:LOCALAPPDATA 'Programs\Lively Wallpaper\Lively.exe')
)

$WallpaperShuffle    = $true
$WallpaperIntervalMs = 86400000
$SlideshowApiFile    = Join-Path $SaverDir 'DesktopWallpaperApi.cs'

$StartupShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'AutoAmbience省电监听.lnk'

function Read-ManualConfig {
  if (-not (Test-Path -LiteralPath $ManualConfigPath -PathType Leaf)) { throw "找不到手动配置：$ManualConfigPath" }
  return Get-Content -Raw -LiteralPath $ManualConfigPath -Encoding UTF8 | ConvertFrom-Json
}

function Get-EffectiveThreshold {
  $value = $Threshold
  if (-not $ThresholdExplicit) {
    $config = Read-ManualConfig
    if ($null -eq $config.'省电临界') { throw '手动配置.json 缺少“省电临界”' }
    $value = [int]$config.'省电临界'
  }
  if ($value -lt 1 -or $value -gt 100) { throw '省电临界必须是 1 到 100 的整数' }
  return $value
}

function Get-BackgroundWallpaperSource {
  $value = (Read-ManualConfig).'背景壁纸来源'
  if ($value -isnot [string] -or -not $value.Trim()) { throw '手动配置.json 中的“背景壁纸来源”必须是图片文件或文件夹路径' }
  $path = $value
  if (-not [IO.Path]::IsPathRooted($path)) { $path = Join-Path $ProjectRoot $path }
  if (-not (Test-Path -LiteralPath $path)) { throw "找不到背景壁纸来源：$value" }
  $item = Get-Item -LiteralPath $path
  if ($item.PSIsContainer) { return [pscustomobject]@{ Type = 'folder'; Path = $item.FullName } }
  if ($item.Extension -notmatch '^\.(png|jpe?g|webp|gif)$') { throw "背景壁纸来源文件不是支持的图片：$value" }
  return [pscustomobject]@{ Type = 'file'; Path = $item.FullName }
}

function Write-Log([string]$Message) {
  $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  try { Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8 } catch { }
  Write-Host $line
}

function Get-LivelyPath {
  foreach ($p in $LivelyCandidates) { if ($p -and (Test-Path -LiteralPath $p)) { return $p } }
  return $null
}

function Test-LivelyRunning {
  return [bool](Get-Process -Name 'Lively' -ErrorAction SilentlyContinue)
}

function Get-PowerState {
  Add-Type -AssemblyName System.Windows.Forms
  $s = [System.Windows.Forms.SystemInformation]::PowerStatus
  $noBattery = (($s.BatteryChargeStatus -band [System.Windows.Forms.BatteryChargeStatus]::NoSystemBattery) -ne 0)
  return [pscustomobject]@{
    HasBattery = (-not $noBattery)
    Percent    = [int][math]::Round($s.BatteryLifePercent * 100)
    OnAc       = ($s.PowerLineStatus -eq [System.Windows.Forms.PowerLineStatus]::Online)
    AcText     = $s.PowerLineStatus.ToString()
    ChargeText = $s.BatteryChargeStatus.ToString()
  }
}

function Initialize-WallpaperApi {
  if (-not ('AA.Wallpaper' -as [type])) {
    Add-Type -Namespace AA -Name Wallpaper -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Auto, EntryPoint = "SystemParametersInfo", SetLastError = true)]
public static extern int GetWallpaper(int uAction, int uParam, System.Text.StringBuilder lpvParam, int fuWinIni);
[DllImport("user32.dll", CharSet = CharSet.Auto, EntryPoint = "SystemParametersInfo", SetLastError = true)]
public static extern int SetWallpaper(int uAction, int uParam, string lpvParam, int fuWinIni);
'@
  }
}

function Get-CurrentWallpaper {
  Initialize-WallpaperApi
  $sb = New-Object System.Text.StringBuilder 1024
  [void][AA.Wallpaper]::GetWallpaper(0x0073, $sb.Capacity, $sb, 0)
  return $sb.ToString()
}

function Set-DesktopWallpaper([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "壁纸文件不存在: $Path" }
  Initialize-WallpaperApi
  $full = (Resolve-Path -LiteralPath $Path).Path
  $ok = [AA.Wallpaper]::SetWallpaper(0x0014, 0, $full, 3)
  if ($ok -eq 0) { throw "SystemParametersInfo 设置壁纸失败" }
}

function New-StateObject {
  return [ordered]@{ mode = 'dynamic'; manual = $false; manualAc = $false; snapshot = ''; original = ''; wallpapers = @(); updated = '' }
}

function Read-State {
  $st = New-StateObject
  if (Test-Path -LiteralPath $StatePath) {
    try {
      $j = Get-Content -Raw -LiteralPath $StatePath -Encoding UTF8 | ConvertFrom-Json
      foreach ($k in @('mode', 'manual', 'manualAc', 'snapshot', 'original', 'updated')) {
        if ($null -ne $j.$k) { $st[$k] = $j.$k }
      }
      if ($null -ne $j.wallpapers) { $st['wallpapers'] = @($j.wallpapers) } else { $st['wallpapers'] = @() }
    } catch { Write-Log ("读取状态失败: " + $_.Exception.Message) }
  }
  return $st
}

function Save-State($st) {
  $st['updated'] = (Get-Date -Format o)
  ($st | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $StatePath -Encoding UTF8
}

function Get-LivelyLayout {
  $p = Join-Path $env:LOCALAPPDATA 'Lively Wallpaper\WallpaperLayout.json'
  if (-not (Test-Path -LiteralPath $p)) { return @() }
  try {
    $j = Get-Content -Raw -LiteralPath $p -Encoding UTF8 | ConvertFrom-Json
    if ($null -eq $j) { return @() }
    return @($j)
  } catch {
    Write-Log ("读取 Lively 布局失败: " + $_.Exception.Message)
    return @()
  }
}

function Set-SlideshowWallpaper {
  param(
    [Parameter(Mandatory = $true)][string]$Folder,
    [bool]$Shuffle = $WallpaperShuffle,
    [int]$IntervalMs = $WallpaperIntervalMs
  )
  if (-not (Test-Path -LiteralPath $Folder)) { throw "幻灯片文件夹不存在: $Folder" }
  if (-not ('AA.DesktopWallpaper' -as [type])) { Add-Type -Path $SlideshowApiFile -ErrorAction Stop }
  return [AA.DesktopWallpaper]::SetSlideshow($Folder, $Shuffle, $IntervalMs)
}

function Set-ConfiguredSystemWallpaper {
  $source = Get-BackgroundWallpaperSource
  if ($source.Type -eq 'file') {
    Set-DesktopWallpaper $source.Path
    return "单张图片：$($source.Path)"
  }
  $info = Set-SlideshowWallpaper -Folder $source.Path
  return "文件夹幻灯片：$($source.Path)（$info）"
}

function Take-WallpaperShot([string]$Path) {
  $exe = Get-LivelyPath
  if (-not $exe) { throw '找不到 Lively.exe' }
  if (-not (Test-LivelyRunning)) { throw 'Lively 未运行，无法截图' }
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue }
    & $exe screenshot --file $Path | Out-Null
    $deadline = (Get-Date).AddSeconds(8)
    $lastLen = -1
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 400
      if (Test-Path -LiteralPath $Path) {
        $len = (Get-Item -LiteralPath $Path).Length
        if ($len -gt 0 -and $len -eq $lastLen) { return $true }
        $lastLen = $len
      }
    }
    Write-Log ("第 {0} 次截图未成功，准备重试" -f $attempt)
    Start-Sleep -Seconds 2
  }
  return (Test-Path -LiteralPath $Path)
}

function Stop-Lively {
  $exe = Get-LivelyPath
  if (-not $exe -or -not (Test-LivelyRunning)) { return }
  & $exe --shutdown true | Out-Null
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline -and (Test-LivelyRunning)) { Start-Sleep -Milliseconds 300 }
}

function Start-Lively {
  $exe = Get-LivelyPath
  if (-not $exe) { throw '找不到 Lively.exe' }
  if (Test-LivelyRunning) { return }
  Start-Process -FilePath $exe | Out-Null
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline -and -not (Test-LivelyRunning)) { Start-Sleep -Milliseconds 400 }
  # 等壁纸渲染就绪，避免紧接着截图时拿到空
  Start-Sleep -Seconds 6
}

function Enter-SaveMode([bool]$Manual) {
  $power = Get-PowerState
  $st = Read-State

  if (-not $st['original']) {
    try {
      $cur = Get-CurrentWallpaper
      if ($cur -and (Test-Path -LiteralPath $cur)) {
        Copy-Item -LiteralPath $cur -Destination $Original -Force
        $st['original'] = $Original
      }
    } catch { Write-Log ("备份原壁纸失败: " + $_.Exception.Message) }
  }

  $shot = $false
  try { $shot = Take-WallpaperShot $Snapshot } catch { Write-Log ("截图失败: " + $_.Exception.Message) }

  if ($shot) {
    $st['snapshot'] = $Snapshot
    try { Set-DesktopWallpaper $Snapshot; Write-Log '已把静态快照设为系统壁纸' }
    catch { Write-Log ("设置静态壁纸失败: " + $_.Exception.Message) }
  } else {
    $st['snapshot'] = ''
    Write-Log '没有拿到截图，保留原系统壁纸'
  }

  $items = @()
  foreach ($e in (Get-LivelyLayout)) {
    if ($e.LivelyInfoPath) {
      $idx = 1
      if ($e.LivelyScreen -and $e.LivelyScreen.Index) { $idx = [int]$e.LivelyScreen.Index }
      $items += [ordered]@{ path = $e.LivelyInfoPath; monitor = $idx }
    }
  }
  if ($items.Count -gt 0) {
    $st['wallpapers'] = @($items)
    Write-Log ("已记住 {0} 个当前壁纸，供恢复时重新应用" -f $items.Count)
  }

  Stop-Lively
  Write-Log '已关闭 Lively'

  $st['mode'] = 'save'
  if ($Manual) { $st['manual'] = $true; $st['manualAc'] = [bool]$power.OnAc }
  Save-State $st

  $src = '电池供电'
  if ($power.OnAc) { $src = '接电源' }
  Write-Log ("进入省电模式（电量 {0}%，{1}）" -f $power.Percent, $src)
}

function Exit-SaveMode {
  $st = Read-State
  Start-Lively
  Write-Log '已启动 Lively'

  $wps = @($st['wallpapers'])
  if ($wps.Count -gt 0) {
    $exe = Get-LivelyPath
    $applied = 0
    foreach ($w in $wps) {
      if ($exe -and $w.path -and (Test-Path -LiteralPath $w.path) -and (Test-LivelyRunning)) {
        try {
          & $exe setwp --file $w.path --monitor $w.monitor | Out-Null
          $applied++
          Write-Log ("已重新应用壁纸: " + $w.path)
        } catch { Write-Log ("重新应用壁纸失败: " + $_.Exception.Message) }
      }
    }
    if ($applied -gt 0) { Start-Sleep -Seconds 5 }
  } else {
    Write-Log '没有记住的壁纸，跳过重新应用'
  }

  # 恢复时按手动配置设置系统壁纸；单张图片固定显示，文件夹使用随机幻灯片
  $wallpaperOk = $false
  try {
    $info = Set-ConfiguredSystemWallpaper
    Write-Log ("已按手动配置设置系统壁纸：" + $info)
    $wallpaperOk = $true
  } catch { Write-Log ("设置背景壁纸失败: " + $_.Exception.Message) }
  if (-not $wallpaperOk -and $st['original'] -and (Test-Path -LiteralPath $st['original'])) {
    try { Set-DesktopWallpaper $st['original']; Write-Log '已回退为原系统壁纸' }
    catch { Write-Log ("还原原壁纸失败: " + $_.Exception.Message) }
  }

  $st['mode'] = 'dynamic'
  $st['manual'] = $false
  Save-State $st
  Write-Log '恢复动态模式'
}

function Test-MonitorRunning {
  try { $m = [System.Threading.Mutex]::OpenExisting($MutexName); $m.Dispose(); return $true }
  catch { return $false }
}

function Show-Status {
  $p = Get-PowerState
  $st = Read-State
  $exe = Get-LivelyPath
  $effectiveThreshold = Get-EffectiveThreshold
  $wallpaperSource = Get-BackgroundWallpaperSource
  $batteryText = '无（台式机）'
  if ($p.HasBattery) { $batteryText = '有' }
  $lines = @(
    '--- AutoAmbience 省电自检 ---',
    ('电池        : ' + $batteryText),
    ('电量        : ' + $p.Percent + '%'),
    ('电源        : ' + $p.AcText + '   充电状态: ' + $p.ChargeText),
    ('触发阈值    : 低于 ' + $effectiveThreshold + '%'),
    ('背景壁纸    : ' + $wallpaperSource.Type + '   ' + $wallpaperSource.Path),
    ('当前模式    : ' + $st['mode']),
    ('手动锁定    : ' + [bool]$st['manual']),
    ('Lively 路径 : ' + $exe),
    ('Lively 运行 : ' + (Test-LivelyRunning)),
    ('监听运行    : ' + (Test-MonitorRunning)),
    ('开机启动项  : ' + (Test-Path -LiteralPath $StartupShortcut)),
    ('快照文件    : ' + $st['snapshot']),
    ('原壁纸备份  : ' + $st['original'])
  )
  foreach ($l in $lines) { Write-Output $l }
}

function Invoke-Auto {
  $mutex = New-Object System.Threading.Mutex($false, $MutexName)
  $owned = $false
  try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
  if (-not $owned) { Write-Log '已有省电监听在运行，本次退出'; $mutex.Dispose(); return }
  try {
    Write-Log ("省电监听启动（当前阈值 {0}%，间隔 {1} 秒）" -f (Get-EffectiveThreshold), $Interval)
    while ($true) {
      try { Invoke-CheckOnce (Get-EffectiveThreshold) } catch { Write-Log ("轮询出错: " + $_.Exception.Message) }
      Start-Sleep -Seconds $Interval
    }
  } finally {
    if ($owned) { try { $mutex.ReleaseMutex() } catch { } }
    $mutex.Dispose()
  }
}

function Invoke-CheckOnce([int]$Limit) {
  $st = Read-State
  $p = Get-PowerState
  if ([bool]$st['manual'] -and ($p.OnAc -ne [bool]$st['manualAc'])) {
    $st['manual'] = $false
    Save-State $st
    Write-Log '电源状态已变化，解除手动锁定'
  }
  if (-not [bool]$st['manual']) {
    if ($p.HasBattery) {
      if ($p.OnAc) {
        if ($st['mode'] -eq 'save') { Exit-SaveMode }
      } elseif ($p.Percent -lt $Limit) {
        if ($st['mode'] -ne 'save') { Enter-SaveMode $false }
      }
    }
  }
}

switch ($Action) {
  'status'  { Show-Status }
  'save'    { Enter-SaveMode ([bool]$Force) }
  'restore' { Exit-SaveMode }
  'auto'    { Invoke-Auto }
  'check'   { Invoke-CheckOnce (Get-EffectiveThreshold) }
  'wallpaper' { Write-Output ("已设置背景壁纸: " + (Set-ConfiguredSystemWallpaper)) }
}

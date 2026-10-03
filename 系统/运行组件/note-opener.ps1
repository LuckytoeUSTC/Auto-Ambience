param([Parameter(Mandatory=$true)][string]$TargetPath)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $TargetPath -PathType Leaf)) { throw "文件不存在：$TargetPath" }
$source = @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DefaultEditorWindow {
  public delegate bool WindowCallback(IntPtr handle, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumWindows(WindowCallback callback, IntPtr data);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr handle, StringBuilder text, int maxLength);
}
"@
Add-Type $source
Add-Type -Path (Join-Path $PSScriptRoot 'WindowFocus.cs')
Start-Process -FilePath $TargetPath -WindowStyle Normal -ErrorAction Stop
$filename = [IO.Path]::GetFileName($TargetPath)
$targetWindow = [IntPtr]::Zero
for ($attempt = 0; $attempt -lt 15; $attempt++) {
  $script:targetWindow = [IntPtr]::Zero
  $callback = [DefaultEditorWindow+WindowCallback]{
    param($handle, $data)
    $buffer = New-Object System.Text.StringBuilder 512
    [void][DefaultEditorWindow]::GetWindowText($handle, $buffer, 512)
    if ($buffer.ToString().IndexOf($filename, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
      $script:targetWindow = $handle
      return $false
    }
    return $true
  }
  [void][DefaultEditorWindow]::EnumWindows($callback, [IntPtr]::Zero)
  if ($script:targetWindow -ne [IntPtr]::Zero) {
    $targetWindow = $script:targetWindow
    break
  }
  Start-Sleep -Milliseconds 150
}

if ($targetWindow -eq [IntPtr]::Zero) { throw "找不到编辑器窗口：$filename" }
[AutoAmbienceWindowFocus]::Activate($targetWindow, [IntPtr]::Zero)

Start-Sleep -Milliseconds 180
$shell = New-Object -ComObject WScript.Shell
if (-not $shell.AppActivate($filename)) { throw "无法激活编辑器窗口：$filename" }
Start-Sleep -Milliseconds 100
$shell.SendKeys('^{END}')

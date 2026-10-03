param([Parameter(Mandatory=$true)][string]$TargetPath)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $TargetPath -PathType Leaf)) {
  throw "文件不存在：$TargetPath"
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CurrentEditorFocus {
  public sealed class InputState {
    public string Layout;
    public bool HasIme;
    public bool ImeOpen;
    public int ConversionMode;
    public int SentenceMode;
  }
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, IntPtr processId);
  [DllImport("user32.dll")] public static extern IntPtr GetKeyboardLayout(uint threadId);
  [DllImport("imm32.dll")] public static extern IntPtr ImmGetContext(IntPtr handle);
  [DllImport("imm32.dll")] public static extern bool ImmReleaseContext(IntPtr handle, IntPtr context);
  [DllImport("imm32.dll")] public static extern bool ImmGetOpenStatus(IntPtr context);
  [DllImport("imm32.dll")] public static extern bool ImmSetOpenStatus(IntPtr context, bool open);
  [DllImport("imm32.dll")] public static extern bool ImmGetConversionStatus(IntPtr context, out int conversion, out int sentence);
  [DllImport("imm32.dll")] public static extern bool ImmSetConversionStatus(IntPtr context, int conversion, int sentence);

  public static string GetLayoutId(IntPtr editor) {
    uint thread = GetWindowThreadProcessId(editor, IntPtr.Zero);
    long value = GetKeyboardLayout(thread).ToInt64();
    return unchecked((ulong)value).ToString("X");
  }

  public static InputState CaptureInput(IntPtr editor) {
    InputState state = new InputState();
    state.Layout = GetLayoutId(editor);
    IntPtr context = ImmGetContext(editor);
    if (context != IntPtr.Zero) {
      state.HasIme = true;
      state.ImeOpen = ImmGetOpenStatus(context);
      ImmGetConversionStatus(context, out state.ConversionMode, out state.SentenceMode);
      ImmReleaseContext(editor, context);
    }
    return state;
  }

  public static void ApplyIme(IntPtr editor, bool open, int conversion, int sentence) {
    IntPtr context = ImmGetContext(editor);
    if (context == IntPtr.Zero) return;
    ImmSetOpenStatus(context, open);
    ImmSetConversionStatus(context, conversion, sentence);
    ImmReleaseContext(editor, context);
  }
}
"@
[System.Windows.Forms.Application]::EnableVisualStyles()
Add-Type -Path (Join-Path $PSScriptRoot 'WindowFocus.cs')

$statePath = Join-Path $PSScriptRoot '当前输入法模式.json'
$savedState = $null
if (Test-Path -LiteralPath $statePath -PathType Leaf) {
  try { $savedState = Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json } catch { $savedState = $null }
}

$cyan = [System.Drawing.ColorTranslator]::FromHtml('#00eaff')
$black = [System.Drawing.Color]::Black
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.ClientSize = New-Object System.Drawing.Size(660, 150)
$form.BackColor = $cyan
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.KeyPreview = $true

$editor = New-Object System.Windows.Forms.TextBox
$editor.Location = New-Object System.Drawing.Point(18, 18)
$editor.Size = New-Object System.Drawing.Size(624, 114)
$editor.Multiline = $true
$editor.AcceptsReturn = $true
$editor.AcceptsTab = $false
$editor.ScrollBars = [System.Windows.Forms.ScrollBars]::None
$editor.BorderStyle = [System.Windows.Forms.BorderStyle]::None
$editor.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 18)
$editor.ForeColor = $black
$editor.BackColor = $cyan
$editor.Text = [System.IO.File]::ReadAllText($TargetPath, [System.Text.Encoding]::UTF8)

$script:saveRequested = $false
$saveAndClose = {
  $script:saveRequested = $true
  $form.Close()
}
$cancelAndClose = {
  $script:saveRequested = $false
  $form.Close()
}

$editor.Add_KeyDown({
  param($sender, $event)
  if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
    $event.SuppressKeyPress = $true
    & $cancelAndClose
  } elseif ($event.KeyCode -eq [System.Windows.Forms.Keys]::Enter -and -not $event.Shift) {
    $event.SuppressKeyPress = $true
    & $saveAndClose
  }
})
$form.Add_KeyDown({
  param($sender, $event)
  if ($event.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
    $event.SuppressKeyPress = $true
    & $cancelAndClose
  }
})

$focusTimer = New-Object System.Windows.Forms.Timer
$focusTimer.Interval = 120
$focusTimer.Add_Tick({
  $focusTimer.Stop()
  $form.ActiveControl = $editor
  [AutoAmbienceWindowFocus]::Activate($form.Handle, $editor.Handle)
  [void]$editor.Focus()
  $layout = [CurrentEditorFocus]::GetLayoutId($editor.Handle)
  if ($savedState -and $savedState.Layout -eq $layout -and $savedState.HasIme) {
    [CurrentEditorFocus]::ApplyIme($editor.Handle, $savedState.ImeOpen, $savedState.ConversionMode, $savedState.SentenceMode)
  }
  $editor.SelectAll()
})
$form.Add_Shown({ $focusTimer.Start() })
$form.Add_FormClosing({
  $state = [CurrentEditorFocus]::CaptureInput($editor.Handle)
  $json = $state | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($statePath, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
})
$form.Controls.Add($editor)
[void]$form.ShowDialog()

if ($script:saveRequested) {
  $text = $editor.Text.TrimEnd("`r", "`n")
  if ($text.Length -gt 0) { $text += [Environment]::NewLine }
  [System.IO.File]::WriteAllText($TargetPath, $text, (New-Object System.Text.UTF8Encoding($false)))
}

$focusTimer.Dispose()
$form.Dispose()

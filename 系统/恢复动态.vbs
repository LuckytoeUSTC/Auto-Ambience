Option Explicit
Dim shell, fso, script, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
script = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "运行组件\power-saver.ps1")
If Not fso.FileExists(script) Then
  MsgBox "找不到省电脚本：" & script, 16, "AutoAmbience 省电"
  WScript.Quit 1
End If
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """ -Action restore"
shell.Run command, 0, True

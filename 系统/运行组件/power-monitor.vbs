Option Explicit
Dim shell, fso, script, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
script = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "power-saver.ps1")
If Not fso.FileExists(script) Then WScript.Quit 1
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """ -Action auto"
shell.Run command, 0, False

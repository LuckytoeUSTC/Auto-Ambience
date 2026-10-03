Option Explicit
Dim shell, fso, req, nodePath, scriptPath, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
nodePath = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(nodePath) Then nodePath = shell.ExpandEnvironmentStrings("%LocalAppData%\Programs\nodejs\node.exe")
scriptPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "运行组件\desktop-server.js")
On Error Resume Next
Set req = CreateObject("WinHttp.WinHttpRequest.5.1")
req.SetTimeouts 500, 500, 500, 500
req.Open "GET", "http://127.0.0.1:18765/_health", False
req.Send
If Err.Number = 0 Then
  If req.Status = 200 And req.GetResponseHeader("X-AutoAmbience") = "1" Then WScript.Quit 0
  MsgBox "端口 18765 已被其他程序占用。请关闭占用程序后重试。", 48, "AutoAmbience"
  WScript.Quit 2
End If
Err.Clear
On Error GoTo 0
If Not fso.FileExists(nodePath) Then
  MsgBox "未找到 Node.js。请先安装 Node.js LTS。", 48, "AutoAmbience"
  WScript.Quit 1
End If
If Not fso.FileExists(scriptPath) Then
  MsgBox "找不到桌面服务：" & scriptPath, 16, "AutoAmbience"
  WScript.Quit 1
End If
command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & scriptPath & Chr(34)
shell.Run command, 0, False

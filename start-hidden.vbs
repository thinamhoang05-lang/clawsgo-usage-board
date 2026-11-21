' Start the board without a console window.
Option Explicit
Dim sh, fso, here, exe
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
exe = here & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(exe) Then
  MsgBox "Electron runtime not found. Run npm install first.", 48, "ClawsGO Usage Board"
  WScript.Quit 1
End If
sh.Environment("PROCESS").Remove "ELECTRON_RUN_AS_NODE"
sh.CurrentDirectory = here
sh.Run """" & exe & """ .", 0, False

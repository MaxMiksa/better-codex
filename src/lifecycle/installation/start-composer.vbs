Set shell = CreateObject("WScript.Shell")
result = shell.Run("""@POWERSHELL@"" -NoProfile -ExecutionPolicy Bypass -File ""@SCRIPT@""", 0, True)
If result <> 0 Then
    shell.Run "explorer.exe shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App", 0, False
End If

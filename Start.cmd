@echo off
if exist "%~dp0BetterCodex.exe" (
  start "" "%~dp0BetterCodex.exe"
  exit /b 0
)
if not exist "%~dp0.runtime\launchers\start-better-codex.vbs" (
  if exist "%~dp0.runtime\token-hud\embedded\settings.json" goto legacy
  if exist "%~dp0.runtime\settings.json" goto legacy
  "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0src\platform\i18n\i18n.ps1" -MessageKey install.first -Wait
  exit /b 1
)
wscript.exe "%~dp0.runtime\launchers\start-better-codex.vbs"
exit /b %errorlevel%
:legacy
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0src\app\Start-ComposerHud.ps1"
exit /b %errorlevel%

@echo off
if exist "%~dp0BetterCodex.exe" (
  start "" "%~dp0BetterCodex.exe"
  exit /b 0
)
if not exist "%~dp0.runtime\token-hud\embedded\start-composer.vbs" (
  "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\token-hud-local\shared\i18n.ps1" -MessageKey install.first -Wait
  exit /b 1
)
wscript.exe "%~dp0.runtime\token-hud\embedded\start-composer.vbs"

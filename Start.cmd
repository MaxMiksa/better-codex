@echo off
if exist "%~dp0BetterCodex.exe" (
  start "" "%~dp0BetterCodex.exe"
  exit /b 0
)
if not exist "%~dp0.runtime\token-hud\embedded\start-composer.vbs" (
  echo Run Install.ps1 first.
  pause
  exit /b 1
)
wscript.exe "%~dp0.runtime\token-hud\embedded\start-composer.vbs"

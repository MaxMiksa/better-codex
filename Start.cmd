@echo off
if not exist "%~dp0.runtime\token-hud\embedded\start-composer.vbs" (
  echo Run Install.ps1 first.
  pause
  exit /b 1
)
wscript.exe "%~dp0.runtime\token-hud\embedded\start-composer.vbs"

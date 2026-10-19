@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\token-hud-local\Repair-WorkspacePaths.ps1" -Wait
exit /b %errorlevel%

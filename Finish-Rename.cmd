@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0src\lifecycle\installation\Repair-WorkspacePaths.ps1" -Wait
exit /b %errorlevel%

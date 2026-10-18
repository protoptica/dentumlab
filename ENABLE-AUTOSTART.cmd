@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\autostart-worker-windows.ps1" 
if errorlevel 1 echo Operation failed. See the message above.
pause

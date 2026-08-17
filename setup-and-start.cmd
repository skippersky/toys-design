@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-and-start.ps1" %*
if errorlevel 1 (
  echo.
  echo Setup failed. Review the message above, then press any key to close.
  pause >nul
)
endlocal

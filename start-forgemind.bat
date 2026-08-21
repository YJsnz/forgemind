@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-forgemind.ps1" %*
if errorlevel 1 (
  echo.
  echo ForgeMind 启动失败，请检查上面的错误信息。
  pause
)

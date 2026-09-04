@echo off
setlocal
set "FORGEMIND_PS=pwsh.exe"
where pwsh.exe >nul 2>nul
if errorlevel 1 set "FORGEMIND_PS=powershell.exe"

%FORGEMIND_PS% -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-forgemind.ps1" -IncludeSpring -IncludeAI -IncludeVoiceChat %*
set "FORGEMIND_EXIT=%ERRORLEVEL%"
if not "%FORGEMIND_EXIT%"=="0" (
  echo.
  echo ForgeMind startup failed. See the error above and .forgemind\logs.
  pause
)
exit /b %FORGEMIND_EXIT%

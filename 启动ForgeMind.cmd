@echo off
setlocal
set "FORGEMIND_PS=pwsh.exe"
where pwsh.exe >nul 2>nul
if errorlevel 1 set "FORGEMIND_PS=powershell.exe"

%FORGEMIND_PS% -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-forgemind.ps1" -IncludeSpring -IncludeAI -IncludeVoiceChat %*
set "FORGEMIND_EXIT=%ERRORLEVEL%"
echo.
if "%FORGEMIND_EXIT%"=="0" (
  echo ForgeMind is ready. This is the only visible startup terminal.
) else (
  echo ForgeMind startup failed before reaching 100%%.
)
pause
exit /b %FORGEMIND_EXIT%

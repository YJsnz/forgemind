@echo off
setlocal

cd /d "%~dp0"
title ForgeMind Local Development Server

if not exist "package.json" (
  echo [ERROR] package.json was not found.
  echo Keep this file in the ForgeMind project root folder.
  pause
  exit /b 1
)

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Windows PowerShell was not found.
  pause
  exit /b 1
)

echo [START] ForgeMind startup checks are running...
set "PS_ARGS="
:parse_args
if "%~1"=="" goto run_script
if /i "%~1"=="--check" set "PS_ARGS=%PS_ARGS% -Check"
if /i "%~1"=="--no-browser" set "PS_ARGS=%PS_ARGS% -NoBrowser"
if /i "%~1"=="--skip-install" set "PS_ARGS=%PS_ARGS% -SkipInstall"
if /i "%~1"=="--cad" set "PS_ARGS=%PS_ARGS% -Entry cad"
if /i "%~1"=="--port" (
  if "%~2"=="" (
    echo [ERROR] --port requires a number.
    pause
    exit /b 1
  )
  set "PS_ARGS=%PS_ARGS% -Port %~2"
  shift
)
shift
goto parse_args

:run_script
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0START_FORGEMIND_DEV.ps1" %PS_ARGS%
set "START_RESULT=%ERRORLEVEL%"

if not "%START_RESULT%"=="0" (
  echo.
  echo [ERROR] ForgeMind could not start. See the message above.
  pause
)

exit /b %START_RESULT%

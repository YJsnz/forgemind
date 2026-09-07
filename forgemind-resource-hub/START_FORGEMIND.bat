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
if /i "%~1"=="--check" set "PS_ARGS=-Check"
if /i "%~1"=="--no-browser" set "PS_ARGS=-NoBrowser"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0START_FORGEMIND_DEV.ps1" %PS_ARGS%
set "START_RESULT=%ERRORLEVEL%"

if not "%START_RESULT%"=="0" (
  echo.
  echo [ERROR] ForgeMind could not start. See the message above.
  pause
)

exit /b %START_RESULT%

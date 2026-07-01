@echo off
REM Windows wrapper for gerrit-api.mjs
setlocal
set "SCRIPT_DIR=%~dp0"
set "TARGET=%SCRIPT_DIR%..\scripts\gerrit-api.mjs"
if not exist "%TARGET%" (
  echo error: 未找到实际脚本 "%TARGET%" 1>&2
  exit /b 1
)
node "%TARGET%" %*

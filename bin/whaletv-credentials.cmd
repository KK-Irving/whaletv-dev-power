@echo off
REM Windows wrapper for whaletv-credentials.mjs
REM PATH 通过 scripts/deploy.mjs 管理，指向 <repo>\bin\
setlocal
set "SCRIPT_DIR=%~dp0"
set "TARGET=%SCRIPT_DIR%..\scripts\whaletv-credentials.mjs"
if not exist "%TARGET%" (
  echo error: 未找到实际脚本 "%TARGET%" 1>&2
  echo        可能仓库结构损坏。请重新拉最新代码或跑 scripts/deploy.mjs 修复。 1>&2
  exit /b 1
)
node "%TARGET%" %*

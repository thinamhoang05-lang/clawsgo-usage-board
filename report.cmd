@echo off
setlocal
cd /d "%~dp0"
node tools\report.cjs %*
pause

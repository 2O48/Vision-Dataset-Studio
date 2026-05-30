@echo off
setlocal
cd /d %~dp0
call scripts\run.bat %*
exit /b %errorlevel%

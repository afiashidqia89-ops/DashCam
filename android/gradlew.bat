@if "%DEBUG%"=="" @echo off
@rem Gradle wrapper for Windows
setlocal
set DIR=%~dp0
if "%DIR:~-1%"=="\" set DIR=%DIR:~0,-1%
call gradle -p "%DIR%" %*

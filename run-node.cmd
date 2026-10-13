@echo off
where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    node %*
) else (
    set ELECTRON_RUN_AS_NODE=1
    "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" %*
)

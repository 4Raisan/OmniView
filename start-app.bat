@echo off
cd /d "%~dp0"
if exist "%LOCALAPPDATA%\Programs\multi-viewer\OmniView.exe" (
    start "" "%LOCALAPPDATA%\Programs\multi-viewer\OmniView.exe" %*
    exit /b
)
if not exist "node_modules" (
    call npm ci
    if errorlevel 1 exit /b 1
)
call npm run build
if errorlevel 1 exit /b 1
call npm start -- %*

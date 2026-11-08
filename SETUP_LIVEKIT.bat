@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0SETUP_LIVEKIT.ps1"
if errorlevel 1 (
  echo.
  echo LiveKit ayarlari kaydedilemedi.
)
echo.
pause

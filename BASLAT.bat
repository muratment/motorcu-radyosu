@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo      MOTORCU RADYOSU - LIVEKIT 0.5.0
echo ============================================
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi. https://nodejs.org adresinden LTS kurun.
  pause
  exit /b 1
)
if not exist ".env" (
  echo LiveKit API bilgileri ilk kez ayarlaniyor...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0SETUP_LIVEKIT.ps1"
  if errorlevel 1 (
    echo LiveKit ayari tamamlanamadi.
    pause
    exit /b 1
  )
)
if not exist "node_modules\livekit-client" (
  echo LiveKit paketleri kuruluyor. Internet baglantisi gerekli...
  call npm.cmd install
  if errorlevel 1 (
    echo Kurulum basarisiz. Ekrandaki hatayi kontrol edin.
    pause
    exit /b 1
  )
)
echo LiveKit tarayici kutuphanesi hazirlaniyor...
call npm.cmd run build:livekit
if errorlevel 1 (
  echo LiveKit tarayici dosyasi olusturulamadi.
  pause
  exit /b 1
)
echo.
echo Sunucu baslatiliyor. Bu pencereyi kapatmayin.
echo.
call npm.cmd start
echo.
echo Sunucu durdu.
pause

@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Bot Telegram - Lich hoc SIC2026
echo.
echo  ============================================
echo   Bot Telegram thong bao lich hoc SIC2026
echo   - 08:00 sang (ngay co hoc)
echo   - Truoc gio hoc 2 tieng
echo  ============================================
echo.

if not exist ".env" (
  echo  [!] Chua co file .env
  echo      1. Mo Telegram, chat @BotFather → /newbot → copy token
  echo      2. Copy env.example thanh .env
  echo      3. Dan token vao TELEGRAM_BOT_TOKEN=...
  echo.
  if exist "env.example" (
    copy /Y "env.example" ".env" >nul
    echo  Da tao .env tu env.example — hay mo file .env va dien token.
    notepad ".env"
  )
  echo.
  pause
  exit /b 1
)

echo  Cap nhat lich tu Google Sheet...
python parse_schedule.py
echo.
echo  Khoi dong bot...
echo  Mo bot tren Telegram va go /start de dang ky nhan thong bao.
echo  Nhan Ctrl+C de dung.
echo.
python telegram_bot.py
echo.
pause

@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  === Thiet lap Bot Telegram Lich hoc SIC2026 ===
echo.
echo  Buoc 1: Tao bot
echo    - Mo Telegram, tim @BotFather
echo    - Go /newbot , dat ten (vd: Lich hoc SIC2026)
echo    - Dat username (phai ket thuc bang bot, vd: sic2026_lichhoc_bot)
echo    - Copy token dang: 123456:AAH...
echo.
echo  Buoc 2: Tao file .env
if not exist ".env" (
  copy /Y "env.example" ".env" >nul
  echo  Da tao .env
) else (
  echo  File .env da ton tai
)
echo.
echo  Mo Notepad de dan TOKEN vao dong TELEGRAM_BOT_TOKEN=...
notepad ".env"
echo.
echo  Buoc 3: Chay bot
echo    Double-click start_bot.bat
echo    Tren Telegram: mo bot cua ban → go /start
echo    Go /test de thu thong bao
echo.
pause

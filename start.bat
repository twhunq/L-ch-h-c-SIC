@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  === Lich hoc SIC2026 - Samsung ICTU ===
echo  Dang cap nhat du lieu tu Google Sheet...
echo.
python parse_schedule.py
if errorlevel 1 (
  echo.
  echo  [Canh bao] Khong cap nhat duoc sheet, se dung ban cu neu co.
  echo.
)
echo.
echo  Khoi dong server local...
python server.py
pause

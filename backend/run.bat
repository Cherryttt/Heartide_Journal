@echo off
REM MoodGarden backend launcher for Windows
REM Keep this file ASCII-only so cmd.exe never misreads comments.
cd /d %~dp0
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File scripts\ensure-backend-port.ps1
if %errorlevel%==0 (
  echo Heartide backend is already running at http://127.0.0.1:8000
  echo Open http://127.0.0.1:8000/api/health to verify it.
  exit /b 0
)
if %errorlevel% GEQ 2 exit /b %errorlevel%

echo Starting Heartide backend at http://127.0.0.1:8000
venv\Scripts\python.exe -m alembic upgrade head
if errorlevel 1 exit /b 1
venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000

@echo off
cd /d "%~dp0"
echo ========================================
echo  Coal Slicer Backend - FastAPI
echo ========================================
echo.
echo Starting server on http://127.0.0.1:8000
echo Press Ctrl+C to stop
echo.
call venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
pause

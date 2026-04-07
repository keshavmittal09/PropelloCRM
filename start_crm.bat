@echo off
echo ===========================================
echo        Starting Propello CRM System
echo ===========================================
echo.

echo [0/3] Clearing stale processes on ports 3000, 8000, 8001...
for %%P in (3000 8000 8001) do (
	for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
		taskkill /PID %%A /F >nul 2>&1
	)
)
echo.

echo [1/3] Starting CRM Backend Server (FastAPI)...
start "Propello CRM Backend" cmd /k "cd /d backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

echo [2/3] Starting CRM Frontend Server (Next.js)...
start "Propello CRM Frontend" cmd /k "cd /d frontend && npx next dev -p 3000"

echo [3/3] Starting Priya Chatbot Server (FastAPI)...
start "Priya Chatbot" cmd /k "cd /d chatbot && uvicorn app:app --host 0.0.0.0 --port 8001 --reload"

echo.
echo All servers are starting up in separate windows!
echo Please wait a few seconds, then open:
echo   CRM Dashboard: http://localhost:3000
echo   Chatbot UI:    http://localhost:8001
echo.
echo Note: Keep the two new Command Prompt windows open while using the CRM.
echo ===========================================


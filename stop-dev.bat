@echo off
setlocal

echo [AOD] Stopping dev servers on ports 4800 and 3000...

:: Try native Windows first (works without WSL)
for %%P in (4800 3000) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr :%%P ^| findstr LISTENING 2^>nul') do (
    taskkill /PID %%A /F >nul 2>&1
  )
)

echo [AOD] Done.
endlocal

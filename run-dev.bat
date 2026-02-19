@echo off
setlocal

:: Resolve the repo root from this .bat file's location
set REPO=%~dp0

echo [AOD] Repo: %REPO%
echo.

echo [AOD] Starting backend in a new window...
start "AOD Backend" cmd /k "cd /d "%REPO%" && pnpm --filter @aod/backend dev"

timeout /t 2 /nobreak >nul

echo [AOD] Starting frontend in a new window...
start "AOD Frontend" cmd /k "cd /d "%REPO%" && pnpm --filter @aod/frontend dev"

timeout /t 5 /nobreak >nul

echo [AOD] Opening dashboard in browser...
start "" http://127.0.0.1:3000

echo [AOD] Done.
endlocal

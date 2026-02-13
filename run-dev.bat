@echo off
setlocal

set REPO=/home/taniar/git/agent-office-dashboard

echo [AOD] Starting backend in a new window...
start "AOD Backend" cmd /k wsl.exe bash -lic "cd %REPO% && nvm use 22 >/dev/null 2>&1; pnpm --filter @aod/backend dev"

timeout /t 2 /nobreak >nul

echo [AOD] Starting frontend in a new window...
start "AOD Frontend" cmd /k wsl.exe bash -lic "cd %REPO% && nvm use 22 >/dev/null 2>&1; pnpm --filter @aod/frontend dev"

timeout /t 5 /nobreak >nul

echo [AOD] Opening dashboard in browser...
start "" http://127.0.0.1:3000

echo [AOD] Done.
endlocal

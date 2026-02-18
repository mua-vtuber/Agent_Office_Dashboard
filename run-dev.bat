@echo off
setlocal

:: Resolve the repo root from this .bat file's location
set REPO_WIN=%~dp0
:: Convert to WSL path: strip trailing backslash, replace \ with /, strip drive letter
set REPO_WSL=%REPO_WIN:\=/%
set REPO_WSL=%REPO_WSL:~2%
set DRIVE=%REPO_WIN:~0,1%
:: Lowercase the drive letter
for %%a in (a b c d e f g h i j k l m n o p q r s t u v w x y z) do call set DRIVE=%%DRIVE:%%a=%%a%%
set REPO_WSL=/mnt/%DRIVE%%REPO_WSL:~0,-1%

echo [AOD] Repo (Windows): %REPO_WIN%
echo [AOD] Repo (WSL):     %REPO_WSL%
echo.

echo [AOD] Starting backend in a new window...
start "AOD Backend" cmd /k wsl.exe bash -lic "cd '%REPO_WSL%' && nvm use 22 >/dev/null 2>&1; pnpm --filter @aod/backend dev"

timeout /t 2 /nobreak >nul

echo [AOD] Starting frontend in a new window...
start "AOD Frontend" cmd /k wsl.exe bash -lic "cd '%REPO_WSL%' && nvm use 22 >/dev/null 2>&1; pnpm --filter @aod/frontend dev"

timeout /t 5 /nobreak >nul

echo [AOD] Opening dashboard in browser...
start "" http://127.0.0.1:3000

echo [AOD] Done.
endlocal

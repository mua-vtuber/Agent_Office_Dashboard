@echo off
setlocal

echo [AOD] Stopping dev servers on ports 4800 and 3000 (WSL)...
wsl.exe bash -lc "for p in 4800 3000; do fuser -k ${p}/tcp >/dev/null 2>&1 || true; done"

echo [AOD] Done.
endlocal

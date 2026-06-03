@echo off
title ODC Server
echo.
echo  Starting ODC Event Dashboard...
echo.

cd /d E:\ODC

:: Start Node server in background
start "ODC-Node" /min cmd /c "node server.js > server.log 2>&1"
timeout /t 3 /nobreak >nul

:: Start Cloudflare tunnel - gives public HTTPS URL
echo  Server running on http://localhost:5050
echo.
echo  Starting public tunnel...
echo  (URL will appear below - share with your team)
echo.
cloudflared tunnel --url http://localhost:5050 --no-autoupdate 2>&1 | findstr /i "https\|trycloudflare\|URL\|tunnel"

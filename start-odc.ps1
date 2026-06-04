# ODC Server + ngrok tunnel auto-start
# Starts the Node.js server and ngrok tunnel on boot.

$ODC_DIR   = "E:\ODC"
$NODE      = "node"
$NGROK     = "ngrok"
$LOG_DIR   = "$ODC_DIR\logs"

if (!(Test-Path $LOG_DIR)) { New-Item -ItemType Directory -Path $LOG_DIR | Out-Null }

# Kill any existing instances
Get-Process -Name "node"  -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq "" } | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name "ngrok" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

Start-Sleep -Milliseconds 500

# Start Node server (background, log to file)
Start-Process -FilePath $NODE `
  -ArgumentList "server.js" `
  -WorkingDirectory $ODC_DIR `
  -RedirectStandardOutput "$LOG_DIR\server.log" `
  -RedirectStandardError  "$LOG_DIR\server-err.log" `
  -WindowStyle Hidden

Start-Sleep -Seconds 2

# Start ngrok tunnel (background)
Start-Process -FilePath $NGROK `
  -ArgumentList "start odc --log=stdout" `
  -WorkingDirectory $ODC_DIR `
  -RedirectStandardOutput "$LOG_DIR\ngrok.log" `
  -RedirectStandardError  "$LOG_DIR\ngrok-err.log" `
  -WindowStyle Hidden

Write-Host "ODC started. Access: https://thrift-connector-ventricle.ngrok-free.dev"

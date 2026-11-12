# Frees the ports BotTeam uses (from .env, or the defaults) by stopping whatever listens on them. A listener whose process is gone
# (a killed dev server whose uvicorn worker still holds the socket) is freed by stopping the processes that were started by it.
param([int[]]$Ports)
if (-not $Ports -or $Ports.Count -eq 0) {
  $env = @{ SERVER_PORT = 8899; WEB_PORT = 5299; WEBHOOK_PORT = 8900 }
  $file = Join-Path $PSScriptRoot "..\.env"
  if (Test-Path $file) {
    foreach ($line in Get-Content $file) {
      if ($line -match '^\s*(SERVER_PORT|WEB_PORT|WEBHOOK_PORT)\s*=\s*(\d+)') { $env[$Matches[1]] = [int]$Matches[2] }
    }
  }
  $Ports = @($env.SERVER_PORT, $env.WEB_PORT, $env.WEBHOOK_PORT)
}
foreach ($port in $Ports) {
  $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($id in $owners) {
    if (Get-Process -Id $id -ErrorAction SilentlyContinue) {
      Write-Host "port $port : stopping process $id"
      & taskkill /F /T /PID $id | Out-Null
    } else {
      $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$id" -ErrorAction SilentlyContinue
      foreach ($k in $kids) { Write-Host "port $port : stopping orphan $($k.ProcessId) of $id"; & taskkill /F /T /PID $k.ProcessId | Out-Null }
    }
  }
}
Start-Sleep -Milliseconds 500
$left = $Ports | Where-Object { Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue }
if ($left) { Write-Host "still in use: $($left -join ', ')"; exit 1 }
Write-Host "ports free: $($Ports -join ', ')"

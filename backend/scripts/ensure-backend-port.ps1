$ErrorActionPreference = "SilentlyContinue"

$healthOk = $false
try {
  $health = Invoke-RestMethod "http://127.0.0.1:8000/api/health" -TimeoutSec 2
  $openapi = Invoke-WebRequest "http://127.0.0.1:8000/openapi.json" -UseBasicParsing -TimeoutSec 2
  $hasImageHealth = $health.PSObject.Properties.Name -contains "image_generation_configured"
  if ($health.status -eq "ok" -and $health.version -eq "0.2.0" -and $hasImageHealth -and $openapi.Content -match "/api/auth/register") {
    $healthOk = $true
  }
} catch {
  $healthOk = $false
}

if ($healthOk) {
  exit 0
}

$connections = Get-NetTCPConnection -LocalPort 8000 -State Listen
if (-not $connections) {
  exit 1
}

$stoppedAny = $false
foreach ($owner in ($connections.OwningProcess | Sort-Object -Unique)) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$owner"
  $commandLine = [string]$proc.CommandLine
  if ($commandLine -match "uvicorn" -and $commandLine -match "main:app") {
    Write-Host "Stopping stale Heartide backend process PID $owner"
    Stop-Process -Id $owner -Force
    $stoppedAny = $true
  } else {
    Write-Host "Port 8000 is occupied by another process PID $owner"
    Write-Host $commandLine
  }
}

if ($stoppedAny) {
  Start-Sleep -Milliseconds 700
  exit 1
}

Write-Host "Please free port 8000, then run backend\\run.bat again."
exit 2

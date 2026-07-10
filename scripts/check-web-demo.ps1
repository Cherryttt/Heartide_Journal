$ErrorActionPreference = "Stop"

$backendUrl = "http://127.0.0.1:8000/api/health"
$frontendUrl = "http://127.0.0.1:5174"
$failed = $false

Write-Host "Heartide Web Demo Check" -ForegroundColor Cyan
Write-Host "--------------------------------"

try {
  $health = Invoke-RestMethod $backendUrl -TimeoutSec 3
  if ($health.status -eq "ok") {
    Write-Host "Backend: OK ($($health.database_backend), v$($health.version))" -ForegroundColor Green
  } else {
    Write-Host "Backend: DEGRADED ($($health.database))" -ForegroundColor Yellow
    $failed = $true
  }

  if ($health.emotion_model_loaded) {
    $calibrated = if ($health.emotion_model_calibrated) { "calibrated" } else { "uncalibrated" }
    Write-Host "Emotion model: OK ($calibrated)" -ForegroundColor Green
  } else {
    Write-Host "Emotion model: NOT LOADED" -ForegroundColor Red
    $failed = $true
  }

  if ($health.llm_configured) {
    Write-Host "LLM: configured" -ForegroundColor Green
  } else {
    Write-Host "LLM: not configured; AI generation will use fallbacks" -ForegroundColor Yellow
  }

  if ($health.image_generation_configured) {
    Write-Host "Image model: configured ($($health.image_model))" -ForegroundColor Green
  } else {
    Write-Host "Image model: not configured; journal image will use color-paper fallback" -ForegroundColor Yellow
  }

  if ($health.weread_configured) {
    Write-Host "WeRead: configured" -ForegroundColor Green
  } else {
    Write-Host "WeRead: not configured; reading page will use local/search fallbacks" -ForegroundColor Yellow
  }
} catch {
  Write-Host "Backend: cannot connect $backendUrl" -ForegroundColor Red
  $failed = $true
}

try {
  $web = Invoke-WebRequest $frontendUrl -UseBasicParsing -TimeoutSec 3
  if ($web.StatusCode -ge 200 -and $web.StatusCode -lt 400) {
    Write-Host "Frontend: OK $frontendUrl" -ForegroundColor Green
  } else {
    Write-Host "Frontend: status $($web.StatusCode)" -ForegroundColor Red
    $failed = $true
  }
} catch {
  Write-Host "Frontend: cannot connect $frontendUrl" -ForegroundColor Red
  $failed = $true
}

Write-Host "--------------------------------"
if ($failed) {
  Write-Host "Check failed. Start backend\run.bat and npm run dev first." -ForegroundColor Red
  exit 1
}

Write-Host "Check passed. Web demo is ready." -ForegroundColor Green

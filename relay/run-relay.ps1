$ErrorActionPreference = 'Continue'

$relayRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$logRoot = Join-Path $relayRoot 'logs'
$logPath = Join-Path $logRoot 'relay.log'
$serviceStopPath = Join-Path $relayRoot 'service.stop'
$node = (Get-Command node -ErrorAction Stop).Source

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
Set-Location -LiteralPath $relayRoot

while (-not (Test-Path -LiteralPath $serviceStopPath)) {
  if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 5MB) {
    $archive = Join-Path $logRoot ('relay-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')
    Move-Item -LiteralPath $logPath -Destination $archive
    Get-ChildItem -LiteralPath $logRoot -Filter 'relay-*.log' |
      Sort-Object LastWriteTime -Descending |
      Select-Object -Skip 5 |
      Remove-Item -Force
  }

  "$(Get-Date -Format o) Starting relay." | Add-Content -LiteralPath $logPath
  & $node (Join-Path $relayRoot 'relay.js') *>> $logPath
  $exitCode = $LASTEXITCODE
  "$(Get-Date -Format o) Relay exited with code $exitCode." | Add-Content -LiteralPath $logPath
  if (-not (Test-Path -LiteralPath $serviceStopPath)) { Start-Sleep -Seconds 5 }
}

Remove-Item -LiteralPath $serviceStopPath -Force -ErrorAction SilentlyContinue

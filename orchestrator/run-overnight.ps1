# Jousting MVP — Overnight Runner with Restart Loop
# Restarts the orchestrator if it exits early (crash, OOM, etc.)
# Usage: powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1

param(
    [int]$MaxHours = 10,
    [string]$Mission = "orchestrator\missions\overnight.json"
)

$startTime = Get-Date
$endTime = $startTime.AddHours($MaxHours)
$runCount = 0

Write-Host "============================================================"
Write-Host "  Jousting MVP — Overnight Runner"
Write-Host "  Started: $startTime"
Write-Host "  Will run until: $endTime ($MaxHours hours)"
Write-Host "  Mission: $Mission"
Write-Host "============================================================"
Write-Host ""

Set-Location (Split-Path $PSScriptRoot -Parent)

while ((Get-Date) -lt $endTime) {
    $runCount++
    $elapsed = ((Get-Date) - $startTime).TotalHours
    $remaining = [math]::Round($MaxHours - $elapsed, 1)

    Write-Host ""
    Write-Host "--- Run #$runCount | Elapsed: $([math]::Round($elapsed, 1))h | Remaining: ${remaining}h ---"
    Write-Host ""

    try {
        node orchestrator\orchestrator.mjs $Mission
    } catch {
        Write-Host "Orchestrator crashed: $_"
    }

    # Check if we still have time
    if ((Get-Date) -ge $endTime) {
        Write-Host "Time limit reached. Stopping."
        break
    }

    # Brief pause before restart
    Write-Host "Orchestrator exited. Restarting in 10 seconds..."
    Start-Sleep -Seconds 10
}

$totalElapsed = ((Get-Date) - $startTime).TotalHours
Write-Host ""
Write-Host "============================================================"
Write-Host "  Overnight run complete"
Write-Host "  Total time: $([math]::Round($totalElapsed, 1)) hours"
Write-Host "  Total orchestrator runs: $runCount"
Write-Host "  Report: orchestrator\overnight-report.md"
Write-Host "============================================================"

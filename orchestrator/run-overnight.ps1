# Jousting MVP - Overnight Runner with Restart Loop (v5)
# Includes: crash counter, exponential backoff, pre-restart validation
# Usage: powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1

param(
    [int]$MaxHours = 10,
    [string]$Mission = "orchestrator\missions\overnight.json",
    [int]$MaxCrashes = 5
)

$startTime = Get-Date
$endTime = $startTime.AddHours($MaxHours)
$runCount = 0
$crashCount = 0
$backoffSeconds = 10

Write-Host "============================================================"
Write-Host "  Jousting MVP - Overnight Runner (v5)"
Write-Host "  Started: $startTime"
Write-Host ('  Will run until: {0} ({1} hours)' -f $endTime, $MaxHours)
Write-Host "  Mission: $Mission"
Write-Host "  Max crashes before abort: $MaxCrashes"
Write-Host "============================================================"
Write-Host ""

Set-Location (Split-Path $PSScriptRoot -Parent)

# Pre-flight validation
Write-Host "Pre-flight checks..."
$testResult = & npx vitest run 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Tests are failing before run! Fix tests first."
    Write-Host ($testResult | Select-Object -Last 10)
    exit 1
}
Write-Host "  Tests: PASSING"

if (-not (Test-Path $Mission)) {
    Write-Host "ERROR: Mission file not found: $Mission"
    exit 1
}
Write-Host "  Mission file: OK"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: node not found in PATH"
    exit 1
}
Write-Host "  Node: OK"
Write-Host ""

while ((Get-Date) -lt $endTime) {
    $runCount++
    $elapsed = ((Get-Date) - $startTime).TotalHours
    $remaining = [math]::Round($MaxHours - $elapsed, 1)

    Write-Host ""
    Write-Host ('--- Run #{0} | Elapsed: {1}h | Remaining: {2}h | Crashes: {3}/{4} ---' -f $runCount, [math]::Round($elapsed, 1), $remaining, $crashCount, $MaxCrashes)
    Write-Host ""

    $exitCode = 0
    try {
        node orchestrator\orchestrator.mjs $Mission
        $exitCode = $LASTEXITCODE
    } catch {
        Write-Host "Orchestrator threw exception: $_"
        $exitCode = 1
    }

    # Check if we still have time
    if ((Get-Date) -ge $endTime) {
        Write-Host "Time limit reached. Stopping."
        break
    }

    # Track crashes and apply exponential backoff
    if ($exitCode -ne 0) {
        $crashCount++
        Write-Host "Orchestrator exited with code $exitCode (crash $crashCount/$MaxCrashes)"

        if ($crashCount -ge $MaxCrashes) {
            Write-Host "ERROR: Max crash limit ($MaxCrashes) reached. Aborting overnight run."
            break
        }

        # Exponential backoff: 10s, 20s, 40s, 80s, 160s
        $backoffSeconds = [math]::Min(10 * [math]::Pow(2, $crashCount - 1), 300)
        Write-Host "Backoff: waiting $backoffSeconds seconds before restart..."
        Start-Sleep -Seconds $backoffSeconds

        # Pre-restart validation: ensure tests still pass
        Write-Host "Pre-restart validation: running tests..."
        $preTestResult = & npx vitest run 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "WARNING: Tests failing after crash. Attempting git revert of last round..."
            # Try to revert to last known-good state
            git checkout HEAD -- src/
            $revertTestResult = & npx vitest run 2>&1
            if ($LASTEXITCODE -ne 0) {
                Write-Host "ERROR: Tests still failing after revert. Manual intervention needed."
                break
            }
            Write-Host "  Revert successful, tests passing again."
        } else {
            Write-Host "  Tests: PASSING (safe to restart)"
        }
    } else {
        # Normal exit — reset crash counter and backoff
        $crashCount = 0
        $backoffSeconds = 10
        Write-Host "Orchestrator exited normally. Restarting in 10 seconds..."
        Start-Sleep -Seconds 10
    }
}

$totalElapsed = ((Get-Date) - $startTime).TotalHours
Write-Host ""
Write-Host "============================================================"
Write-Host "  Overnight run complete"
Write-Host ('  Total time: {0} hours' -f [math]::Round($totalElapsed, 1))
Write-Host "  Total orchestrator runs: $runCount"
Write-Host "  Total crashes: $crashCount"
Write-Host "  Report: orchestrator\overnight-report.md"
Write-Host "============================================================"

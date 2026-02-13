# Jousting MVP - Overnight Runner with Restart Loop (v8)
# Includes: crash counter, exponential backoff, pre-restart validation, file logging
# Supports: regular missions and sequence missions (type: "sequence")
# Usage: powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1
# Usage: powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1 -Mission "orchestrator\missions\overnight-sequence.json"

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

Set-Location (Split-Path $PSScriptRoot -Parent)

# Set up file logging
$logDir = "orchestrator"
$logFile = Join-Path $logDir ("overnight-$(Get-Date -Format 'yyyyMMdd-HHmmss').log")

function Log($msg) {
    $timestamp = Get-Date -Format 'HH:mm:ss'
    $line = "[$timestamp] $msg"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

Log "============================================================"
Log "  Jousting MVP - Overnight Runner (v8)"
Log "  Started: $startTime"
Log ('  Will run until: {0} ({1} hours)' -f $endTime, $MaxHours)
Log "  Mission: $Mission"
Log "  Max crashes before abort: $MaxCrashes"
Log "  Log file: $logFile"
Log "============================================================"
Log ""

# Pre-flight validation
Log "Pre-flight checks..."
$testResult = & npx vitest run 2>&1
if ($LASTEXITCODE -ne 0) {
    Log "ERROR: Tests are failing before run! Fix tests first."
    Log ($testResult | Select-Object -Last 10)
    exit 1
}
Log "  Tests: PASSING"

if (-not (Test-Path $Mission)) {
    Log "ERROR: Mission file not found: $Mission"
    exit 1
}
Log "  Mission file: OK"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Log "ERROR: node not found in PATH"
    exit 1
}
Log "  Node: OK"
Log ""

while ((Get-Date) -lt $endTime) {
    $runCount++
    $elapsed = ((Get-Date) - $startTime).TotalHours
    $remaining = [math]::Round($MaxHours - $elapsed, 1)

    Log ""
    Log ('--- Run #{0} | Elapsed: {1}h | Remaining: {2}h | Crashes: {3}/{4} ---' -f $runCount, [math]::Round($elapsed, 1), $remaining, $crashCount, $MaxCrashes)
    Log ""

    $exitCode = 0
    try {
        node orchestrator\orchestrator.mjs $Mission
        $exitCode = $LASTEXITCODE
    } catch {
        Log "Orchestrator threw exception: $_"
        $exitCode = 1
    }

    # Check if we still have time
    if ((Get-Date) -ge $endTime) {
        Log "Time limit reached. Stopping."
        break
    }

    # v8: Exit code 42 = all work complete, no restart needed
    if ($exitCode -eq 42) {
        Log "Orchestrator reports all work complete (exit code 42). Stopping gracefully."
        break
    }

    # Track crashes and apply exponential backoff
    if ($exitCode -ne 0) {
        $crashCount++
        Log "Orchestrator exited with code $exitCode (crash $crashCount/$MaxCrashes)"

        if ($crashCount -ge $MaxCrashes) {
            Log "ERROR: Max crash limit ($MaxCrashes) reached. Aborting overnight run."
            break
        }

        # Exponential backoff: 10s, 20s, 40s, 80s, 160s
        $backoffSeconds = [math]::Min(10 * [math]::Pow(2, $crashCount - 1), 300)
        Log "Backoff: waiting $backoffSeconds seconds before restart..."
        Start-Sleep -Seconds $backoffSeconds

        # Pre-restart validation: ensure tests still pass
        Log "Pre-restart validation: running tests..."
        $preTestResult = & npx vitest run 2>&1
        if ($LASTEXITCODE -ne 0) {
            Log "WARNING: Tests failing after crash. Attempting git revert of last round..."
            # Try to revert to last known-good state
            git checkout HEAD -- src/
            $revertTestResult = & npx vitest run 2>&1
            if ($LASTEXITCODE -ne 0) {
                Log "ERROR: Tests still failing after revert. Manual intervention needed."
                break
            }
            Log "  Revert successful, tests passing again."
        } else {
            Log "  Tests: PASSING (safe to restart)"
        }
    } else {
        # Normal exit — reset crash counter and backoff
        $crashCount = 0
        $backoffSeconds = 10
        Log "Orchestrator exited normally. Restarting in 10 seconds..."
        Start-Sleep -Seconds 10
    }
}

$totalElapsed = ((Get-Date) - $startTime).TotalHours
Log ""
Log "============================================================"
Log "  Overnight run complete"
Log ('  Total time: {0} hours' -f [math]::Round($totalElapsed, 1))
Log "  Total orchestrator runs: $runCount"
Log "  Total crashes: $crashCount"
Log "  Report: orchestrator\overnight-report.md"
Log "============================================================"

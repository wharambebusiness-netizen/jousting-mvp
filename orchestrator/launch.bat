@echo off
cd /d "%~dp0\.."
start "JoustingOrchestrator" cmd /c "node orchestrator\orchestrator.mjs > orchestrator\logs\console.log 2>&1"
echo Orchestrator launched in background. Check orchestrator\logs\console.log for output.

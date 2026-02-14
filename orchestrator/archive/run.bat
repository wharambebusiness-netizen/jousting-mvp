@echo off
echo ============================================================
echo  Jousting MVP - Multi-Agent Orchestrator v2
echo  Starting at %date% %time%
echo ============================================================
echo.
echo  5 agents: ui-polish, ai-engine, ai-reasoning, balance-sim, quality-review
echo  Safety: 20min timeout/agent, 6hr max runtime, circuit breaker at 3 test failures
echo  Git backup after every round. Logs in orchestrator\logs\
echo.
echo  Press Ctrl+C to stop gracefully.
echo ============================================================
echo.

cd /d "%~dp0\.."
node orchestrator\orchestrator.mjs

echo.
echo ============================================================
echo  Orchestrator finished at %date% %time%
echo  Check orchestrator\logs\orchestrator.log for full results
echo  Check orchestrator\analysis\ for balance and quality reports
echo ============================================================
pause

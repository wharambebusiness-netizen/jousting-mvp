@echo off
echo ============================================================
echo  Jousting MVP - Overnight Orchestrator Run
echo  Starting at %date% %time%
echo ============================================================
echo.
echo  10 hour max runtime, 30 max rounds
echo  5 agents with stretch goals
echo  Safety: 20min timeout/agent, circuit breaker at 3 test failures
echo  Git backup after every round. Logs in orchestrator\logs\
echo.
echo  Report will be written to: orchestrator\overnight-report.md
echo.
echo  Close this window at any time - agents will be cleaned up.
echo ============================================================
echo.

cd /d "%~dp0\.."
node orchestrator\orchestrator.mjs

echo.
echo ============================================================
echo  Orchestrator finished at %date% %time%
echo.
echo  READ THIS FIRST:  orchestrator\overnight-report.md
echo.
echo  Detailed logs:    orchestrator\logs\orchestrator.log
echo  Analysis:         orchestrator\analysis\
echo  Agent handoffs:   orchestrator\handoffs\
echo ============================================================
pause

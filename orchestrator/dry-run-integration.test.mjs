import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ORCHESTRATOR = join(__dirname, 'orchestrator.mjs');
const TEMP_DIR = join(tmpdir(), 'dry-run-integ-' + Date.now());
const HANDOFF_DIR = join(TEMP_DIR, 'handoffs');

function runOrchestrator(args = [], timeoutMs = 30000) {
  return new Promise((resolve) => {
    const proc = spawn('node', [ORCHESTRATOR, ...args], {
      cwd: join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'test', ORCH_HANDOFF_DIR: HANDOFF_DIR },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ code: null, stdout, stderr, timedOut: true });
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut: false });
    });
  });
}

beforeEach(() => {
  mkdirSync(TEMP_DIR, { recursive: true });
});

afterEach(() => {
  try { rmSync(TEMP_DIR, { recursive: true, force: true }); } catch (_) {}
});

describe('dry-run integration (subprocess)', () => {
  it('completes with exit code 42 using 2-agent mission', async () => {
    const missionPath = join(TEMP_DIR, 'test-mission.json');
    writeFileSync(missionPath, JSON.stringify({
      name: 'Integration Test Mission',
      config: { maxRounds: 3, maxConcurrency: 2 },
      agents: [
        { id: 'agent-a', name: 'Agent A', type: 'feature', role: 'engine-dev', fileOwnership: ['src/engine/types.ts'] },
        { id: 'agent-b', name: 'Agent B', type: 'feature', role: 'engine-dev', fileOwnership: ['src/engine/match.ts'] },
      ],
    }));

    const result = await runOrchestrator(['--dry-run', missionPath], 30000);
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(42);
    expect(result.stdout).toContain('DRY-RUN');
    expect(result.stdout).toContain('agent-a');
    expect(result.stdout).toContain('agent-b');
  }, 35000);

  it('completes without mission config (default agents)', async () => {
    const result = await runOrchestrator(['--dry-run'], 30000);
    expect(result.timedOut).toBe(false);
    // Default agents have dependency chains — may hit maxRounds (0) or exhaust (42)
    expect([0, 42]).toContain(result.code);
    expect(result.stdout).toContain('DRY-RUN');
  }, 35000);

  it('supports --dry-run=chaos preset', async () => {
    const missionPath = join(TEMP_DIR, 'chaos-mission.json');
    writeFileSync(missionPath, JSON.stringify({
      name: 'Chaos Test',
      config: { maxRounds: 3, maxConcurrency: 2 },
      agents: [
        { id: 'dev', name: 'Dev', type: 'feature', role: 'engine-dev', fileOwnership: ['src/engine/types.ts'] },
        { id: 'qa', name: 'QA', type: 'feature', role: 'engine-dev', fileOwnership: ['src/engine/match.ts'] },
      ],
    }));

    const result = await runOrchestrator(['--dry-run=chaos', missionPath], 30000);
    expect(result.timedOut).toBe(false);
    // Chaos may exit 42 or 0 depending on random outcomes — just verify it runs
    expect([0, 42]).toContain(result.code);
    expect(result.stdout).toContain('DRY-RUN MODE: chaos');
  }, 35000);

  it('supports --dry-run=regression preset', async () => {
    const missionPath = join(TEMP_DIR, 'regression-mission.json');
    writeFileSync(missionPath, JSON.stringify({
      name: 'Regression Test',
      config: { maxRounds: 3, maxConcurrency: 2 },
      agents: [
        { id: 'dev', name: 'Dev', type: 'feature', role: 'engine-dev', fileOwnership: ['src/engine/types.ts'] },
        { id: 'qa', name: 'QA', type: 'feature', role: 'engine-dev', fileOwnership: ['src/engine/match.ts'] },
      ],
    }));

    const result = await runOrchestrator(['--dry-run=regression', missionPath], 30000);
    expect(result.timedOut).toBe(false);
    // Regression preset: agent failures + test failures
    expect(result.stdout).toContain('DRY-RUN MODE: regression');
  }, 35000);

  it('retires coord-role feature agents correctly', async () => {
    // Agents with roles NOT in CODE_AGENT_ROLES should still retire via handoff status
    const missionPath = join(TEMP_DIR, 'coord-mission.json');
    writeFileSync(missionPath, JSON.stringify({
      name: 'Coord Agent Lifecycle Test',
      config: { maxRounds: 3, maxConcurrency: 2 },
      agents: [
        { id: 'lead', name: 'Lead', type: 'feature', role: 'tech-lead', fileOwnership: ['src/engine/types.ts'] },
        { id: 'dev', name: 'Dev', type: 'feature', role: 'engine-dev', fileOwnership: ['src/engine/match.ts'] },
      ],
    }));

    const result = await runOrchestrator(['--dry-run', missionPath], 30000);
    expect(result.timedOut).toBe(false);
    // Both feature agents should retire after round 1 → exit 42
    expect(result.code).toBe(42);
    expect(result.stdout).toContain('all agents exhausted');
  }, 35000);

  it('rejects unknown preset', async () => {
    const result = await runOrchestrator(['--dry-run=unknown'], 10000);
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Unknown dry-run preset');
  }, 15000);
});

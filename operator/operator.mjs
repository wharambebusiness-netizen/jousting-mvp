#!/usr/bin/env node
// ============================================================
// Operator — Walking Skeleton (M1)
// ============================================================
// Auto-continuation CLI daemon. Runs a Claude session via the
// Agent SDK, monitors context usage, and automatically chains
// fresh sessions when work is incomplete — never compacts,
// always starts fresh with a handoff.
//
// Usage:
//   node operator/operator.mjs "task description"
//   node operator/operator.mjs --max-turns 10 --max-continuations 3 "task"
//   node operator/operator.mjs --dry-run "task"
//
// ============================================================

import { query } from '@anthropic-ai/claude-agent-sdk';
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { parseArgs } from 'util';

// ── Constants ───────────────────────────────────────────────

const OPERATOR_DIR = resolve(import.meta.dirname || new URL('.', import.meta.url).pathname.slice(1));
const PROJECT_DIR = resolve(OPERATOR_DIR, '..');
const HANDOFF_DIR = join(OPERATOR_DIR, 'handoffs');
const MAX_CONTINUATIONS_DEFAULT = 5;
const MAX_TURNS_DEFAULT = 30;

// ── CLI Argument Parsing ────────────────────────────────────

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'max-turns': { type: 'string', default: String(MAX_TURNS_DEFAULT) },
      'max-continuations': { type: 'string', default: String(MAX_CONTINUATIONS_DEFAULT) },
      'model': { type: 'string', default: 'sonnet' },
      'dry-run': { type: 'boolean', default: false },
      'permission-mode': { type: 'string', default: 'bypassPermissions' },
      'help': { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help || positionals.length === 0) {
    console.log(`
Operator — Auto-continuation CLI daemon (M1 Walking Skeleton)

Usage:
  node operator/operator.mjs [options] "task description"

Options:
  --max-turns N           Max turns per session (default: ${MAX_TURNS_DEFAULT})
  --max-continuations N   Max session chain length (default: ${MAX_CONTINUATIONS_DEFAULT})
  --model MODEL           Model to use: sonnet, opus, haiku (default: sonnet)
  --dry-run               Print config and exit without running
  --permission-mode MODE  Permission mode (default: bypassPermissions)
  -h, --help              Show this help
`);
    process.exit(values.help ? 0 : 1);
  }

  const MODEL_MAP = {
    haiku: 'claude-haiku-4-5-20251001',
    sonnet: 'claude-sonnet-4-5-20250929',
    opus: 'claude-opus-4-6',
  };

  return {
    task: positionals.join(' '),
    maxTurns: parseInt(values['max-turns'], 10),
    maxContinuations: parseInt(values['max-continuations'], 10),
    model: MODEL_MAP[values.model] || values.model,
    modelShort: values.model,
    dryRun: values['dry-run'],
    permissionMode: values['permission-mode'],
  };
}

// ── Logging ─────────────────────────────────────────────────

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(msg) {
  console.log(`[${timestamp()}] ${msg}`);
}

function logSection(title) {
  const bar = '─'.repeat(60);
  console.log(`\n${bar}`);
  console.log(`  ${title}`);
  console.log(bar);
}

// ── Git Operations ──────────────────────────────────────────

function gitExec(cmd) {
  return new Promise((resolve) => {
    const proc = spawn('cmd', ['/c', cmd], {
      cwd: PROJECT_DIR,
      shell: true,
      stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() }));
    proc.on('error', (err) => resolve({ ok: false, stdout: '', stderr: err.message }));
  });
}

async function autoCommit(chainIndex, sessionSummary) {
  const shortSummary = (sessionSummary || 'auto-continuation checkpoint').slice(0, 72);
  const msg = `operator: chain ${chainIndex} — ${shortSummary}`;

  // Stage all changes
  await gitExec('git add -A');

  // Check if there's anything to commit
  const diff = await gitExec('git diff --cached --quiet');
  if (diff.ok) {
    log('  No changes to commit');
    return false;
  }

  const result = await gitExec(`git commit -m "${msg.replace(/"/g, '\\"')}"`);
  if (result.ok) {
    log(`  Committed: ${msg}`);
    return true;
  }
  log(`  Commit failed: ${result.stderr.slice(0, 200)}`);
  return false;
}

// ── Handoff Parsing ─────────────────────────────────────────

/**
 * Extract handoff section from agent output text.
 * Looks for "## HANDOFF" or "## Handoff" section marker.
 * Returns { complete, summary, remaining, context } or null if no handoff found.
 */
function parseHandoff(outputText) {
  if (!outputText) return null;

  // Find the handoff section
  const handoffMatch = outputText.match(/^##\s*HANDOFF[:\s]*(COMPLETE)?.*$/im);
  if (!handoffMatch) return null;

  const isComplete = /COMPLETE/i.test(handoffMatch[0]);
  const startIdx = handoffMatch.index;
  const handoffText = outputText.slice(startIdx);

  // Extract sub-sections
  const summaryMatch = handoffText.match(/(?:accomplished|summary|done)[:\s]*\n?([\s\S]*?)(?=\n##|\n\*\*(?:remain|next|context)|$)/i);
  const remainingMatch = handoffText.match(/(?:remaining|todo|next|still needs)[:\s]*\n?([\s\S]*?)(?=\n##|\n\*\*(?:context|key)|$)/i);
  const contextMatch = handoffText.match(/(?:context|notes|important)[:\s]*\n?([\s\S]*?)$/i);

  return {
    complete: isComplete,
    raw: handoffText.trim(),
    summary: summaryMatch?.[1]?.trim() || '',
    remaining: remainingMatch?.[1]?.trim() || '',
    context: contextMatch?.[1]?.trim() || '',
  };
}

// ── System Prompt Construction ──────────────────────────────

function buildSystemPrompt(task, chainIndex, previousHandoff) {
  const handoffInstructions = `
IMPORTANT — AUTO-CONTINUATION PROTOCOL:
You are running inside an auto-continuation system. Your session has a limited number
of turns. At the END of your work (whether complete or not), you MUST write a handoff
section in your final message using this exact format:

## HANDOFF: COMPLETE
(use "COMPLETE" only if the entire task is done)

**Accomplished:** What you did this session
**Remaining:** What still needs to be done (omit if complete)
**Context:** Key details the next session needs to continue

This handoff will be parsed automatically. Always include it.`;

  if (chainIndex === 0) {
    return `You are working on the following task:

${task}

Working directory: ${PROJECT_DIR}

${handoffInstructions}`;
  }

  return `You are CONTINUING a previous session's work on:

${task}

Working directory: ${PROJECT_DIR}

--- PREVIOUS SESSION HANDOFF (session ${chainIndex}) ---
${previousHandoff}
--- END HANDOFF ---

Continue from where the previous session left off. Focus on the remaining work.
Do NOT redo work that was already completed.

${handoffInstructions}`;
}

// ── Session Runner ──────────────────────────────────────────

/**
 * Run a single Claude session via the Agent SDK.
 * Returns { output, handoff, cost, sessionId, turns, durationMs, hitMaxTurns, preCompacted }
 */
async function runSession(config, chainIndex, previousHandoff) {
  const systemPrompt = buildSystemPrompt(config.task, chainIndex, previousHandoff);

  let preCompacted = false;
  let outputText = '';
  let sessionId = null;
  let resultData = null;
  const startTime = Date.now();

  log(`Starting session ${chainIndex + 1}/${config.maxContinuations} (max ${config.maxTurns} turns)`);

  const hooks = {
    PreCompact: [{
      hooks: [async (input) => {
        preCompacted = true;
        log('  PreCompact fired — context window filling up');
        return {
          systemMessage: 'Your context window is nearly full. Wrap up your current work and write your HANDOFF section now.',
        };
      }],
    }],
  };

  try {
    for await (const message of query({
      prompt: systemPrompt,
      options: {
        model: config.model,
        maxTurns: config.maxTurns,
        cwd: PROJECT_DIR,
        permissionMode: config.permissionMode,
        allowDangerouslySkipPermissions: config.permissionMode === 'bypassPermissions',
        allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'Task'],
        hooks,
      },
    })) {
      // Capture session ID from init message
      if (message.type === 'system' && message.subtype === 'init') {
        sessionId = message.session_id;
        log(`  Session ID: ${sessionId}`);
      }

      // Collect assistant output text
      if (message.type === 'assistant') {
        const content = message.message?.content || [];
        for (const block of Array.isArray(content) ? content : []) {
          if (block.type === 'text') outputText += block.text;
        }
      }

      // Capture result
      if (message.type === 'result') {
        resultData = message;
        if (message.result?.text) outputText += message.result.text;
      }

      // Session ID can come from any message
      if (message.session_id && !sessionId) sessionId = message.session_id;
    }
  } catch (err) {
    log(`  Session error: ${err.message}`);
    outputText += `\n[SESSION ERROR: ${err.message}]`;
  }

  const durationMs = Date.now() - startTime;
  const hitMaxTurns = resultData?.subtype === 'error_max_turns';

  // Extract cost data from result
  const cost = {
    totalUsd: resultData?.total_cost_usd || 0,
    durationMs: resultData?.duration_ms || durationMs,
    durationApiMs: resultData?.duration_api_ms || 0,
    turns: resultData?.num_turns || 0,
    usage: resultData?.usage || {},
    modelUsage: resultData?.modelUsage || {},
  };

  // Parse handoff from output
  const handoff = parseHandoff(outputText);

  return {
    output: outputText,
    handoff,
    cost,
    sessionId,
    turns: cost.turns,
    durationMs,
    hitMaxTurns,
    preCompacted,
  };
}

// ── Chain Runner ────────────────────────────────────────────

/**
 * Run a chain of sessions until the task is complete or max continuations reached.
 */
async function runChain(config) {
  const chainLog = {
    task: config.task,
    sessions: [],
    totalCostUsd: 0,
    totalDurationMs: 0,
    totalTurns: 0,
    outcome: 'unknown',
  };

  let previousHandoff = null;

  for (let i = 0; i < config.maxContinuations; i++) {
    logSection(`Session ${i + 1} of ${config.maxContinuations}`);

    const result = await runSession(config, i, previousHandoff);

    // Log session results
    chainLog.sessions.push({
      index: i,
      sessionId: result.sessionId,
      turns: result.turns,
      costUsd: result.cost.totalUsd,
      durationMs: result.durationMs,
      hitMaxTurns: result.hitMaxTurns,
      preCompacted: result.preCompacted,
      handoffComplete: result.handoff?.complete || false,
    });
    chainLog.totalCostUsd += result.cost.totalUsd;
    chainLog.totalDurationMs += result.durationMs;
    chainLog.totalTurns += result.turns;

    log(`  Turns: ${result.turns}, Cost: $${result.cost.totalUsd.toFixed(4)}, Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
    log(`  Hit max turns: ${result.hitMaxTurns}, PreCompacted: ${result.preCompacted}`);

    if (result.handoff) {
      log(`  Handoff: ${result.handoff.complete ? 'COMPLETE' : 'continuation needed'}`);
    } else {
      log('  No handoff section found in output');
    }

    // Save handoff to file
    const handoffPath = join(HANDOFF_DIR, `chain-${i}.md`);
    mkdirSync(HANDOFF_DIR, { recursive: true });
    writeFileSync(handoffPath, [
      `# Session ${i + 1} Handoff`,
      `- Session ID: ${result.sessionId}`,
      `- Turns: ${result.turns}`,
      `- Cost: $${result.cost.totalUsd.toFixed(4)}`,
      `- Hit max turns: ${result.hitMaxTurns}`,
      `- PreCompacted: ${result.preCompacted}`,
      '',
      result.handoff?.raw || '(no handoff section found)',
    ].join('\n'));

    // Check if task is complete
    if (result.handoff?.complete) {
      log('Task completed!');
      chainLog.outcome = 'complete';
      // Final commit
      await autoCommit(i, 'task complete');
      break;
    }

    // If no handoff and session didn't hit limits, assume it finished (or errored)
    if (!result.handoff && !result.hitMaxTurns && !result.preCompacted) {
      log('Session ended without handoff or hitting limits — assuming complete');
      chainLog.outcome = 'assumed-complete';
      await autoCommit(i, 'session ended');
      break;
    }

    // Continuation needed — commit and prepare for next session
    if (i < config.maxContinuations - 1) {
      log('Continuation needed — committing and preparing next session...');
      await autoCommit(i, result.handoff?.summary || 'continuation checkpoint');

      // Build context for next session from handoff
      previousHandoff = result.handoff?.raw || `Session ${i + 1} ended after ${result.turns} turns. Output tail:\n${result.output.slice(-2000)}`;
    } else {
      log('Max continuations reached — stopping chain');
      chainLog.outcome = 'max-continuations';
      await autoCommit(i, 'max continuations reached');
    }
  }

  return chainLog;
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const config = parseCliArgs();

  logSection('Operator — Walking Skeleton (M1)');
  log(`Task: ${config.task}`);
  log(`Model: ${config.modelShort} (${config.model})`);
  log(`Max turns per session: ${config.maxTurns}`);
  log(`Max continuations: ${config.maxContinuations}`);
  log(`Permission mode: ${config.permissionMode}`);
  log(`Project dir: ${PROJECT_DIR}`);

  if (config.dryRun) {
    log('DRY RUN — exiting');
    process.exit(0);
  }

  const chainLog = await runChain(config);

  // Save chain summary
  logSection('Chain Summary');
  log(`Outcome: ${chainLog.outcome}`);
  log(`Sessions: ${chainLog.sessions.length}`);
  log(`Total turns: ${chainLog.totalTurns}`);
  log(`Total cost: $${chainLog.totalCostUsd.toFixed(4)}`);
  log(`Total duration: ${(chainLog.totalDurationMs / 1000).toFixed(1)}s`);

  // Write chain log
  const logPath = join(OPERATOR_DIR, 'last-chain.json');
  writeFileSync(logPath, JSON.stringify(chainLog, null, 2));
  log(`Chain log saved to ${logPath}`);
}

main().catch(err => {
  console.error(`\nOperator fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});

#!/usr/bin/env node
// ============================================================
// Operator — Robust Session Management (M2)
// ============================================================
// Auto-continuation CLI daemon. Runs Claude sessions via the
// Agent SDK, monitors context usage, and automatically chains
// fresh sessions when work is incomplete.
//
// M2 additions over M1:
//   - Session registry with persistence (registry.mjs)
//   - Error recovery with classification + retry (errors.mjs)
//   - Cost tracking + budget circuit breaker
//   - Handoff validation with retry
//   - Auto-push + webhook notifications
//   - --resume flag for crash recovery
//   - --project-dir for multi-project support
//
// Usage:
//   node operator/operator.mjs "task description"
//   node operator/operator.mjs --max-turns 10 --max-continuations 3 "task"
//   node operator/operator.mjs --resume
//   node operator/operator.mjs --project-dir /path/to/repo "task"
//   node operator/operator.mjs --max-budget-usd 2.00 --auto-push "task"
//   node operator/operator.mjs --dry-run "task"
//
// ============================================================

import { query } from '@anthropic-ai/claude-agent-sdk';
import { spawn } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { parseArgs } from 'util';

import {
  initRegistry, loadRegistry, saveRegistry,
  createChain, recordSession, updateChainStatus,
  findIncompleteChains, getChainSummary,
} from './registry.mjs';

import {
  classifyError, classifyAssistantError, classifyResultError,
  withRetry, shouldTripCircuitBreaker,
  generateSyntheticHandoff, validateHandoff, sleep,
} from './errors.mjs';

// ── Constants ───────────────────────────────────────────────

const OPERATOR_DIR = resolve(import.meta.dirname || new URL('.', import.meta.url).pathname.slice(1));
const MAX_CONTINUATIONS_DEFAULT = 5;
const MAX_TURNS_DEFAULT = 30;
const MAX_BUDGET_DEFAULT = 5.0;

// ── CLI Argument Parsing ────────────────────────────────────

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'max-turns':          { type: 'string', default: String(MAX_TURNS_DEFAULT) },
      'max-continuations':  { type: 'string', default: String(MAX_CONTINUATIONS_DEFAULT) },
      'max-budget-usd':     { type: 'string', default: String(MAX_BUDGET_DEFAULT) },
      'model':              { type: 'string', default: 'sonnet' },
      'project-dir':        { type: 'string', default: '' },
      'dry-run':            { type: 'boolean', default: false },
      'resume':             { type: 'boolean', default: false },
      'auto-push':          { type: 'boolean', default: false },
      'notify-webhook':     { type: 'string', default: '' },
      'permission-mode':    { type: 'string', default: 'bypassPermissions' },
      'help':               { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values.help) {
    console.log(`
Operator — Auto-continuation CLI daemon (M2)

Usage:
  node operator/operator.mjs [options] "task description"
  node operator/operator.mjs --resume

Options:
  --max-turns N           Max turns per session (default: ${MAX_TURNS_DEFAULT})
  --max-continuations N   Max session chain length (default: ${MAX_CONTINUATIONS_DEFAULT})
  --max-budget-usd N      Max total cost in USD (default: ${MAX_BUDGET_DEFAULT})
  --model MODEL           Model: sonnet, opus, haiku (default: sonnet)
  --project-dir PATH      Working directory for the agent (default: parent of operator/)
  --resume                Resume most recent incomplete chain
  --auto-push             Push to git remote after chain completion
  --notify-webhook URL    POST chain summary to webhook URL
  --dry-run               Print config and exit without running
  --permission-mode MODE  Permission mode (default: bypassPermissions)
  -h, --help              Show this help

Environment variables:
  OPERATOR_AUTO_PUSH=1              Enable auto-push
  OPERATOR_NOTIFY_WEBHOOK=https://  Webhook URL
`);
    process.exit(0);
  }

  // Require either a task or --resume
  if (!values.resume && positionals.length === 0) {
    console.error('Error: provide a task description or use --resume');
    process.exit(1);
  }

  const MODEL_MAP = {
    haiku: 'claude-haiku-4-5-20251001',
    sonnet: 'claude-sonnet-4-5-20250929',
    opus: 'claude-opus-4-6',
  };

  // Resolve project directory: --project-dir > parent of operator/
  const projectDir = values['project-dir']
    ? resolve(values['project-dir'])
    : resolve(OPERATOR_DIR, '..');

  return {
    task: positionals.join(' '),
    maxTurns: parseInt(values['max-turns'], 10),
    maxContinuations: parseInt(values['max-continuations'], 10),
    maxBudgetUsd: parseFloat(values['max-budget-usd']),
    model: MODEL_MAP[values.model] || values.model,
    modelShort: values.model,
    projectDir,
    dryRun: values['dry-run'],
    resume: values.resume,
    autoPush: values['auto-push'] || process.env.OPERATOR_AUTO_PUSH === '1',
    notifyWebhook: values['notify-webhook'] || process.env.OPERATOR_NOTIFY_WEBHOOK || '',
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

function gitExec(cmd, cwd) {
  return new Promise((resolve) => {
    const proc = spawn('cmd', ['/c', cmd], {
      cwd,
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

async function autoCommit(chainIndex, sessionSummary, projectDir) {
  const shortSummary = (sessionSummary || 'auto-continuation checkpoint').slice(0, 72);
  const msg = `operator: chain ${chainIndex} — ${shortSummary}`;

  await gitExec('git add -A', projectDir);
  const diff = await gitExec('git diff --cached --quiet', projectDir);
  if (diff.ok) {
    log('  No changes to commit');
    return false;
  }

  // Use spawn with array args to avoid shell injection from LLM output
  const result = await gitCommit(msg, projectDir);
  if (result.ok) {
    log(`  Committed: ${msg}`);
    return true;
  }
  log(`  Commit failed: ${result.stderr.slice(0, 200)}`);
  return false;
}

function gitCommit(message, cwd) {
  return new Promise((resolve) => {
    const proc = spawn('git', ['commit', '-m', message], {
      cwd,
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

async function autoPush(projectDir) {
  log('  Pushing to remote...');
  const result = await gitExec('git push', projectDir);
  if (result.ok) {
    log('  Push successful');
    return true;
  }
  log(`  Push failed: ${result.stderr.slice(0, 200)}`);
  return false;
}

// ── Webhook Notifications ───────────────────────────────────

async function sendWebhook(url, payload) {
  if (!url) return;
  log(`  Sending webhook to ${url}...`);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        log('  Webhook sent successfully');
        return true;
      }
      log(`  Webhook returned ${res.status}`);
    } catch (err) {
      log(`  Webhook failed (attempt ${attempt + 1}): ${err.message}`);
    }
    if (attempt === 0) await sleep(2000);
  }
  return false;
}

// ── Handoff Parsing ─────────────────────────────────────────

/**
 * Extract handoff section from agent output text.
 * Looks for "## HANDOFF" or "## Handoff" section marker.
 * Returns { complete, summary, remaining, context, raw } or null.
 */
function parseHandoff(outputText) {
  if (!outputText) return null;

  const handoffMatch = outputText.match(/^##\s*HANDOFF[:\s]*(COMPLETE)?.*$/im);
  if (!handoffMatch) return null;

  const isComplete = /COMPLETE/i.test(handoffMatch[0]);
  const startIdx = handoffMatch.index;
  const handoffText = outputText.slice(startIdx);

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

function buildSystemPrompt(task, chainIndex, previousHandoff, projectDir) {
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

Working directory: ${projectDir}

${handoffInstructions}`;
  }

  return `You are CONTINUING a previous session's work on:

${task}

Working directory: ${projectDir}

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
 * Returns { output, handoff, cost, sessionId, turns, durationMs, hitMaxTurns, preCompacted, error, inBandError }
 */
async function runSession(config, chainIndex, previousHandoff, spentBudgetUsd = 0) {
  const systemPrompt = buildSystemPrompt(config.task, chainIndex, previousHandoff, config.projectDir);

  let preCompacted = false;
  let outputText = '';
  let sessionId = null;
  let resultData = null;
  let inBandError = null;
  const startTime = Date.now();

  log(`Starting session ${chainIndex + 1}/${config.maxContinuations} (max ${config.maxTurns} turns)`);

  const hooks = {
    PreCompact: [{
      hooks: [async () => {
        preCompacted = true;
        log('  PreCompact fired — context window filling up');
        return {
          systemMessage: 'Your context window is nearly full. Wrap up your current work and write your HANDOFF section now.',
        };
      }],
    }],
  };

  // Strip CLAUDECODE env var to allow nested SDK sessions
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;

  const queryOptions = {
    model: config.model,
    maxTurns: config.maxTurns,
    cwd: config.projectDir,
    permissionMode: config.permissionMode,
    allowDangerouslySkipPermissions: config.permissionMode === 'bypassPermissions',
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'Task'],
    hooks,
    env: cleanEnv,
    stderr: (data) => {
      const line = data.toString().trim();
      if (line) log(`  [stderr] ${line}`);
    },
  };

  // Pass remaining budget to SDK for per-session enforcement
  if (config.maxBudgetUsd && config.maxBudgetUsd < Infinity) {
    const remainingBudget = config.maxBudgetUsd - spentBudgetUsd;
    if (remainingBudget > 0) {
      queryOptions.maxBudgetUsd = remainingBudget;
    }
  }

  try {
    for await (const message of query({ prompt: systemPrompt, options: queryOptions })) {
      if (message.type === 'system') {
        log(`  [${message.type}:${message.subtype}] ${message.session_id ? 'sid=' + message.session_id.slice(0, 8) : ''}`);
        if (message.subtype === 'init') sessionId = message.session_id;
      }

      if (message.type === 'assistant') {
        // Check for in-band errors on assistant messages
        if (message.error) {
          const errorClass = classifyAssistantError(message.error);
          log(`  [assistant:error] ${message.error} → ${errorClass}`);
          if (errorClass === 'fatal') {
            inBandError = { type: 'assistant', error: message.error, classification: 'fatal' };
          }
        }

        const content = message.message?.content || [];
        for (const block of Array.isArray(content) ? content : []) {
          if (block.type === 'text') {
            outputText += block.text;
            const preview = block.text.slice(0, 120).replace(/\n/g, ' ');
            if (preview.trim()) log(`  [assistant] ${preview}...`);
          }
        }
      }

      if (message.type === 'tool_use' || message.type === 'tool_result') {
        const toolName = message.tool_name || message.name || '?';
        log(`  [${message.type}] ${toolName}`);
      }

      if (message.type === 'result') {
        resultData = message;
        log(`  [result] subtype=${message.subtype}, turns=${message.num_turns}, cost=$${(message.total_cost_usd || 0).toFixed(4)}`);
        if (message.result?.text) outputText += message.result.text;

        // Check for result-level errors
        if (message.is_error) {
          const resultClass = classifyResultError(message.subtype);
          log(`  [result:error] ${message.subtype} → ${resultClass}`);
          if (resultClass === 'fatal') {
            inBandError = { type: 'result', subtype: message.subtype, classification: 'fatal' };
          }
        }
      }

      if (message.session_id && !sessionId) sessionId = message.session_id;
    }
  } catch (err) {
    // Thrown error — will be handled by the chain runner's retry logic
    const durationMs = Date.now() - startTime;
    log(`  Session error: ${err.message}`);

    return {
      output: outputText,
      handoff: parseHandoff(outputText),
      cost: { totalUsd: resultData?.total_cost_usd || 0, turns: resultData?.num_turns || 0 },
      sessionId,
      turns: resultData?.num_turns || 0,
      durationMs,
      hitMaxTurns: false,
      preCompacted,
      error: err,
      inBandError: null,
    };
  }

  const durationMs = Date.now() - startTime;
  const hitMaxTurns = resultData?.subtype === 'error_max_turns';

  return {
    output: outputText,
    handoff: parseHandoff(outputText),
    cost: {
      totalUsd: resultData?.total_cost_usd || 0,
      turns: resultData?.num_turns || 0,
      usage: resultData?.usage || {},
    },
    sessionId,
    turns: resultData?.num_turns || 0,
    durationMs,
    hitMaxTurns,
    preCompacted,
    error: null,
    inBandError,
  };
}

// ── Handoff Retry ───────────────────────────────────────────

/**
 * Run a short session specifically to get a handoff when one was missing.
 */
async function retryForHandoff(config, chainIndex, previousOutput) {
  log('  Retrying session for handoff...');
  const outputTail = previousOutput.slice(-2000);
  const prompt = `You were just working on a task but did not write a HANDOFF section. Here is the tail of your output:

--- OUTPUT TAIL ---
${outputTail}
--- END ---

Please write your HANDOFF section now in the exact format:

## HANDOFF: COMPLETE
(or just ## HANDOFF if not complete)

**Accomplished:** What was done
**Remaining:** What still needs to be done
**Context:** Key details for the next session`;

  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;

  let outputText = '';
  try {
    for await (const message of query({
      prompt,
      options: {
        model: config.model,
        maxTurns: 2,
        cwd: config.projectDir,
        permissionMode: config.permissionMode,
        allowDangerouslySkipPermissions: config.permissionMode === 'bypassPermissions',
        allowedTools: [],
        env: cleanEnv,
      },
    })) {
      if (message.type === 'assistant') {
        const content = message.message?.content || [];
        for (const block of Array.isArray(content) ? content : []) {
          if (block.type === 'text') outputText += block.text;
        }
      }
      if (message.type === 'result' && message.result?.text) {
        outputText += message.result.text;
      }
    }
  } catch (err) {
    log(`  Handoff retry failed: ${err.message}`);
    return null;
  }

  return parseHandoff(outputText);
}

// ── Chain Runner ────────────────────────────────────────────

/**
 * Run a chain of sessions until the task is complete, budget exhausted,
 * circuit breaker trips, or max continuations reached.
 */
async function runChain(config, registry, existingChain) {
  const handoffDir = join(OPERATOR_DIR, 'handoffs');
  mkdirSync(handoffDir, { recursive: true });

  // Create or reuse chain record
  const chain = existingChain || createChain(registry, {
    task: config.task,
    config: {
      model: config.modelShort,
      maxTurns: config.maxTurns,
      maxContinuations: config.maxContinuations,
      maxBudgetUsd: config.maxBudgetUsd,
    },
    projectDir: config.projectDir,
  });

  saveRegistry(registry);

  // Determine starting index (for resume)
  const startIndex = chain.sessions.length;
  let previousHandoff = null;

  // If resuming, reconstruct previous handoff from last session's handoff file
  if (startIndex > 0) {
    const lastSession = chain.sessions[chain.sessions.length - 1];
    if (lastSession.handoffFile && existsSync(lastSession.handoffFile)) {
      previousHandoff = readFileSync(lastSession.handoffFile, 'utf-8');
      log(`  Resuming from session ${startIndex} with previous handoff`);
    }
  }

  for (let i = startIndex; i < config.maxContinuations; i++) {
    logSection(`Session ${i + 1} of ${config.maxContinuations}`);

    // ── Budget check ──
    if (chain.totalCostUsd >= config.maxBudgetUsd) {
      log(`Budget exceeded ($${chain.totalCostUsd.toFixed(4)} >= $${config.maxBudgetUsd.toFixed(2)}) — aborting chain`);
      updateChainStatus(chain, 'aborted');
      saveRegistry(registry);
      break;
    }

    // ── Circuit breaker check ──
    if (shouldTripCircuitBreaker(chain.consecutiveErrors)) {
      log(`Circuit breaker tripped (${chain.consecutiveErrors} consecutive errors) — aborting chain`);
      updateChainStatus(chain, 'failed');
      saveRegistry(registry);
      break;
    }

    // ── Abort check (SIGINT/SIGTERM) ──
    if (_abortRequested) {
      log('Abort requested — stopping chain');
      updateChainStatus(chain, 'aborted');
      saveRegistry(registry);
      await autoCommit(i, 'aborted by user', config.projectDir);
      break;
    }

    // ── Run session with retry ──
    const { result: sessionResult, error: retryError, attempts, classification } = await withRetry(
      async () => {
        const result = await runSession(config, i, previousHandoff, chain.totalCostUsd);

        // If session threw an error, re-throw for retry logic
        if (result.error) throw result.error;

        // If in-band fatal error, throw to trigger fatal abort
        if (result.inBandError?.classification === 'fatal') {
          const err = new Error(`In-band fatal error: ${result.inBandError.error || result.inBandError.subtype}`);
          err._inBand = true;
          err._sessionResult = result;  // preserve partial result
          throw err;
        }

        return result;
      },
      { log, maxRetries: 3 }
    );

    // Determine the final result (from successful run or last failed attempt)
    let result;
    if (sessionResult) {
      result = sessionResult;
    } else {
      // All retries exhausted or fatal error — construct result from error
      const partialResult = retryError?._sessionResult;
      result = partialResult || {
        output: '',
        handoff: null,
        cost: { totalUsd: 0, turns: 0 },
        sessionId: null,
        turns: 0,
        durationMs: 0,
        hitMaxTurns: false,
        preCompacted: false,
        error: retryError,
        inBandError: null,
      };
    }

    // ── Record session ──
    log(`  Turns: ${result.turns}, Cost: $${result.cost.totalUsd.toFixed(4)}, Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
    log(`  Hit max turns: ${result.hitMaxTurns}, PreCompacted: ${result.preCompacted}`);
    if (attempts > 1) log(`  Attempts: ${attempts}`);

    const handoffPath = join(handoffDir, `${chain.id.slice(0, 8)}-session-${i}.md`);
    writeFileSync(handoffPath, [
      `# Session ${i + 1} Handoff`,
      `- Session ID: ${result.sessionId}`,
      `- Turns: ${result.turns}`,
      `- Cost: $${result.cost.totalUsd.toFixed(4)}`,
      `- Hit max turns: ${result.hitMaxTurns}`,
      `- PreCompacted: ${result.preCompacted}`,
      result.error ? `- Error: ${result.error.message}` : '',
      '',
      result.handoff?.raw || '(no handoff section found)',
    ].filter(Boolean).join('\n'));

    recordSession(chain, {
      sessionId: result.sessionId,
      turns: result.turns,
      costUsd: result.cost.totalUsd,
      durationMs: result.durationMs,
      hitMaxTurns: result.hitMaxTurns,
      preCompacted: result.preCompacted,
      handoffComplete: result.handoff?.complete || false,
      handoffFile: handoffPath,
      error: result.error ? result.error.message : (retryError ? retryError.message : null),
    });
    saveRegistry(registry);

    // ── Fatal error → abort ──
    if (retryError && classification === 'fatal') {
      log(`Fatal error — aborting chain: ${retryError.message}`);
      updateChainStatus(chain, 'failed');
      saveRegistry(registry);
      await autoCommit(i, 'chain failed (fatal error)', config.projectDir);
      break;
    }

    // ── Handoff validation (M2d) ──
    let handoff = result.handoff;

    if (result.handoff) {
      const validation = validateHandoff(result.handoff);
      if (!validation.valid) {
        log(`  Handoff validation failed: ${validation.reason}`);
      } else {
        log(`  Handoff: ${result.handoff.complete ? 'COMPLETE' : 'continuation needed'}`);
      }
    } else if (!result.error && !retryError) {
      log('  No handoff section found — retrying for handoff...');
      handoff = await retryForHandoff(config, i, result.output);
      if (handoff) {
        log('  Got handoff from retry');
        // Update the handoff file
        writeFileSync(handoffPath, [
          `# Session ${i + 1} Handoff (from retry)`,
          `- Session ID: ${result.sessionId}`,
          '',
          handoff.raw || '(empty)',
        ].join('\n'));
      } else {
        log('  Handoff retry also failed — using synthetic handoff');
      }
    }

    // ── Task complete? ──
    if (handoff?.complete) {
      log('Task completed!');
      updateChainStatus(chain, 'complete');
      saveRegistry(registry);
      await autoCommit(i, 'task complete', config.projectDir);
      break;
    }

    // ── No handoff, no limits hit → assume complete ──
    if (!handoff && !result.hitMaxTurns && !result.preCompacted && !result.error && !retryError) {
      log('Session ended without handoff or hitting limits — assuming complete');
      updateChainStatus(chain, 'assumed-complete');
      saveRegistry(registry);
      await autoCommit(i, 'session ended', config.projectDir);
      break;
    }

    // ── Continuation needed ──
    if (i < config.maxContinuations - 1) {
      log('Continuation needed — committing and preparing next session...');
      await autoCommit(i, handoff?.summary || 'continuation checkpoint', config.projectDir);

      // Build context for next session
      if (handoff) {
        previousHandoff = handoff.raw;
      } else if (result.error || retryError) {
        // Error recovery: synthetic handoff
        previousHandoff = generateSyntheticHandoff({
          output: result.output,
          error: result.error || retryError,
          sessionIndex: i,
        });
      } else {
        previousHandoff = `Session ${i + 1} ended after ${result.turns} turns. Output tail:\n${result.output.slice(-2000)}`;
      }
    } else {
      log('Max continuations reached — stopping chain');
      updateChainStatus(chain, 'max-continuations');
      saveRegistry(registry);
      await autoCommit(i, 'max continuations reached', config.projectDir);
    }
  }

  // Final status if still running (loop completed without break)
  if (chain.status === 'running') {
    updateChainStatus(chain, 'max-continuations');
    saveRegistry(registry);
  }

  return chain;
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const config = parseCliArgs();

  setupSignalHandlers();

  // Initialize registry
  initRegistry({ operatorDir: OPERATOR_DIR, log });
  const registry = loadRegistry();

  logSection('Operator — Robust Session Management (M2)');

  // Handle --resume
  if (config.resume) {
    const incomplete = findIncompleteChains(registry);
    if (incomplete.length === 0) {
      log('No incomplete chains found to resume');
      process.exit(0);
    }
    const chain = incomplete[0];
    log(`Resuming chain ${chain.id.slice(0, 8)}: "${chain.task.slice(0, 60)}"`);
    log(`  Sessions so far: ${chain.sessions.length}, Cost: $${chain.totalCostUsd.toFixed(4)}`);

    // Use chain's stored config
    config.task = chain.task;
    config.projectDir = chain.projectDir || config.projectDir;
    config.maxTurns = chain.config.maxTurns;
    config.maxContinuations = chain.config.maxContinuations;
    config.maxBudgetUsd = chain.config.maxBudgetUsd;
    config.model = chain.config.model;

    // Re-resolve model name if it's a short name
    const MODEL_MAP = {
      haiku: 'claude-haiku-4-5-20251001',
      sonnet: 'claude-sonnet-4-5-20250929',
      opus: 'claude-opus-4-6',
    };
    config.model = MODEL_MAP[config.model] || config.model;

    logConfig(config);
    if (config.dryRun) { log('DRY RUN — exiting'); process.exit(0); }

    const completedChain = await runChain(config, registry, chain);
    await finishChain(completedChain, config, registry);
    return;
  }

  // New chain
  logConfig(config);
  if (config.dryRun) { log('DRY RUN — exiting'); process.exit(0); }

  // Warn about existing incomplete chains
  const incomplete = findIncompleteChains(registry);
  if (incomplete.length > 0) {
    log(`NOTE: ${incomplete.length} incomplete chain(s) exist. Use --resume to continue the latest.`);
  }

  const completedChain = await runChain(config, registry, null);
  await finishChain(completedChain, config, registry);
}

function logConfig(config) {
  log(`Task: ${config.task}`);
  log(`Model: ${config.modelShort || config.model}`);
  log(`Max turns per session: ${config.maxTurns}`);
  log(`Max continuations: ${config.maxContinuations}`);
  log(`Max budget: $${config.maxBudgetUsd.toFixed(2)}`);
  log(`Permission mode: ${config.permissionMode}`);
  log(`Project dir: ${config.projectDir}`);
  if (config.autoPush) log('Auto-push: ENABLED');
  if (config.notifyWebhook) log(`Webhook: ${config.notifyWebhook}`);
}

async function finishChain(chain, config, registry) {
  logSection('Chain Summary');
  log(`Chain ID: ${chain.id.slice(0, 8)}`);
  log(`Outcome: ${chain.status}`);
  log(`Sessions: ${chain.sessions.length}`);
  log(`Total turns: ${chain.totalTurns}`);
  log(`Total cost: $${chain.totalCostUsd.toFixed(4)}`);
  log(`Total duration: ${(chain.totalDurationMs / 1000).toFixed(1)}s`);

  // Write chain log (backward-compatible with M1's last-chain.json)
  const logPath = join(OPERATOR_DIR, 'last-chain.json');
  writeFileSync(logPath, JSON.stringify(getChainSummary(chain), null, 2));
  log(`Chain log saved to ${logPath}`);

  // Auto-push (M2e)
  if (config.autoPush && (chain.status === 'complete' || chain.status === 'assumed-complete' || chain.status === 'max-continuations')) {
    await autoPush(config.projectDir);
  }

  // Webhook notification (M2e)
  if (config.notifyWebhook) {
    await sendWebhook(config.notifyWebhook, {
      event: 'chain_complete',
      chain: getChainSummary(chain),
      timestamp: new Date().toISOString(),
    });
  }
}

// ── Signal Handling ──────────────────────────────────────────

let _abortRequested = false;
export function isAbortRequested() { return _abortRequested; }

function setupSignalHandlers() {
  const handler = (signal) => {
    if (_abortRequested) {
      log(`Second ${signal} received — force exit`);
      process.exit(1);
    }
    _abortRequested = true;
    log(`${signal} received — will abort after current session completes`);
  };
  process.on('SIGINT', handler);
  process.on('SIGTERM', handler);
}

main().catch(err => {
  console.error(`\nOperator fatal error: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});

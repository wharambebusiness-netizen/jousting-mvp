// ============================================================
// SDK Adapter Layer for Multi-Agent Orchestrator (v23 / M3)
// ============================================================
// Wraps @anthropic-ai/claude-agent-sdk query() to provide a clean
// interface that replaces raw CLI process spawning.
//
// M3 additions:
//   - runAgentWithContinuation(): auto-continue agents that fill context
//   - parseChainHandoff(): extract handoff sections from agent output
//   - PreCompact hook support for context-full detection
//   - Cost guardrails per continuation chain
//
// When the SDK is not installed, gracefully falls back to CLI mode.
// The orchestrator calls getRunAgent() to get whichever runner is available.
//
// Usage:
//   import { getRunAgent, SDK_MODE, isSDKAvailable } from './sdk-adapter.mjs';
//   const runner = getRunAgent(cliRunAgent);
//   const result = await runner(agent, prompt, options);
// ============================================================

/** @type {boolean} Whether the SDK is available in this environment */
export let SDK_MODE = false;

/** @type {Function|null} Cached reference to SDK query() */
let _sdkQuery = null;

/**
 * Check if @anthropic-ai/claude-agent-sdk is installed and importable.
 * Caches the result after first successful check.
 * @returns {Promise<boolean>}
 */
export async function isSDKAvailable() {
  if (_sdkQuery !== null) return true;
  try {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    if (typeof sdk.query === 'function') {
      _sdkQuery = sdk.query;
      SDK_MODE = true;
      return true;
    }
    console.log('[sdk-adapter] SDK module found but query() export missing — falling back to CLI');
    return false;
  } catch (_) {
    return false;
  }
}

// ── Handoff Schema ──────────────────────────────────────────

/**
 * Returns a JSON schema for structured agent handoff metadata.
 * Used with SDK outputFormat for validated structured responses.
 * @returns {Object} JSON Schema object
 */
export function createHandoffSchema() {
  return {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['in-progress', 'complete', 'all-done'],
        description: 'Agent work status',
      },
      filesModified: {
        type: 'array',
        items: { type: 'string' },
        description: 'Relative paths of all files modified',
      },
      testsPassing: {
        type: 'boolean',
        description: 'Whether all tests passed before handoff',
      },
      completedTasks: {
        type: 'array',
        items: { type: 'string' },
        description: 'IDs of completed backlog tasks (e.g. BL-042)',
      },
      notesForOthers: {
        type: 'string',
        description: 'Free-form notes for other agents',
      },
      summary: {
        type: 'string',
        description: 'One-paragraph summary of work done this round',
      },
      issuesEncountered: {
        type: 'array',
        items: { type: 'string' },
        description: 'Problems encountered during the run',
      },
    },
    required: ['status', 'filesModified', 'testsPassing', 'summary'],
    additionalProperties: false,
  };
}

// ── Agent Option Mapping ────────────────────────────────────

/** Map of model short names to SDK model identifiers */
const MODEL_MAP = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-5-20250929',
  opus: 'claude-opus-4-6',
};

/**
 * Convert orchestrator agent config + run options into SDK query() options.
 * Pure function — no side effects, fully unit-testable.
 *
 * @param {Object} agent - Agent config from mission
 * @param {Object} [options] - Per-run options
 * @returns {Object} Options object suitable for SDK query()
 */
export function createAgentOptions(agent, options = {}) {
  const sdkOptions = {};

  // Model mapping
  const modelKey = agent.model || 'sonnet';
  sdkOptions.model = MODEL_MAP[modelKey] || modelKey;

  // Tool permissions
  const toolStr = options.allowedTools || agent.allowedTools || 'Edit,Read,Write,Glob,Grep,Bash';
  sdkOptions.allowedTools = toolStr.split(',').map(t => t.trim()).filter(Boolean);

  // Session management: resume takes priority over fresh session
  if (options.resumeSessionId) {
    sdkOptions.resume = options.resumeSessionId;
  } else if (options.sessionId) {
    sdkOptions.sessionId = options.sessionId;
  }

  // Budget cap
  if (agent.maxBudgetUsd) {
    sdkOptions.maxBudgetUsd = agent.maxBudgetUsd;
  }

  // Turn limit
  if (options.maxTurns) {
    sdkOptions.maxTurns = options.maxTurns;
  }

  // Working directory
  if (options.cwd) {
    sdkOptions.cwd = options.cwd;
  }

  // Structured output format
  if (options.outputSchema) {
    sdkOptions.outputFormat = {
      type: 'json_schema',
      schema: options.outputSchema,
    };
  }

  // M3: Permission mode — orchestrator agents run with full permissions (equiv to CLI -p flag)
  if (options.permissionMode) {
    sdkOptions.permissionMode = options.permissionMode;
    if (options.permissionMode === 'bypassPermissions') {
      sdkOptions.allowDangerouslySkipPermissions = true;
    }
  }

  // M3: Environment variables — sanitized env for agent processes
  if (options.env) {
    sdkOptions.env = options.env;
  }

  return sdkOptions;
}

// ── Cost Extraction ─────────────────────────────────────────

/**
 * Extract token usage and cost data from SDK message stream.
 * @param {Array} messages - Array of SDK message objects
 * @returns {{ inputTokens: number, outputTokens: number, totalCost: number }}
 */
export function extractCostFromMessages(messages) {
  let inputTokens = 0;
  let outputTokens = 0;

  for (const msg of messages) {
    const usage = msg.usage || msg.message?.usage || null;
    if (usage) {
      inputTokens += usage.input_tokens || 0;
      outputTokens += usage.output_tokens || 0;
    }
    // SDK result messages may carry cost directly
    if (msg.cost_usd != null) {
      return {
        inputTokens,
        outputTokens,
        totalCost: msg.cost_usd,
      };
    }
  }

  // Approximate cost (Sonnet pricing as baseline)
  const inputCostPer1K = 0.003;
  const outputCostPer1K = 0.015;
  const totalCost = (inputTokens / 1000) * inputCostPer1K + (outputTokens / 1000) * outputCostPer1K;

  return {
    inputTokens,
    outputTokens,
    totalCost: Math.round(totalCost * 10000) / 10000,
  };
}

// ── Main SDK Runner ─────────────────────────────────────────

/**
 * Run an agent via the Claude Agent SDK, replacing CLI spawn-based execution.
 *
 * @param {Object} agent - Agent config (id, model, maxBudgetUsd, allowedTools, etc.)
 * @param {string} prompt - The full prompt to send to the agent
 * @param {Object} [options] - Execution options
 * @returns {Promise<{ output: string, structuredOutput: Object|null, cost: Object, sessionId: string|null, elapsedMs: number, success: boolean }>}
 */
export async function runAgentViaSDK(agent, prompt, options = {}) {
  if (!_sdkQuery) {
    throw new Error('[sdk-adapter] SDK not initialized — call isSDKAvailable() first');
  }

  const startTime = Date.now();
  const timeoutMs = options.timeoutMs || 20 * 60 * 1000;
  const sdkOptions = createAgentOptions(agent, options);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const collectedMessages = [];
  let outputText = '';
  let structuredOutput = null;
  let sessionId = options.sessionId || null;
  let success = false;

  try {
    const queryOpts = { prompt, options: { ...sdkOptions, abortSignal: controller.signal } };
    for await (const message of _sdkQuery(queryOpts)) {
      collectedMessages.push(message);

      // Collect assistant text
      if (message.type === 'assistant' || message.role === 'assistant') {
        const content = message.content || message.text || '';
        if (typeof content === 'string') {
          outputText += content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') outputText += block.text;
          }
        }
      }

      // Capture result message data
      if (message.type === 'result') {
        if (message.structured_output) structuredOutput = message.structured_output;
        if (message.session_id) sessionId = message.session_id;
        if (message.text) outputText += message.text;
      }

      // Capture session ID from any message
      if (message.session_id) sessionId = message.session_id;
    }

    success = true;
  } catch (err) {
    if (err.name === 'AbortError' || controller.signal.aborted) {
      outputText += `\n[TIMEOUT after ${(timeoutMs / 60000).toFixed(1)} minutes]`;
    } else {
      outputText += `\n[SDK ERROR: ${err.message}]`;
    }
  } finally {
    clearTimeout(timer);
  }

  const elapsedMs = Date.now() - startTime;
  const cost = extractCostFromMessages(collectedMessages);

  return { output: outputText, structuredOutput, cost, sessionId, elapsedMs, success };
}

// ── Chain Handoff Parsing (M3) ───────────────────────────────

/**
 * Parse a continuation handoff section from agent output text.
 * Looks for "## HANDOFF" or "## Handoff" section marker.
 * Reuses the same protocol as operator/operator.mjs parseHandoff().
 *
 * @param {string} outputText - Raw agent output text
 * @returns {{ complete: boolean, summary: string, remaining: string, context: string, raw: string }|null}
 */
export function parseChainHandoff(outputText) {
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

// ── Continuation Prompt Builder (M3) ─────────────────────────

/**
 * Build a continuation prompt from a previous session's handoff.
 * @param {Object|null} handoff - Parsed handoff from parseChainHandoff()
 * @param {string} previousOutput - Raw output text from previous session
 * @param {string} originalPrompt - The original task prompt
 * @param {number} continuationIndex - Which continuation this is (1-based)
 * @returns {string}
 */
function buildContinuationPrompt(handoff, previousOutput, originalPrompt, continuationIndex) {
  const parts = [
    `--- CONTINUATION SESSION ${continuationIndex + 1} ---`,
    `Your previous session ran out of context/turns. Continue the work.`,
    ``,
  ];

  if (handoff) {
    parts.push(
      `--- PREVIOUS SESSION HANDOFF ---`,
      handoff.raw,
      `--- END HANDOFF ---`,
      ``,
    );
    if (handoff.remaining) {
      parts.push(`Focus on the remaining work described above.`);
    }
  } else {
    // No handoff — use output tail as context
    const tail = previousOutput.slice(-3000);
    parts.push(
      `--- PREVIOUS SESSION OUTPUT (tail) ---`,
      tail,
      `--- END OUTPUT ---`,
      ``,
      `No handoff section was found. Review the output above and continue the task.`,
    );
  }

  // Include original task for context when no handoff is available
  if (originalPrompt && !handoff) {
    const truncatedPrompt = originalPrompt.length > 2000 ? originalPrompt.slice(0, 2000) + '\n...(truncated)' : originalPrompt;
    parts.push(
      ``,
      `--- ORIGINAL TASK (for reference) ---`,
      truncatedPrompt,
      `--- END ORIGINAL TASK ---`,
    );
  }

  parts.push(
    ``,
    `Do NOT redo work that was already completed.`,
    `When done, write your handoff file as usual.`,
  );

  return parts.join('\n');
}

// ── Agent Continuation Runner (M3) ──────────────────────────

/** @type {number} Hard cap on continuation count per agent */
const MAX_CONTINUATIONS_CAP = 3;

/** @type {number} Default cost cap per agent continuation chain in USD */
const DEFAULT_CHAIN_COST_CAP = 2.0;

/**
 * Run an agent via SDK with automatic continuation when context fills up.
 * Wraps runAgentViaSDK() in a loop. When PreCompact fires or agent hits
 * max turns without completing, spawns a fresh session with handoff context.
 *
 * The continuation is transparent to the orchestrator — the combined result
 * looks like a single (longer) agent run.
 *
 * @param {Object} agent - Agent config (id, model, maxBudgetUsd, allowedTools, etc.)
 * @param {string} prompt - The full prompt to send to the agent
 * @param {Object} [options] - Execution options (same as runAgentViaSDK, plus:)
 * @param {number} [options.maxContinuations=2] - Max continuation sessions (capped at 3)
 * @param {number} [options.maxChainCostUsd=2.0] - Max total cost across continuations
 * @param {Function} [options.onContinuation] - Callback: (index, handoff, cost) => void
 * @param {Function} [options.logFn] - Logging function
 * @returns {Promise<{ output: string, structuredOutput: Object|null, cost: Object, sessionId: string|null, elapsedMs: number, success: boolean, continuations: number, preCompacted: boolean, hitMaxTurns: boolean }>}
 */
export async function runAgentWithContinuation(agent, prompt, options = {}) {
  const maxCont = Math.min(options.maxContinuations ?? 2, MAX_CONTINUATIONS_CAP);
  const maxCost = options.maxChainCostUsd ?? DEFAULT_CHAIN_COST_CAP;
  const logFn = options.logFn || (() => {});

  let currentPrompt = prompt;
  let combinedOutput = '';
  let totalCost = { inputTokens: 0, outputTokens: 0, totalCost: 0 };
  let totalElapsedMs = 0;
  let lastSessionId = null;
  let lastStructuredOutput = null;
  let continuations = 0;
  let chainPreCompacted = false;
  let chainHitMaxTurns = false;
  let chainSuccess = false;

  for (let i = 0; i <= maxCont; i++) {
    // PreCompact flag for this specific session
    let sessionPreCompacted = false;

    // Build session options — continuation sessions are always fresh (no resume)
    const sessionOptions = { ...options };
    delete sessionOptions.maxContinuations;
    delete sessionOptions.maxChainCostUsd;
    delete sessionOptions.onContinuation;
    delete sessionOptions.logFn;

    if (i > 0) {
      // Continuation sessions don't resume — they're fresh with handoff context
      delete sessionOptions.resumeSessionId;
      delete sessionOptions.sessionId;
    }

    // Add PreCompact hook for context-full detection
    sessionOptions.hooks = {
      PreCompact: [{
        hooks: [async () => {
          sessionPreCompacted = true;
          chainPreCompacted = true;
          logFn(`  [continuation] PreCompact fired on session ${i + 1} — will continue`);
          return {
            systemMessage: 'Your context window is nearly full. Wrap up your current work and write your HANDOFF section now. Format: ## HANDOFF (or ## HANDOFF: COMPLETE if done). Include **Accomplished**, **Remaining**, and **Context** sections.',
          };
        }],
      }],
    };

    // Run the session
    const result = await runAgentViaSDKWithHooks(agent, currentPrompt, sessionOptions);

    // Accumulate results
    combinedOutput += result.output;
    totalCost.inputTokens += result.cost.inputTokens;
    totalCost.outputTokens += result.cost.outputTokens;
    totalCost.totalCost += result.cost.totalCost;
    totalElapsedMs += result.elapsedMs;
    lastSessionId = result.sessionId || lastSessionId;
    if (result.structuredOutput) lastStructuredOutput = result.structuredOutput;
    if (result.hitMaxTurns) chainHitMaxTurns = true;
    if (result.success) chainSuccess = true;

    // Parse handoff from this session's output
    const handoff = parseChainHandoff(result.output);

    // ── Continuation decision ──
    // Never continue if task is marked complete
    if (handoff?.complete) {
      logFn(`  [continuation] Session ${i + 1}: task complete`);
      break;
    }

    // Check if we should continue
    const shouldContinue =
      (sessionPreCompacted || (result.hitMaxTurns && !handoff?.complete)) &&  // context full or ran out of turns
      i < maxCont &&                                                          // haven't hit continuation cap
      totalCost.totalCost < maxCost &&                                        // haven't exceeded cost cap
      result.success;                                                          // session didn't error out

    if (!shouldContinue) {
      if (i > 0) logFn(`  [continuation] Session ${i + 1}: stopping (preCompact=${sessionPreCompacted}, maxTurns=${result.hitMaxTurns}, cost=$${totalCost.totalCost.toFixed(4)}, maxCost=$${maxCost})`);
      break;
    }

    // ── Continue ──
    continuations++;
    logFn(`  [continuation] Session ${i + 1} → ${i + 2}: continuing (cost so far: $${totalCost.totalCost.toFixed(4)})`);
    if (options.onContinuation) {
      options.onContinuation(continuations, handoff, totalCost);
    }

    // Build continuation prompt
    currentPrompt = buildContinuationPrompt(handoff, result.output, prompt, continuations);
  }

  return {
    output: combinedOutput,
    structuredOutput: lastStructuredOutput,
    cost: totalCost,
    sessionId: lastSessionId,
    elapsedMs: totalElapsedMs,
    success: chainSuccess,
    continuations,
    preCompacted: chainPreCompacted,
    hitMaxTurns: chainHitMaxTurns,
  };
}

// ── SDK Runner with Hooks (M3) ──────────────────────────────

/**
 * Enhanced version of runAgentViaSDK that supports hooks, env, and permission mode.
 * Used internally by runAgentWithContinuation().
 *
 * @param {Object} agent - Agent config
 * @param {string} prompt - The prompt
 * @param {Object} [options] - Execution options including hooks, env, permissionMode
 * @returns {Promise<{ output: string, structuredOutput: Object|null, cost: Object, sessionId: string|null, elapsedMs: number, success: boolean, hitMaxTurns: boolean }>}
 */
async function runAgentViaSDKWithHooks(agent, prompt, options = {}) {
  if (!_sdkQuery) {
    throw new Error('[sdk-adapter] SDK not initialized — call isSDKAvailable() first');
  }

  const startTime = Date.now();
  const timeoutMs = options.timeoutMs || 20 * 60 * 1000;
  const sdkOptions = createAgentOptions(agent, options);

  // M3: Hooks support (PreCompact for continuation detection)
  if (options.hooks) {
    sdkOptions.hooks = options.hooks;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const collectedMessages = [];
  let outputText = '';
  let structuredOutput = null;
  let sessionId = options.sessionId || null;
  let success = false;
  let hitMaxTurns = false;

  // Strip CLAUDECODE env var to allow nested SDK sessions (same as operator)
  const cleanEnv = { ...(options.env || process.env) };
  delete cleanEnv.CLAUDECODE;

  try {
    const queryOpts = {
      prompt,
      options: { ...sdkOptions, abortSignal: controller.signal, env: cleanEnv },
    };
    for await (const message of _sdkQuery(queryOpts)) {
      collectedMessages.push(message);

      // Collect assistant text
      if (message.type === 'assistant' || message.role === 'assistant') {
        const content = message.content || message.text || '';
        if (typeof content === 'string') {
          outputText += content;
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') outputText += block.text;
          }
        }
      }

      // Capture result message data
      if (message.type === 'result') {
        if (message.structured_output) structuredOutput = message.structured_output;
        if (message.session_id) sessionId = message.session_id;
        if (message.text) outputText += message.text;
        if (message.subtype === 'error_max_turns') hitMaxTurns = true;
      }

      // Capture session ID from any message
      if (message.session_id) sessionId = message.session_id;
    }

    success = true;
  } catch (err) {
    if (err.name === 'AbortError' || controller.signal.aborted) {
      outputText += `\n[TIMEOUT after ${(timeoutMs / 60000).toFixed(1)} minutes]`;
    } else {
      outputText += `\n[SDK ERROR: ${err.message}]`;
    }
  } finally {
    clearTimeout(timer);
  }

  const elapsedMs = Date.now() - startTime;
  const cost = extractCostFromMessages(collectedMessages);

  return { output: outputText, structuredOutput, cost, sessionId, elapsedMs, success, hitMaxTurns };
}

// ── Feature Flag & Runner Selection ─────────────────────────

/**
 * Returns the appropriate agent runner based on SDK availability.
 * @param {Function} cliRunner - The CLI-based runAgent function (fallback)
 * @returns {Function} Either runAgentViaSDK or the CLI fallback
 */
export function getRunAgent(cliRunner) {
  if (SDK_MODE && _sdkQuery) {
    console.log('[sdk-adapter] Using Agent SDK runner');
    return runAgentViaSDK;
  }
  console.log('[sdk-adapter] SDK not available — using CLI runner');
  return cliRunner;
}

// ── Test Exports ────────────────────────────────────────────

export const __test__ = {
  createHandoffSchema,
  createAgentOptions,
  extractCostFromMessages,
  parseChainHandoff,
  buildContinuationPrompt,
  MODEL_MAP,
  MAX_CONTINUATIONS_CAP,
  DEFAULT_CHAIN_COST_CAP,
};

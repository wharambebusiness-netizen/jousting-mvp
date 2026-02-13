// ============================================================
// SDK Adapter Layer for Multi-Agent Orchestrator (v22)
// ============================================================
// Wraps @anthropic-ai/claude-agent-sdk query() to provide a clean
// interface that replaces raw CLI process spawning.
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
  MODEL_MAP,
};

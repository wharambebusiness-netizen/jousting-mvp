// ============================================================
// Cost Tracking Module (extracted from orchestrator.mjs in S65)
// ============================================================
// Pure functions for parsing and accumulating API costs from agent runs.

// Approximate pricing per 1M tokens (USD)
export const MODEL_PRICING = {
  haiku:   { input: 0.25,  output: 1.25 },
  sonnet:  { input: 3.00,  output: 15.00 },
  opus:    { input: 15.00, output: 75.00 },
  default: { input: 3.00,  output: 15.00 },  // assume sonnet if unknown
};

/**
 * Parse Claude CLI stderr output for cost/token information.
 * Claude Code CLI may output lines like:
 *   "Total cost: $X.XX"
 *   "Total tokens: input=N, output=N"
 *   or token/cost info in other formats
 * Returns { cost, inputTokens, outputTokens } with nulls for unparsed fields.
 */
export function parseCostFromStderr(stderr) {
  const result = { cost: null, inputTokens: null, outputTokens: null };
  if (!stderr) return result;

  // Try to match "Total cost: $X.XX" or "cost: $X.XX"
  const costMatch = stderr.match(/(?:total\s+)?cost:\s*\$?([\d.]+)/i);
  if (costMatch) result.cost = parseFloat(costMatch[1]);

  // Try to match "Total tokens: input=N, output=N"
  const tokensMatch = stderr.match(/tokens?:?\s*input\s*=?\s*([\d,]+)\s*,?\s*output\s*=?\s*([\d,]+)/i);
  if (tokensMatch) {
    result.inputTokens = parseInt(tokensMatch[1].replace(/,/g, ''));
    result.outputTokens = parseInt(tokensMatch[2].replace(/,/g, ''));
  }

  // Alternative: match individual token lines
  if (result.inputTokens === null) {
    const inputMatch = stderr.match(/input[\s_]tokens?:?\s*([\d,]+)/i);
    if (inputMatch) result.inputTokens = parseInt(inputMatch[1].replace(/,/g, ''));
  }
  if (result.outputTokens === null) {
    const outputMatch = stderr.match(/output[\s_]tokens?:?\s*([\d,]+)/i);
    if (outputMatch) result.outputTokens = parseInt(outputMatch[1].replace(/,/g, ''));
  }

  return result;
}

/**
 * Estimate cost from token counts using model pricing.
 * Returns estimated USD cost.
 */
export function estimateCostFromTokens(inputTokens, outputTokens, model) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Initialize or return existing cost log entry for an agent.
 */
export function ensureCostLogEntry(costLog, agentId) {
  if (!costLog[agentId]) {
    costLog[agentId] = {
      totalCost: 0,
      inputTokens: 0,
      outputTokens: 0,
      rounds: 0,
      escalations: 0,
    };
  }
  return costLog[agentId];
}

/**
 * Accumulate cost data from an agent run result into the costLog.
 */
export function accumulateAgentCost(costLog, result, agents) {
  const agent = agents.find(a => a.id === result.agentId);
  const entry = ensureCostLogEntry(costLog, result.agentId);
  entry.rounds++;

  const parsed = parseCostFromStderr(result.stderr);

  if (parsed.cost !== null) {
    // Direct cost from CLI output
    entry.totalCost += parsed.cost;
  }

  if (parsed.inputTokens !== null) {
    entry.inputTokens += parsed.inputTokens;
  }
  if (parsed.outputTokens !== null) {
    entry.outputTokens += parsed.outputTokens;
  }

  // If we got tokens but no direct cost, estimate from pricing
  if (parsed.cost === null && parsed.inputTokens !== null && parsed.outputTokens !== null) {
    const model = agent?.model || 'default';
    entry.totalCost += estimateCostFromTokens(parsed.inputTokens, parsed.outputTokens, model);
  }
}

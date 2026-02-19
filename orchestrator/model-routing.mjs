// ============================================================
// Role-Based Model Routing
// ============================================================
// Assigns model tiers to agent roles for cost-efficient execution.
// Coordination agents get cheap models, code agents get balanced,
// critical-path agents get the best — capped by user's setting.
// ============================================================

export const MODEL_TIERS = { haiku: 1, sonnet: 2, opus: 3 };

export const ROLE_MODEL_MAP = {
  // Coordination — cheap, just routing/reviewing
  'producer':            'haiku',
  'tech-lead':           'haiku',
  'self-reviewer':       'haiku',
  'architect':           'haiku',
  'docs-writer':         'haiku',
  'dependency-manager':  'haiku',

  // Standard code work — balanced speed/quality
  'ui-dev':              'sonnet',
  'css-artist':          'sonnet',
  'engine-dev':          'sonnet',
  'qa-engineer':         'sonnet',
  'test-generator':      'sonnet',
  'full-stack-dev':      'sonnet',
  'backend-dev':         'sonnet',
  'database-dev':        'sonnet',
  'integration-tester':  'sonnet',
  'test-writer':         'sonnet',

  // Critical path — needs deep reasoning
  'debugger':            'opus',
  'refactorer':          'opus',
  'security-auditor':    'opus',
  'performance-analyst': 'opus',
};

/**
 * Resolve the model for an agent based on its role and the user's model ceiling.
 * @param {string} role - Agent role name
 * @param {string} userModel - User's configured model (ceiling)
 * @returns {string} Resolved model name (haiku, sonnet, or opus)
 */
export function resolveAgentModel(role, userModel) {
  const effectiveUserModel = MODEL_TIERS[userModel] ? userModel : 'sonnet';
  const roleDefault = ROLE_MODEL_MAP[role] || 'sonnet';
  const roleTier = MODEL_TIERS[roleDefault] || 2;
  const userTier = MODEL_TIERS[effectiveUserModel];
  // User's model is the ceiling — never exceed it
  if (roleTier <= userTier) return roleDefault;
  return effectiveUserModel;
}

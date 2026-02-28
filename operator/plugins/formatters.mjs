// ============================================================
// Webhook Message Formatters (Phase 63)
// ============================================================
// Transforms raw EventBus event payloads into service-specific
// message formats for Slack, Discord, and generic HTTP targets.
//
// Each formatter receives { event, data, timestamp, webhookId }
// and returns { headers, body } where body is the serialized
// payload string and headers is additional HTTP headers to set.
//
// Factory: createFormatterRegistry() returns registry methods.
// ============================================================

// ── Event Display Names ─────────────────────────────────────

const EVENT_LABELS = {
  'chain:created': 'Chain Created',
  'chain:completed': 'Chain Completed',
  'chain:failed': 'Chain Failed',
  'chain:aborted': 'Chain Aborted',
  'coord:task-created': 'Task Created',
  'coord:task-completed': 'Task Completed',
  'coord:task-failed': 'Task Failed',
  'coord:assigned': 'Task Assigned',
  'health:degraded': 'Health Degraded',
  'health:unhealthy': 'Health Unhealthy',
  'cost:budget-warning': 'Budget Warning',
  'cost:budget-exceeded': 'Budget Exceeded',
  'webhook:test': 'Test Delivery',
};

function eventLabel(event) {
  return EVENT_LABELS[event] || event;
}

// ── Severity from Event ─────────────────────────────────────

function eventSeverity(event) {
  if (event.includes('failed') || event.includes('unhealthy') || event.includes('exceeded') || event.includes('aborted')) return 'error';
  if (event.includes('degraded') || event.includes('warning')) return 'warning';
  if (event.includes('completed') || event.includes('created')) return 'success';
  return 'info';
}

// ── Slack Color Map ─────────────────────────────────────────

const SLACK_COLORS = {
  success: '#10b981',
  warning: '#f59e0b',
  error:   '#ef4444',
  info:    '#6366f1',
};

// ── Discord Color Map (decimal) ─────────────────────────────

const DISCORD_COLORS = {
  success: 0x10b981,
  warning: 0xf59e0b,
  error:   0xef4444,
  info:    0x6366f1,
};

// ── Generic Formatter ───────────────────────────────────────

/**
 * Default formatter — passes through raw JSON payload.
 */
function genericFormatter(payload) {
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

// ── Slack Formatter ─────────────────────────────────────────

/**
 * Formats event into Slack Block Kit message.
 * @param {object} payload - { event, data, timestamp, webhookId }
 * @returns {{ headers: object, body: string }}
 */
function slackFormatter(payload) {
  const { event, data, timestamp } = payload;
  const severity = eventSeverity(event);
  const color = SLACK_COLORS[severity];
  const label = eventLabel(event);

  // Build fields from data
  const fields = [];
  if (data) {
    const entries = Object.entries(data);
    for (const [key, value] of entries.slice(0, 8)) {
      if (value === null || value === undefined) continue;
      const display = typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (display.length > 120) continue;
      fields.push({
        type: 'mrkdwn',
        text: `*${key}*\n${display}`,
      });
    }
  }

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${label}*\n\`${event}\``,
      },
    },
  ];

  if (fields.length > 0) {
    blocks.push({
      type: 'section',
      fields: fields.slice(0, 10),
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      { type: 'mrkdwn', text: `Operator · ${timestamp || new Date().toISOString()}` },
    ],
  });

  const slackPayload = {
    attachments: [
      {
        color,
        blocks,
      },
    ],
  };

  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(slackPayload),
  };
}

// ── Discord Formatter ───────────────────────────────────────

/**
 * Formats event into Discord embed message.
 * @param {object} payload - { event, data, timestamp, webhookId }
 * @returns {{ headers: object, body: string }}
 */
function discordFormatter(payload) {
  const { event, data, timestamp } = payload;
  const severity = eventSeverity(event);
  const color = DISCORD_COLORS[severity];
  const label = eventLabel(event);

  // Build fields from data
  const embedFields = [];
  if (data) {
    const entries = Object.entries(data);
    for (const [key, value] of entries.slice(0, 8)) {
      if (value === null || value === undefined) continue;
      const display = typeof value === 'object' ? JSON.stringify(value) : String(value);
      if (display.length > 120) continue;
      embedFields.push({
        name: key,
        value: display,
        inline: display.length < 40,
      });
    }
  }

  const embed = {
    title: label,
    description: `\`${event}\``,
    color,
    fields: embedFields,
    footer: { text: 'Operator' },
    timestamp: timestamp || new Date().toISOString(),
  };

  const discordPayload = {
    embeds: [embed],
  };

  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(discordPayload),
  };
}

// ── Formatter Registry ──────────────────────────────────────

const BUILT_IN = {
  generic: genericFormatter,
  slack: slackFormatter,
  discord: discordFormatter,
};

/**
 * Create a formatter registry with built-in and custom formatters.
 * @returns {object} Registry methods
 */
export function createFormatterRegistry() {
  const custom = new Map();

  /**
   * Register a custom formatter.
   * @param {string} name - Format name
   * @param {Function} fn - Formatter function(payload) => { headers, body }
   */
  function register(name, fn) {
    if (typeof fn !== 'function') {
      throw new Error('Formatter must be a function');
    }
    if (BUILT_IN[name]) {
      throw new Error(`Cannot override built-in formatter: ${name}`);
    }
    custom.set(name, fn);
  }

  /**
   * Get a formatter by name.
   * @param {string} name - Format name (default: 'generic')
   * @returns {Function} Formatter function
   */
  function get(name) {
    if (!name || name === 'generic') return BUILT_IN.generic;
    return BUILT_IN[name] || custom.get(name) || BUILT_IN.generic;
  }

  /**
   * List all available format names.
   * @returns {string[]}
   */
  function list() {
    return [...Object.keys(BUILT_IN), ...custom.keys()];
  }

  /**
   * Format a payload using the named formatter.
   * @param {string} formatName - Format name
   * @param {object} payload - { event, data, timestamp, webhookId }
   * @returns {{ headers: object, body: string }}
   */
  function format(formatName, payload) {
    const fn = get(formatName);
    return fn(payload);
  }

  return { register, get, list, format };
}

// Export individual formatters for testing
export { genericFormatter, slackFormatter, discordFormatter, eventLabel, eventSeverity };

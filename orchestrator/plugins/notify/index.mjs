// ============================================================
// Notify Plugin (v26/M5)
// Sends webhook notifications on post-round and orchestration-complete.
// Webhook URL via env var NOTIFY_WEBHOOK_URL.
// ============================================================

export async function activate(context) {
  const { pluginConfig, log } = context;
  const webhookUrl = process.env.NOTIFY_WEBHOOK_URL;

  if (!webhookUrl) {
    log('[notify] No NOTIFY_WEBHOOK_URL set — notifications disabled');
    return {};
  }

  const maxRetries = pluginConfig.maxRetries ?? 1;
  const retryDelayMs = pluginConfig.retryDelayMs ?? 5000;

  async function sendNotification(type, data) {
    const payload = { type, timestamp: new Date().toISOString(), ...data };

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (response.ok) {
          log(`[notify] Sent ${type} notification`);
          return;
        }
        log(`[notify] HTTP ${response.status} on attempt ${attempt + 1}`);
      } catch (err) {
        log(`[notify] Error on attempt ${attempt + 1}: ${err.message}`);
      }

      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, retryDelayMs));
      }
    }

    log(`[notify] Failed to send ${type} after ${maxRetries + 1} attempts`);
  }

  return {
    'post-round': async (data) => {
      await sendNotification('round-complete', data);
    },

    'orchestration-complete': async (data) => {
      await sendNotification('orchestration-complete', data);
    },
  };
}

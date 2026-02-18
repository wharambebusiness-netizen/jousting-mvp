// ============================================================
// View Routes (M5)
// ============================================================
// Serves HTML fragments for HTMX partial requests.
// Fragment endpoints at /views/* return pure HTML strings.
// ============================================================

import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import {
  loadRegistry, findChainById, getChainSummary,
} from '../registry.mjs';
import { renderChainTable } from '../views/chain-row.mjs';
import { renderSessionCard, renderTimeline, renderCostBreakdown } from '../views/session-card.mjs';
import { renderAgentGrid } from '../views/agent-card.mjs';
import { escapeHtml, formatCost, formatDuration, relativeTime, statusLabel } from '../views/helpers.mjs';

/**
 * Create view routes for HTMX fragments.
 * @param {object} ctx
 * @param {string}   ctx.operatorDir
 * @param {EventBus} ctx.events
 * @param {Function} [ctx.getOrchStatus] - Returns orchestrator status object
 */
export function createViewRoutes(ctx) {
  const router = Router();

  // ── Chain List Fragment ──────────────────────────────────
  router.get('/chain-list', (_req, res) => {
    try {
      const registry = loadRegistry();
      const chains = [...registry.chains]
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 50)
        .map(getChainSummary);
      res.type('text/html').send(renderChainTable(chains));
    } catch (err) {
      res.type('text/html').send(`<tr><td colspan="7">Error: ${escapeHtml(err.message)}</td></tr>`);
    }
  });

  // ── Cost Summary Fragment ────────────────────────────────
  router.get('/cost-summary', (_req, res) => {
    try {
      const registry = loadRegistry();
      const chains = registry.chains;
      const totalCost = chains.reduce((sum, c) => sum + (c.totalCostUsd || 0), 0);
      const totalSessions = chains.reduce((sum, c) => sum + (c.sessions?.length || 0), 0);
      const totalTurns = chains.reduce((sum, c) => sum + (c.totalTurns || 0), 0);
      const running = chains.filter(c => c.status === 'running').length;

      res.type('text/html').send(`
        <div class="stat-card"><strong>${formatCost(totalCost)}</strong><small>Total Cost</small></div>
        <div class="stat-card"><strong>${chains.length}</strong><small>Chains</small></div>
        <div class="stat-card"><strong>${totalSessions}</strong><small>Sessions</small></div>
        <div class="stat-card"><strong>${totalTurns}</strong><small>Turns</small></div>
        <div class="stat-card"><strong>${running}</strong><small>Running</small></div>
      `);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Chain Detail Fragment ────────────────────────────────
  router.get('/chain-detail/:id', (req, res) => {
    try {
      const registry = loadRegistry();
      const chain = findChainById(registry, req.params.id);
      if (!chain) {
        return res.type('text/html').send('<p>Chain not found.</p>');
      }

      const summary = getChainSummary(chain);
      const sessions = chain.sessions || [];
      // Inject chain ID for handoff loading
      const sessionsWithChainId = sessions.map(s => ({ ...s, _chainId: chain.id }));

      const html = `
        <hgroup>
          <h2><span class="dot dot-${chain.status}"></span> ${statusLabel(chain.status)}</h2>
          <p>${escapeHtml(chain.task)}</p>
        </hgroup>

        <div class="chain-meta">
          <span>Model: <strong>${escapeHtml(chain.config?.model || 'sonnet')}</strong></span>
          <span>Sessions: <strong>${sessions.length}</strong></span>
          <span>Cost: <strong>${formatCost(chain.totalCostUsd)}</strong></span>
          <span>Duration: <strong>${formatDuration(chain.totalDurationMs)}</strong></span>
          <span>Started: <strong>${relativeTime(chain.startedAt)}</strong></span>
          ${chain.projectDir ? `<span>Project: <strong>${escapeHtml(chain.projectDir)}</strong></span>` : ''}
        </div>

        ${chain.status === 'running' ? `
          <button class="btn-kill" hx-post="/api/chains/${chain.id}/abort"
            hx-confirm="Abort this chain?" hx-swap="none"
            hx-on::after-request="location.reload()">Abort Chain</button>
        ` : ''}

        <h3>Session Timeline</h3>
        ${renderTimeline(sessions)}

        <h3>Cost Breakdown</h3>
        ${renderCostBreakdown(sessions)}

        <h3>Sessions</h3>
        ${sessionsWithChainId.map(renderSessionCard).join('\n') || '<p class="empty-msg">No sessions recorded.</p>'}
      `;
      res.type('text/html').send(html);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Session Handoff Content (lazy-loaded) ────────────────
  router.get('/session-handoff/:chainId/:idx', (req, res) => {
    try {
      const registry = loadRegistry();
      const chain = findChainById(registry, req.params.chainId);
      if (!chain) return res.type('text/html').send('<p>Chain not found.</p>');

      const idx = parseInt(req.params.idx, 10);
      const session = chain.sessions?.[idx];
      if (!session) return res.type('text/html').send('<p>Session not found.</p>');

      if (session.handoffFile && existsSync(session.handoffFile)) {
        try {
          const content = readFileSync(session.handoffFile, 'utf-8');
          return res.type('text/html').send(`<pre class="handoff-pre">${escapeHtml(content)}</pre>`);
        } catch (_) { /* fall through */ }
      }
      res.type('text/html').send('<p class="empty-msg">No handoff file available.</p>');
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Orchestrator Status Fragment ─────────────────────────
  router.get('/orch-status', (_req, res) => {
    try {
      const status = ctx.getOrchStatus ? ctx.getOrchStatus() : {
        running: false, round: 0, agents: [], mission: null, dryRun: false,
      };

      const agentCards = status.agents && status.agents.length > 0
        ? status.agents.map(a => typeof a === 'string' ? { id: a, status: 'active' } : a)
        : [];

      const html = `
        <hgroup>
          <h2>
            <span class="dot dot-${status.running ? 'running' : 'complete'}"></span>
            Orchestrator ${status.running ? 'Running' : 'Stopped'}
          </h2>
          <p>${status.mission ? `Mission: ${escapeHtml(status.mission)}` : 'No active mission'}
             ${status.dryRun ? ' (dry-run)' : ''}</p>
        </hgroup>

        <div class="chain-meta">
          <span>Round: <strong>${status.round || 0}</strong></span>
          <span>Agents: <strong>${agentCards.length}</strong></span>
          ${status.startedAt ? `<span>Started: <strong>${relativeTime(status.startedAt)}</strong></span>` : ''}
        </div>

        ${status.running ? `
          <button class="btn-kill" hx-post="/api/orchestrator/stop"
            hx-confirm="Stop the orchestrator?" hx-swap="none"
            hx-on::after-request="location.reload()">Stop Orchestrator</button>
        ` : ''}

        <h3>Agents</h3>
        ${renderAgentGrid(agentCards)}
      `;
      res.type('text/html').send(html);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  return router;
}

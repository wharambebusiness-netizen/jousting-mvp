// ============================================================
// View Routes (M5)
// ============================================================
// Serves HTML fragments for HTMX partial requests.
// Fragment endpoints at /views/* return pure HTML strings.
// ============================================================

import { Router } from 'express';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
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
        <div class="metric-card"><div class="metric-card__label">Total Cost</div><div class="metric-card__value">${formatCost(totalCost)}</div></div>
        <div class="metric-card"><div class="metric-card__label">Chains</div><div class="metric-card__value">${chains.length}</div></div>
        <div class="metric-card"><div class="metric-card__label">Sessions</div><div class="metric-card__value">${totalSessions}</div></div>
        <div class="metric-card"><div class="metric-card__label">Turns</div><div class="metric-card__value">${totalTurns}</div></div>
        <div class="metric-card"><div class="metric-card__label">Running</div><div class="metric-card__value">${running}</div></div>
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
          <h2><span class="status-dot status-dot--${chain.status}"></span> ${statusLabel(chain.status)}</h2>
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
          <button class="btn btn--danger" hx-post="/api/chains/${chain.id}/abort"
            hx-confirm="Abort this chain?" hx-swap="none"
            hx-on::after-request="location.reload()">Abort Chain</button>
        ` : ''}
        ${['failed', 'aborted', 'max-continuations'].includes(chain.status) ? `
          <button class="btn btn--ghost" hx-post="/api/chains/${chain.id}/restart"
            hx-swap="none"
            hx-on::after-request="location.reload()">Restart Chain</button>
        ` : ''}

        <h3>Session Timeline</h3>
        ${renderTimeline(sessions)}

        <h3>Cost Breakdown</h3>
        ${renderCostBreakdown(sessions)}

        <h3>Sessions</h3>
        ${sessionsWithChainId.map(renderSessionCard).join('\n') || '<p class="empty-state">No sessions recorded.</p>'}
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
      res.type('text/html').send('<p class="empty-state">No handoff file available.</p>');
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
            <span class="status-dot status-dot--${status.running ? 'running' : 'complete'}"></span>
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
          <button class="btn btn--danger" hx-post="/api/orchestrator/stop"
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

  // ── Git Status Fragment ────────────────────────────────────
  router.get('/git-status', async (_req, res) => {
    try {
      const { execFile } = await import('child_process');
      const run = (cmd, args) => new Promise((resolve) => {
        execFile(cmd, args, { cwd: ctx.projectDir || process.cwd(), timeout: 10000 }, (err, stdout, stderr) => {
          resolve({ stdout: (stdout || '').trim(), stderr: (stderr || '').trim(), code: err ? 1 : 0 });
        });
      });

      const [statusResult, branchResult, logResult] = await Promise.all([
        run('git', ['status', '--porcelain']),
        run('git', ['branch', '--show-current']),
        run('git', ['log', '--oneline', '-5']),
      ]);

      const branch = branchResult.stdout || 'unknown';
      const files = statusResult.stdout ? statusResult.stdout.split('\n') : [];
      const clean = files.length === 0;
      const commits = logResult.stdout ? logResult.stdout.split('\n') : [];

      const fileList = files.slice(0, 10).map(f =>
        `<li style="font-size:0.8125rem;color:var(--text-secondary)"><code>${escapeHtml(f)}</code></li>`
      ).join('');

      const commitList = commits.map(c =>
        `<li style="font-size:0.8125rem;color:var(--text-secondary)"><code>${escapeHtml(c)}</code></li>`
      ).join('');

      res.type('text/html').send(`
        <div style="display:flex;align-items:center;gap:var(--sp-2);margin-bottom:var(--sp-3)">
          <span class="status-dot status-dot--${clean ? 'complete' : 'warning'}"></span>
          <strong style="font-size:0.875rem">${escapeHtml(branch)}</strong>
          <span class="badge badge--${clean ? 'success' : 'warning'}">${clean ? 'Clean' : `${files.length} changed`}</span>
        </div>
        ${!clean ? `<ul style="list-style:none;padding:0;margin:0 0 var(--sp-3)">${fileList}${files.length > 10 ? `<li style="color:var(--text-muted);font-size:0.8125rem">...and ${files.length - 10} more</li>` : ''}</ul>` : ''}
        ${!clean ? `
          <div style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-3)">
            <button class="btn btn--ghost btn--sm" hx-post="/api/git/push" hx-swap="none"
              hx-on::after-request="htmx.trigger('#git-panel','reload')">Push</button>
          </div>
        ` : ''}
        <p class="section__title" style="margin-top:var(--sp-3)">Recent Commits</p>
        <ul style="list-style:none;padding:0;margin:0">${commitList}</ul>
      `);
    } catch (err) {
      res.type('text/html').send(`<p style="color:var(--text-muted);font-size:0.875rem">Git not available</p>`);
    }
  });

  // ── Report Viewer Fragment ────────────────────────────────
  router.get('/report-viewer', async (_req, res) => {
    try {
      const orchDir = join(ctx.projectDir || process.cwd(), 'orchestrator');
      let reports = [];

      if (existsSync(orchDir)) {
        const { statSync } = await import('fs');
        const files = readdirSync(orchDir)
          .filter(f => f.endsWith('.md') && f.includes('report'));
        reports = files.map(f => {
          const stat = statSync(join(orchDir, f));
          return { file: f, name: f.replace('.md', '').replace(/-/g, ' '), modifiedAt: stat.mtime.toISOString() };
        }).sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
      }

      if (reports.length === 0) {
        res.type('text/html').send('<p class="empty-state">No reports available yet.</p>');
        return;
      }

      const reportFile = _req.query.file || reports[0].file;
      const reportPath = join(orchDir, reportFile.replace(/[^a-zA-Z0-9._-]/g, ''));
      let content = '';

      if (existsSync(reportPath)) {
        content = readFileSync(reportPath, 'utf-8');
      }

      const tabs = reports.map(r =>
        `<button class="btn btn--sm ${r.file === reportFile ? 'btn--primary' : 'btn--ghost'}"
           hx-get="/views/report-viewer?file=${encodeURIComponent(r.file)}"
           hx-target="#report-viewer"
           hx-swap="innerHTML">${escapeHtml(r.name)}</button>`
      ).join('\n');

      res.type('text/html').send(`
        <div style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-4);flex-wrap:wrap">${tabs}</div>
        <div id="report-content" class="report-content">${escapeHtml(content)}</div>
        <script>
          (function() {
            var el = document.getElementById('report-content');
            if (el && window.marked) {
              el.innerHTML = marked.parse(el.textContent);
            }
          })();
        </script>
      `);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Mission Launcher Fragment ──────────────────────────────
  router.get('/mission-launcher', async (_req, res) => {
    try {
      // Fetch missions from API
      const missionsDir = ctx.missionsDir || null;
      let missions = [];

      if (missionsDir && existsSync(missionsDir)) {
        const files = readdirSync(missionsDir)
          .filter(f => f.endsWith('.json') && !f.startsWith('.'));
        missions = files.map(f => {
          try {
            const raw = readFileSync(join(missionsDir, f), 'utf-8');
            const data = JSON.parse(raw);
            return {
              file: f,
              name: data.name || f.replace('.json', ''),
              type: data.type || 'standard',
              agentCount: data.agents?.length || (data.missions?.length || 0),
            };
          } catch (_) {
            return { file: f, name: f.replace('.json', ''), type: 'unknown', agentCount: 0 };
          }
        });
      }

      const orchStatus = ctx.getOrchStatus ? ctx.getOrchStatus() : { running: false };

      if (orchStatus.running) {
        res.type('text/html').send(`
          <div class="badge badge--success" style="margin-bottom:var(--sp-3)">Orchestrator is running</div>
          <p style="color:var(--text-secondary);font-size:0.875rem">Stop the current run before launching a new mission.</p>
        `);
        return;
      }

      const options = missions.length > 0
        ? missions.map(m =>
            `<option value="${escapeHtml(m.file)}">${escapeHtml(m.name)} (${m.agentCount} ${m.type === 'sequence' ? 'missions' : 'agents'})</option>`
          ).join('\n')
        : '<option value="" disabled>No missions found</option>';

      res.type('text/html').send(`
        <form hx-post="/api/orchestrator/start"
              hx-swap="none"
              hx-on::after-request="htmx.trigger('#mission-launcher','reload'); htmx.trigger('#orch-content','reload');">
          <fieldset style="display:flex;gap:var(--sp-3);align-items:flex-end;flex-wrap:wrap;border:none;padding:0">
            <label style="flex:2;min-width:200px">
              Mission
              <select name="mission">
                ${options}
              </select>
            </label>
            <label style="flex:0;display:flex;align-items:center;gap:var(--sp-2);white-space:nowrap;padding-bottom:var(--sp-2)">
              <input type="checkbox" name="dryRun" value="true" role="switch">
              Dry Run
            </label>
            <button type="submit" ${missions.length === 0 ? 'disabled' : ''} style="flex:0;white-space:nowrap">Launch</button>
          </fieldset>
        </form>
      `);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  return router;
}

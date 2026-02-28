// ============================================================
// View Routes (M5)
// ============================================================
// Serves HTML fragments for HTMX partial requests.
// Fragment endpoints at /views/* return pure HTML strings.
// ============================================================

import { Router } from 'express';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import {
  findChainById, getChainSummary, getChainLineage,
} from '../registry.mjs';
import { renderChainTable } from '../views/chain-row.mjs';
import { renderSessionCard, renderTimeline, renderCostBreakdown } from '../views/session-card.mjs';
import { renderAgentGrid } from '../views/agent-card.mjs';
import { renderTerminalViewer } from '../views/terminal.mjs';
import { escapeHtml, formatCost, formatDuration, relativeTime, statusLabel } from '../views/helpers.mjs';
import { renderAnalyticsPanel } from '../views/analytics.mjs';
import { renderProjectsPanel, renderFileTree } from '../views/projects.mjs';
import { renderTimeline as renderTimelineView, renderTimelineSummary } from '../views/timeline.mjs';
import {
  renderSystemHealth, renderActiveTerminals, renderTaskSummary,
  renderRecentNotifications, renderCostBurnRate,
} from '../views/dashboard-widgets.mjs';
import { renderMultiProjectDashboard } from '../views/multi-project.mjs';
import { categorizeAction, generateSummary, CATEGORY_ACTIONS } from './timeline.mjs';
import { scanDirectory } from './files.mjs';
import { getGitFileStatus } from './git.mjs';

/**
 * Create view routes for HTMX fragments.
 * @param {object} ctx
 * @param {string}   ctx.operatorDir
 * @param {EventBus} ctx.events
 * @param {Function} [ctx.getOrchStatus] - Returns orchestrator status object
 */
export function createViewRoutes(ctx) {
  const loadRegistry = ctx.registry.load;
  const loadSettings = ctx.settings.load;
  const router = Router();

  // ── Chain List Fragment ──────────────────────────────────
  router.get('/chain-list', (req, res) => {
    try {
      const registry = loadRegistry();
      let chains = [...registry.chains];

      // Filter by project
      if (req.query.project) {
        const project = req.query.project.replace(/\\/g, '/');
        chains = chains.filter(c =>
          (c.projectDir || '').replace(/\\/g, '/') === project
        );
      }

      // Filter by status
      if (req.query.status) {
        chains = chains.filter(c => c.status === req.query.status);
      }

      // Filter by text search
      if (req.query.q) {
        const q = req.query.q.toLowerCase();
        chains = chains.filter(c => (c.task || '').toLowerCase().includes(q));
      }

      // Sort
      const sortField = req.query.sort || 'updatedAt';
      const sortDir = req.query.dir === 'asc' ? 1 : -1;
      const sorters = {
        updatedAt: (a, b) => sortDir * (new Date(b.updatedAt) - new Date(a.updatedAt)),
        cost: (a, b) => sortDir * ((b.totalCostUsd || 0) - (a.totalCostUsd || 0)),
        status: (a, b) => sortDir * (a.status || '').localeCompare(b.status || ''),
        sessions: (a, b) => sortDir * ((b.sessions?.length || 0) - (a.sessions?.length || 0)),
      };
      chains.sort(sorters[sortField] || sorters.updatedAt);

      const total = chains.length;
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 25));
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const offset = (page - 1) * limit;
      const totalPages = Math.max(1, Math.ceil(total / limit));

      chains = chains.slice(offset, offset + limit).map(getChainSummary);

      // Pagination controls (out-of-band swap into #chain-pagination)
      const paginationHtml = total > limit ? `
        <div id="chain-pagination" hx-swap-oob="innerHTML:#chain-pagination">
          <span class="pagination__info">${offset + 1}–${Math.min(offset + limit, total)} of ${total}</span>
          ${page > 1 ? `<button class="btn btn--sm btn--ghost" onclick="setPage(${page - 1})">Prev</button>` : ''}
          ${page < totalPages ? `<button class="btn btn--sm btn--ghost" onclick="setPage(${page + 1})">Next</button>` : ''}
        </div>` : '<div id="chain-pagination" hx-swap-oob="innerHTML:#chain-pagination"></div>';

      res.type('text/html').send(renderChainTable(chains) + paginationHtml);
    } catch (err) {
      res.type('text/html').send(`<tr><td colspan="7">Error: ${escapeHtml(err.message)}</td></tr>`);
    }
  });

  // ── Cost Summary Fragment ────────────────────────────────
  router.get('/cost-summary', (_req, res) => {
    try {
      const registry = loadRegistry();
      let chains = registry.chains;

      // Filter by project
      if (_req.query.project) {
        const project = _req.query.project.replace(/\\/g, '/');
        chains = chains.filter(c =>
          (c.projectDir || '').replace(/\\/g, '/') === project
        );
      }
      const totalCost = chains.reduce((sum, c) => sum + (c.totalCostUsd || 0), 0);
      const totalSessions = chains.reduce((sum, c) => sum + (c.sessions?.length || 0), 0);
      const totalTurns = chains.reduce((sum, c) => sum + (c.totalTurns || 0), 0);
      const running = chains.filter(c => c.status === 'running').length;

      // Per-model breakdown
      const byModel = {};
      for (const chain of chains) {
        const model = chain.config?.model || 'sonnet';
        if (!byModel[model]) byModel[model] = { costUsd: 0, chains: 0 };
        byModel[model].costUsd += chain.totalCostUsd || 0;
        byModel[model].chains++;
      }
      const modelOrder = ['opus', 'sonnet', 'haiku'];
      const modelCards = modelOrder
        .filter(m => byModel[m])
        .map(m => {
          const d = byModel[m];
          const label = m.charAt(0).toUpperCase() + m.slice(1);
          return `<div class="metric-card metric-card--model"><div class="metric-card__label">${escapeHtml(label)}</div><div class="metric-card__value">${formatCost(d.costUsd)}</div><div class="metric-card__sub">${d.chains} chain${d.chains !== 1 ? 's' : ''}</div></div>`;
        })
        .join('');

      res.type('text/html').send(`
        <div class="metric-card"><div class="metric-card__label">Total Cost</div><div class="metric-card__value">${formatCost(totalCost)}</div></div>
        <div class="metric-card"><div class="metric-card__label">Chains</div><div class="metric-card__value">${chains.length}</div></div>
        <div class="metric-card"><div class="metric-card__label">Sessions</div><div class="metric-card__value">${totalSessions}</div></div>
        <div class="metric-card"><div class="metric-card__label">Turns</div><div class="metric-card__value">${totalTurns}</div></div>
        <div class="metric-card"><div class="metric-card__label">Running</div><div class="metric-card__value">${running}</div></div>
        ${modelCards}
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
          ${chain.config?.branch ? `<span>Branch: <strong>${escapeHtml(chain.config.branch)}</strong></span>` : ''}
          ${chain.projectDir ? `<span>Project: <strong>${escapeHtml(chain.projectDir)}</strong></span>` : ''}
        </div>

        ${chain.status === 'running' ? `
          <button class="btn btn--danger" hx-post="/api/chains/${chain.id}/abort"
            hx-confirm="Abort this chain?" hx-swap="none"
            hx-on::after-request="htmx.trigger('#chain-content','reload')">Abort Chain</button>
        ` : ''}
        ${['failed', 'aborted', 'max-continuations'].includes(chain.status) ? `
          <button class="btn btn--ghost" hx-post="/api/chains/${chain.id}/restart"
            hx-swap="none"
            hx-on::after-request="htmx.trigger('#chain-content','reload')">Restart Chain</button>
        ` : ''}
        ${['complete', 'assumed-complete'].includes(chain.status) ? `
          <button class="btn btn--ghost" hx-post="/api/git/pr"
            hx-vals='${escapeHtml(JSON.stringify({
              title: chain.task.slice(0, 70),
              body: `## Summary\n\n${chain.task}\n\n## Chain Details\n\n- **Sessions:** ${sessions.length}\n- **Cost:** ${formatCost(chain.totalCostUsd)}\n- **Duration:** ${formatDuration(chain.totalDurationMs)}\n- **Model:** ${chain.config?.model || 'sonnet'}\n${chain.config?.branch ? `- **Branch:** ${chain.config.branch}\n` : ''}\n---\n_Generated by Operator_`,
            }))}'
            hx-swap="none"
            hx-confirm="Create a PR from this chain?">Create PR</button>
        ` : ''}
        ${chain.status !== 'running' ? `
          <button class="btn btn--danger" hx-delete="/api/chains/${chain.id}"
            hx-confirm="Delete this chain permanently?" hx-swap="none"
            hx-on::after-request="window.location='/'">Delete Chain</button>
        ` : ''}

        <h3>Session Timeline</h3>
        ${renderTimeline(sessions)}

        <h3>Cost Breakdown</h3>
        ${renderCostBreakdown(sessions)}

        <h3>Sessions</h3>
        ${sessionsWithChainId.map(renderSessionCard).join('\n') || '<p class="empty-state">No sessions recorded.</p>'}

        ${sessions.filter(s => s.handoffFile).length >= 2 ? `
          <h3>Compare Handoffs</h3>
          <div hx-get="/views/handoff-compare/${chain.id}"
               hx-trigger="load"
               hx-swap="innerHTML">Loading...</div>
        ` : ''}

        <div hx-get="/views/chain-lineage/${chain.id}"
             hx-trigger="load"
             hx-swap="innerHTML"></div>
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
          return res.type('text/html').send(renderTerminalViewer({
            content,
            title: `Session ${idx + 1} — Handoff`,
            maxHeight: 400,
          }));
        } catch (_) { /* fall through */ }
      }
      res.type('text/html').send('<p class="empty-state">No handoff file available.</p>');
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Handoff Comparison Fragment ─────────────────────────
  // Side-by-side comparison of two session handoffs.
  router.get('/handoff-compare/:chainId', (req, res) => {
    try {
      const registry = loadRegistry();
      const chain = findChainById(registry, req.params.chainId);
      if (!chain) return res.type('text/html').send('<p>Chain not found.</p>');

      const sessions = chain.sessions || [];
      const handoffSessions = sessions.filter(s => s.handoffFile && existsSync(s.handoffFile));
      if (handoffSessions.length < 2) {
        return res.type('text/html').send('<p class="empty-state">Need at least 2 sessions with handoffs to compare.</p>');
      }

      const a = parseInt(req.query.a, 10);
      const b = parseInt(req.query.b, 10);

      // If no indices specified, show the selector
      if (isNaN(a) || isNaN(b)) {
        const options = handoffSessions.map(s =>
          `<option value="${s.index}">Session ${s.index + 1}</option>`
        ).join('');
        return res.type('text/html').send(`
          <div class="handoff-compare-picker">
            <label>Left: <select id="compare-a">${options}</select></label>
            <label>Right: <select id="compare-b">${handoffSessions.length > 1
              ? handoffSessions.map((s, i) =>
                  `<option value="${s.index}"${i === handoffSessions.length - 1 ? ' selected' : ''}>Session ${s.index + 1}</option>`
                ).join('')
              : options}</select></label>
            <button class="btn btn--sm btn--primary"
              onclick="var a=document.getElementById('compare-a').value,b=document.getElementById('compare-b').value;
                htmx.ajax('GET','/views/handoff-compare/${chain.id}?a='+a+'&b='+b,'#handoff-compare-content')">Compare</button>
          </div>
          <div id="handoff-compare-content"></div>
        `);
      }

      const sessionA = sessions[a];
      const sessionB = sessions[b];
      if (!sessionA || !sessionB) {
        return res.type('text/html').send('<p>Invalid session indices.</p>');
      }

      let contentA = '', contentB = '';
      try { contentA = readFileSync(sessionA.handoffFile, 'utf-8'); } catch (_) { contentA = '(unavailable)'; }
      try { contentB = readFileSync(sessionB.handoffFile, 'utf-8'); } catch (_) { contentB = '(unavailable)'; }

      res.type('text/html').send(`
        <div class="handoff-compare">
          <div class="handoff-compare__pane">
            ${renderTerminalViewer({ content: contentA, title: 'Session ' + (a + 1) + ' Handoff', maxHeight: 500 })}
          </div>
          <div class="handoff-compare__pane">
            ${renderTerminalViewer({ content: contentB, title: 'Session ' + (b + 1) + ' Handoff', maxHeight: 500 })}
          </div>
        </div>
      `);
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
        ? status.agents.map(a => typeof a === 'string' ? { id: a, status: 'running' } : a)
        : [];

      const html = `
        <hgroup>
          <h2>
            <span class="status-dot status-dot--${status.running ? 'running' : 'complete'}"></span>
            Orchestrator ${status.running ? 'Running' : 'Stopped'}
          </h2>
          <p>${status.mission ? `Mission: ${escapeHtml(status.mission)}` : 'No active mission'}
             ${status.model ? ` · Model: ${escapeHtml(status.model)}` : ''}
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
            hx-on::after-request="htmx.trigger('#orch-content','reload'); htmx.trigger('#mission-launcher','reload')">Stop Orchestrator</button>
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
      const settings = loadSettings();
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
          <form style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-3);align-items:flex-end"
                hx-post="/api/git/commit" hx-swap="none"
                hx-on::after-request="htmx.trigger('#git-panel','reload')">
            <input type="text" name="message" placeholder="Commit message..." required
              style="flex:1;margin:0;padding:var(--sp-1) var(--sp-2);font-size:0.8125rem">
            <button type="submit" class="btn btn--ghost btn--sm">Commit</button>
            <button type="button" class="btn btn--ghost btn--sm" hx-post="/api/git/push" hx-swap="none"
              hx-on::after-request="htmx.trigger('#git-panel','reload')">Push</button>
          </form>
        ` : ''}
        <div style="display:flex;align-items:center;gap:var(--sp-2);margin-top:var(--sp-3)">
          <p class="section__title" style="margin:0">Recent Commits</p>
          <label style="margin-left:auto;font-size:0.75rem;font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-secondary);display:flex;align-items:center;gap:var(--sp-1);white-space:nowrap">
            <input type="checkbox" id="auto-push-toggle" role="switch" style="width:auto"
              ${settings.autoPush ? 'checked' : ''}
              onchange="toggleAutoPush(this.checked)">
            Auto-push
          </label>
        </div>
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
        `<button class="btn btn--sm ${r.file === reportFile ? 'btn--primary' : 'btn--ghost'} report-tab"
           data-name="${escapeHtml(r.name)}" data-date="${r.modifiedAt.slice(0, 10)}"
           hx-get="/views/report-viewer?file=${encodeURIComponent(r.file)}"
           hx-target="#report-viewer"
           hx-swap="innerHTML">${escapeHtml(r.name)}</button>`
      ).join('\n');

      res.type('text/html').send(`
        <div class="report-filters" style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-3);flex-wrap:wrap;align-items:center">
          <input type="search" id="report-search" placeholder="Filter reports..."
            oninput="filterReports()" style="flex:1;min-width:160px;margin:0;padding:var(--sp-1) var(--sp-2);font-size:0.8125rem">
          <span style="color:var(--text-muted);font-size:0.75rem">${reports.length} report${reports.length !== 1 ? 's' : ''}</span>
        </div>
        <div id="report-tabs" style="display:flex;gap:var(--sp-2);margin-bottom:var(--sp-4);flex-wrap:wrap">${tabs}</div>
        <div id="report-content" class="report-content">${escapeHtml(content)}</div>
        <script>
          function filterReports() {
            var q = (document.getElementById('report-search').value || '').toLowerCase();
            var tabs = document.querySelectorAll('.report-tab');
            for (var i = 0; i < tabs.length; i++) {
              var name = (tabs[i].getAttribute('data-name') || '').toLowerCase();
              var date = tabs[i].getAttribute('data-date') || '';
              tabs[i].style.display = (!q || name.includes(q) || date.includes(q)) ? '' : 'none';
            }
          }
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
            <label style="flex:1;min-width:140px">
              Model
              <select name="model">
                <option value="">Default</option>
                <option value="sonnet">Sonnet</option>
                <option value="opus">Opus</option>
                <option value="haiku">Haiku</option>
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

  // ── Settings: Agent Configuration ──────────────────────────
  router.get('/settings-form', (_req, res) => {
    try {
      const settings = loadSettings();

      const modelOptions = ['sonnet', 'opus', 'haiku'].map(m =>
        `<option value="${m}"${settings.model === m ? ' selected' : ''}>${m.charAt(0).toUpperCase() + m.slice(1)}</option>`
      ).join('');

      res.type('text/html').send(`
        <form id="settings-save-form"
              onsubmit="return saveAgentSettings(this)">
          <div class="settings-grid">
            <label>
              Default Model
              <select name="model">${modelOptions}</select>
              <small>Claude model for new chains</small>
            </label>
            <label>
              Max Turns
              <input type="number" name="maxTurns" value="${settings.maxTurns}" min="1" max="200">
              <small>Per session (1-200)</small>
            </label>
            <label>
              Max Continuations
              <input type="number" name="maxContinuations" value="${settings.maxContinuations}" min="1" max="20">
              <small>Auto-continue limit (1-20)</small>
            </label>
            <label>
              Budget Cap (USD)
              <input type="number" name="maxBudgetUsd" value="${settings.maxBudgetUsd}" min="0" max="100" step="0.50">
              <small>Max cost per chain ($0-$100)</small>
            </label>
          </div>
          <div class="settings-actions">
            <button type="submit" class="btn btn--primary">Save</button>
            <button type="button" class="btn btn--ghost"
                    hx-get="/views/settings-form" hx-target="#settings-form" hx-swap="innerHTML">Reset</button>
          </div>
        </form>
      `);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Settings: Git & Automation ────────────────────────────
  router.get('/settings-git', (_req, res) => {
    try {
      const settings = loadSettings();
      res.type('text/html').send(`
        <form id="git-settings-form"
              onsubmit="return saveGitSettings(this)">
          <div class="settings-row">
            <label class="settings-toggle">
              <input type="checkbox" name="autoPush" value="true" role="switch" ${settings.autoPush ? 'checked' : ''}>
              <div>
                <span class="settings-toggle__label">Auto-push on completion</span>
                <small>Automatically push to remote when chains complete successfully</small>
              </div>
            </label>
          </div>
          <div class="settings-actions">
            <button type="submit" class="btn btn--primary">Save</button>
          </div>
        </form>
      `);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Settings: Coordination ────────────────────────────────
  router.get('/settings-coordination', (_req, res) => {
    try {
      const settings = loadSettings();
      // Use live coordinator values if active, otherwise persisted settings
      let rpmVal = settings.coordMaxRequestsPerMinute;
      let tpmVal = settings.coordMaxTokensPerMinute;
      let globalBudget = settings.coordGlobalBudgetUsd;
      let workerBudget = settings.coordPerWorkerBudgetUsd;
      if (ctx.coordinator) {
        try {
          const rlStatus = ctx.coordinator.rateLimiter.getStatus();
          rpmVal = rlStatus.maxRequestsPerMinute || rpmVal;
          tpmVal = rlStatus.maxTokensPerMinute || tpmVal;
        } catch (_) {}
        try {
          const cStatus = ctx.coordinator.costAggregator.getStatus();
          globalBudget = cStatus.globalBudgetUsd || globalBudget;
          workerBudget = cStatus.perWorkerBudgetUsd || workerBudget;
        } catch (_) {}
      }
      const coordActive = !!ctx.coordinator;

      res.type('text/html').send(`
        ${!coordActive ? '<p class="settings-notice"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="var(--status-info)" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3M8 10v.5"/></svg> Coordinator not active. Values are saved and will apply when started with <code>--pool</code>.</p>' : ''}
        <form onsubmit="return saveCoordSettings(this)">
          <div class="settings-grid">
            <label>
              Requests/min
              <input type="number" name="maxRequestsPerMinute" value="${rpmVal}" min="1" max="1000">
              <small>API rate limit (RPM)</small>
            </label>
            <label>
              Tokens/min
              <input type="number" name="maxTokensPerMinute" value="${tpmVal}" min="1000" max="10000000" step="1000">
              <small>Token rate limit (TPM)</small>
            </label>
            <label>
              Global Budget ($)
              <input type="number" name="globalBudgetUsd" value="${globalBudget}" min="0" max="1000" step="1">
              <small>Total budget across all workers</small>
            </label>
            <label>
              Per-Worker Budget ($)
              <input type="number" name="perWorkerBudgetUsd" value="${workerBudget}" min="0" max="100" step="0.5">
              <small>Budget cap per individual worker</small>
            </label>
          </div>
          <div class="settings-actions">
            <button type="submit" class="btn btn--primary">Save</button>
          </div>
        </form>
      `);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Settings: UI Preferences ──────────────────────────────
  router.get('/settings-ui', (_req, res) => {
    try {
      const settings = loadSettings();
      const themes = ['nebula', 'aurora', 'solar', 'mars', 'pulsar', 'quasar', 'comet', 'stellar'];
      const themeOptions = themes.map(t =>
        `<option value="${t}"${settings.defaultTerminalTheme === t ? ' selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`
      ).join('');

      res.type('text/html').send(`
        <form onsubmit="return saveUiSettings(this)">
          <div class="settings-row">
            <label class="settings-toggle">
              <input type="checkbox" name="particlesEnabled" value="true" role="switch" ${settings.particlesEnabled ? 'checked' : ''}>
              <div>
                <span class="settings-toggle__label">Space Particles</span>
                <small>Animated background particles, ships, comets, and cosmic objects</small>
              </div>
            </label>
          </div>
          <div class="settings-grid" style="margin-top:var(--sp-4)">
            <label>
              Default Terminal Theme
              <select name="defaultTerminalTheme">${themeOptions}</select>
              <small>Color theme for new terminal instances</small>
            </label>
          </div>
          <div class="settings-actions">
            <button type="submit" class="btn btn--primary">Save</button>
          </div>
        </form>
      `);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Settings: System Info ─────────────────────────────────
  router.get('/settings-system', (_req, res) => {
    try {
      const uptimeSec = process.uptime();
      const hrs = Math.floor(uptimeSec / 3600);
      const mins = Math.floor((uptimeSec % 3600) / 60);
      const secs = Math.floor(uptimeSec % 60);
      const uptimeStr = hrs > 0 ? `${hrs}h ${mins}m ${secs}s` : mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      const memMB = Math.round(process.memoryUsage().heapUsed / 1048576);
      const nodeVer = process.version;
      const platform = process.platform;

      const registry = loadRegistry();
      const chainCount = registry.chains ? registry.chains.length : 0;

      res.type('text/html').send(`
        <div class="settings-info-grid">
          <div class="settings-info-item">
            <span class="settings-info-item__label">Uptime</span>
            <span class="settings-info-item__value">${uptimeStr}</span>
          </div>
          <div class="settings-info-item">
            <span class="settings-info-item__label">Memory</span>
            <span class="settings-info-item__value">${memMB} MB</span>
          </div>
          <div class="settings-info-item">
            <span class="settings-info-item__label">Node</span>
            <span class="settings-info-item__value">${nodeVer}</span>
          </div>
          <div class="settings-info-item">
            <span class="settings-info-item__label">Platform</span>
            <span class="settings-info-item__value">${platform}</span>
          </div>
          <div class="settings-info-item">
            <span class="settings-info-item__label">Chains</span>
            <span class="settings-info-item__value">${chainCount}</span>
          </div>
          <div class="settings-info-item">
            <span class="settings-info-item__label">PID</span>
            <span class="settings-info-item__value">${process.pid}</span>
          </div>
        </div>
      `);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── API Keys Fragment (Phase 59) ────────────────────────────
  router.get('/settings-api-keys', (_req, res) => {
    try {
      if (!ctx.auth) {
        res.type('text/html').send(`<p class="settings-notice">Authentication is disabled. Enable auth to manage API keys.</p>`);
        return;
      }
      const tokens = ctx.auth.listTokens();
      const rows = tokens.map(t => {
        const created = new Date(t.createdAt);
        const dateStr = created.toLocaleDateString() + ' ' + created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `<tr>
          <td><code class="api-key-id">${escapeHtml(t.id)}</code></td>
          <td>${escapeHtml(t.label || '(no label)')}</td>
          <td>${dateStr}</td>
          <td><button class="btn btn--sm btn--ghost btn--danger-text" onclick="revokeApiKey('${escapeHtml(t.id)}')">Revoke</button></td>
        </tr>`;
      }).join('');

      const emptyRow = `<tr><td colspan="4" style="text-align:center;opacity:.6">No API keys created yet</td></tr>`;

      res.type('text/html').send(`
        <div class="api-keys-section">
          <table class="api-keys-table">
            <thead><tr><th>ID</th><th>Label</th><th>Created</th><th></th></tr></thead>
            <tbody>${rows || emptyRow}</tbody>
          </table>
          <form onsubmit="return createApiKey(this)" class="api-keys-create">
            <input type="text" name="label" placeholder="Label (optional, e.g. CI/CD)" class="api-keys-create__input">
            <button type="submit" class="btn btn--sm btn--primary">Generate Token</button>
          </form>
          <div id="api-key-result" style="display:none" class="api-key-result">
            <p><strong>New token created!</strong> Copy it now — it won't be shown again.</p>
            <div class="api-key-result__token">
              <code id="api-key-value"></code>
              <button class="btn btn--sm btn--ghost" onclick="copyApiKey()">Copy</button>
            </div>
          </div>
        </div>
      `);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Webhooks Settings Fragment (Phase 64) ───────────────────
  router.get('/settings-webhooks', (_req, res) => {
    try {
      const webhookMgr = ctx.webhookManager;
      if (!webhookMgr) {
        res.type('text/html').send(`<p class="settings-notice">Webhook manager not available</p>`);
        return;
      }
      const webhooks = webhookMgr.list();
      const rows = webhooks.map(wh => {
        const evts = (wh.events || []).join(', ');
        const activeClass = wh.active ? '' : ' style="opacity:0.5"';
        return `<tr${activeClass}>
          <td><code class="wh-id">${escapeHtml(wh.id)}</code></td>
          <td class="wh-url">${escapeHtml(wh.url.length > 40 ? wh.url.slice(0, 37) + '...' : wh.url)}</td>
          <td>${escapeHtml(wh.format || 'generic')}</td>
          <td class="wh-events">${escapeHtml(evts.length > 30 ? evts.slice(0, 27) + '...' : evts)}</td>
          <td>
            <button class="btn btn--xs btn--ghost" onclick="toggleWebhook('${escapeHtml(wh.id)}', ${!wh.active})">${wh.active ? 'Disable' : 'Enable'}</button>
            <button class="btn btn--xs btn--ghost" onclick="testWebhook('${escapeHtml(wh.id)}')">Test</button>
            <button class="btn btn--xs btn--ghost btn--danger-text" onclick="deleteWebhook('${escapeHtml(wh.id)}')">Delete</button>
          </td>
        </tr>`;
      }).join('');

      const emptyRow = `<tr><td colspan="5" style="text-align:center;opacity:.6">No webhooks registered</td></tr>`;

      res.type('text/html').send(`
        <div class="wh-section">
          <table class="wh-table">
            <thead><tr><th>ID</th><th>URL</th><th>Format</th><th>Events</th><th></th></tr></thead>
            <tbody>${rows || emptyRow}</tbody>
          </table>
          <form onsubmit="return createWebhook(this)" class="wh-create">
            <input type="url" name="url" placeholder="https://hooks.slack.com/..." required class="wh-create__input">
            <input type="text" name="events" placeholder="Events (e.g. chain:*, coord:*)" value="*" class="wh-create__input">
            <select name="format" class="wh-create__select">
              <option value="generic">Generic</option>
              <option value="slack">Slack</option>
              <option value="discord">Discord</option>
            </select>
            <input type="text" name="label" placeholder="Label (optional)" class="wh-create__input wh-create__input--sm">
            <button type="submit" class="btn btn--sm btn--primary">Add Webhook</button>
          </form>
        </div>
      `);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Secrets Settings Fragment (Phase 64) ───────────────────
  router.get('/settings-secrets', (_req, res) => {
    try {
      const vault = ctx.secretVault;
      if (!vault) {
        res.type('text/html').send(`<p class="settings-notice">Secrets vault not available</p>`);
        return;
      }
      const secrets = vault.list();
      const rows = secrets.map(s => {
        return `<tr>
          <td><code>${escapeHtml(s.name)}</code></td>
          <td class="secret-value" data-revealed="false">••••••••</td>
          <td>${relativeTime(s.updatedAt)}</td>
          <td>
            <button class="btn btn--xs btn--ghost" onclick="toggleSecretReveal('${escapeHtml(s.name)}', this)">Reveal</button>
            <button class="btn btn--xs btn--ghost btn--danger-text" onclick="deleteSecret('${escapeHtml(s.name)}')">Delete</button>
          </td>
        </tr>`;
      }).join('');

      const emptyRow = `<tr><td colspan="4" style="text-align:center;opacity:.6">No secrets stored</td></tr>`;

      res.type('text/html').send(`
        <div class="secrets-section">
          <table class="secrets-table">
            <thead><tr><th>Name</th><th>Value</th><th>Updated</th><th></th></tr></thead>
            <tbody>${rows || emptyRow}</tbody>
          </table>
          <form onsubmit="return createSecret(this)" class="secrets-create">
            <input type="text" name="name" placeholder="Secret name" required class="secrets-create__input">
            <input type="password" name="value" placeholder="Secret value" required class="secrets-create__input">
            <button type="submit" class="btn btn--sm btn--primary">Store Secret</button>
          </form>
        </div>
      `);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Orchestrator Run History Fragment ────────────────────────
  router.get('/orch-history', (_req, res) => {
    try {
      const history = ctx.getOrchHistory ? ctx.getOrchHistory() : [];
      if (history.length === 0) {
        return res.type('text/html').send('<p class="empty-state">No orchestrator runs recorded yet.</p>');
      }

      const rows = history.slice(0, 20).map(run => {
        const outcomeClass = run.outcome === 'error' ? 'error' : run.outcome === 'running' ? 'running' : 'complete';
        return `<tr>
          <td><span class="status-dot status-dot--${outcomeClass}"></span> ${escapeHtml(run.outcome || 'unknown')}</td>
          <td>${escapeHtml(run.mission || '(none)')}</td>
          <td>${escapeHtml(run.model || 'default')}</td>
          <td>${run.rounds || 0}</td>
          <td>${run.agents || 0}</td>
          <td>${formatDuration(run.durationMs)}</td>
          <td>${relativeTime(run.startedAt)}</td>
          <td>${run.dryRun ? '<span class="badge badge--neutral">dry-run</span>' : ''}</td>
        </tr>`;
      }).join('');

      res.type('text/html').send(`
        <table class="orch-history-table" role="grid">
          <thead><tr>
            <th>Outcome</th><th>Mission</th><th>Model</th>
            <th>Rounds</th><th>Agents</th><th>Duration</th>
            <th>Started</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Analytics Fragment ──────────────────────────────────────
  router.get('/analytics', (req, res) => {
    try {
      const registry = loadRegistry();
      let chains = registry.chains || [];

      // Project filter
      const project = req.query.project;
      if (project) {
        const norm = project.replace(/\\/g, '/');
        chains = chains.filter(c => (c.projectDir || '').replace(/\\/g, '/') === norm);
      }

      res.type('text/html').send(renderAnalyticsPanel(chains));
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Chain Lineage Fragment ─────────────────────────────────
  router.get('/chain-lineage/:id', (req, res) => {
    try {
      const registry = loadRegistry();
      const lineage = getChainLineage(registry, req.params.id);

      if (lineage.length <= 1) {
        return res.type('text/html').send('');
      }

      const nodes = lineage.map(c => {
        const isCurrent = c.id === req.params.id;
        return `<div class="lineage__node ${isCurrent ? 'lineage__node--current' : ''}" style="margin-left:${c.depth * 24}px">
          ${c.depth > 0 ? '<span class="lineage__connector"></span>' : ''}
          <span class="status-dot status-dot--${c.status}"></span>
          <a href="/chains/${c.id}">${escapeHtml(c.task.length > 60 ? c.task.slice(0, 57) + '...' : c.task)}</a>
          <span class="lineage__meta">${statusLabel(c.status)} · ${formatCost(c.totalCostUsd)} · ${relativeTime(c.updatedAt)}</span>
        </div>`;
      }).join('');

      res.type('text/html').send(`<div class="lineage">${nodes}</div>`);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Projects Fragment ────────────────────────────────────────
  router.get('/projects', async (_req, res) => {
    try {
      const registry = loadRegistry();
      const chains = registry.chains || [];

      // Build project summaries (same logic as /api/projects)
      const projectMap = {};
      for (const chain of chains) {
        const proj = chain.projectDir || '(default)';
        if (!projectMap[proj]) {
          projectMap[proj] = {
            projectDir: chain.projectDir,
            chains: 0, running: 0, completed: 0, failed: 0,
            totalCostUsd: 0, lastActivity: null,
          };
        }
        const entry = projectMap[proj];
        entry.chains++;
        if (chain.status === 'running') entry.running++;
        if (chain.status === 'complete' || chain.status === 'assumed-complete') entry.completed++;
        if (chain.status === 'failed' || chain.status === 'aborted') entry.failed++;
        entry.totalCostUsd += chain.totalCostUsd || 0;
        if (!entry.lastActivity || chain.updatedAt > entry.lastActivity) {
          entry.lastActivity = chain.updatedAt;
        }
      }

      // Always include the server's own project directory
      if (ctx.projectDir) {
        const norm = ctx.projectDir.replace(/\\/g, '/');
        const alreadyListed = Object.keys(projectMap).some(
          k => k.replace(/\\/g, '/') === norm
        );
        if (!alreadyListed) {
          projectMap[ctx.projectDir] = {
            projectDir: ctx.projectDir,
            chains: 0, running: 0, completed: 0, failed: 0,
            totalCostUsd: 0, lastActivity: null,
          };
        }
      }

      const projects = Object.values(projectMap)
        .sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || ''));

      // Scan root-level entries for each project
      const rootEntriesMap = new Map();
      const gitStatusMap = new Map();
      const gitPromises = [];

      for (const p of projects) {
        const dir = p.projectDir;
        if (dir && dir !== '(default)') {
          rootEntriesMap.set(dir, scanDirectory(dir, ''));
          // Fetch git status in parallel (non-blocking, fail-safe)
          gitPromises.push(
            getGitFileStatus(dir)
              .then(status => gitStatusMap.set(dir, status))
              .catch(() => {}) // git not available — skip silently
          );
        }
      }

      await Promise.all(gitPromises);

      res.type('text/html').send(renderProjectsPanel(projects, rootEntriesMap, gitStatusMap));
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── File Tree Fragment (lazy-load subdirectories) ────────────
  router.get('/file-tree', (req, res) => {
    try {
      const root = req.query.root;
      const subPath = req.query.path || '';

      if (!root) {
        return res.type('text/html').send('<div class="tree-empty">No root specified</div>');
      }

      const resolvedRoot = resolve(root);
      const resolvedFull = resolve(resolvedRoot, subPath);

      // Path-traversal guard
      if (!resolvedFull.replace(/\\/g, '/').startsWith(resolvedRoot.replace(/\\/g, '/'))) {
        return res.type('text/html').send('<div class="tree-empty">Access denied</div>');
      }

      const entries = scanDirectory(resolvedRoot, subPath);
      res.type('text/html').send(renderFileTree(entries, resolvedRoot));
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Orchestrator Summary Fragment (dashboard integration) ────
  router.get('/orch-summary', (_req, res) => {
    try {
      const getInstances = ctx.getOrchInstances;
      if (!getInstances) {
        // No pool mode — return empty
        return res.type('text/html').send('');
      }

      const allInstances = getInstances();
      if (!allInstances || allInstances.length === 0) {
        return res.type('text/html').send('');
      }

      const running = allInstances.filter(i => i.running);
      const totalCost = allInstances.reduce((sum, i) => sum + (i.cost || 0), 0);
      const totalRounds = allInstances.reduce((sum, i) => sum + (i.round || 0), 0);

      // Coordination info (if available)
      let coordHtml = '';
      if (ctx.coordinator) {
        const coord = ctx.coordinator;
        const progress = typeof coord.getProgress === 'function' ? coord.getProgress() : null;
        if (progress && progress.total > 0) {
          const pct = progress.total > 0 ? Math.round((progress.complete / progress.total) * 100) : 0;
          coordHtml = `
            <div class="orch-summary__coord">
              <span class="orch-summary__label">Tasks</span>
              <div class="orch-summary__progress-bar"><div class="orch-summary__progress-fill" style="width:${pct}%"></div></div>
              <span>${progress.complete}/${progress.total}</span>
            </div>`;
        }
      }

      // Build instance cards
      const cards = allInstances.map(inst => {
        const dot = inst.running
          ? '<span class="dot dot--running"></span>'
          : '<span class="dot dot--stopped"></span>';
        const mission = inst.mission ? `<span class="badge badge--neutral">${escapeHtml(inst.mission)}</span>` : '';
        const model = inst.model ? `<span class="badge badge--info">${escapeHtml(inst.model)}</span>` : '';
        const cost = inst.cost ? `<span class="mono" style="color:var(--text-muted)">$${Number(inst.cost).toFixed(4)}</span>` : '';
        return `
          <a href="/terminals" class="orch-summary__card" title="Open in Terminals">
            ${dot}
            <span class="orch-summary__id">${escapeHtml(inst.id)}</span>
            ${mission}${model}
            <span class="orch-summary__meta">R:${inst.round || 0}</span>
            ${cost}
          </a>`;
      }).join('');

      const html = `
        <div class="orch-summary">
          <div class="orch-summary__header">
            <h3 class="section__title">Orchestrators</h3>
            <div class="orch-summary__stats">
              <span class="badge badge--success">${running.length} running</span>
              <span class="badge badge--neutral">${allInstances.length} total</span>
              <span class="mono" style="font-size:0.8125rem">$${formatCost(totalCost)} &middot; ${totalRounds} rounds</span>
            </div>
          </div>
          ${coordHtml}
          <div class="orch-summary__grid">${cards}</div>
        </div>`;

      res.type('text/html').send(html);
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Timeline Fragment (Phase 37) ─────────────────────────
  router.get('/timeline', (req, res) => {
    try {
      const auditLog = ctx.auditLog;
      if (!auditLog) {
        return res.type('text/html').send('<p>Audit log not available.</p>');
      }

      const since = req.query.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const until = req.query.until || undefined;
      const category = req.query.category || '';
      const search = req.query.search || '';
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));

      let queryOpts = { since, until, limit: 10000 };
      let result = auditLog.query(queryOpts);
      let entries = result.entries;

      // Post-filter by category if specified
      if (category && CATEGORY_ACTIONS[category]) {
        const allowedActions = new Set(CATEGORY_ACTIONS[category]);
        entries = entries.filter(e => allowedActions.has(e.action));
      }

      // Limit + enrich
      let enriched = entries.slice(0, limit).map(e => ({
        ...e,
        category: categorizeAction(e.action),
        summary: generateSummary(e),
      }));

      // Post-filter by search term (matches summary, action, or target)
      if (search.trim()) {
        const term = search.trim().toLowerCase();
        enriched = enriched.filter(e =>
          (e.summary || '').toLowerCase().includes(term)
          || (e.action || '').toLowerCase().includes(term)
          || (e.target || '').toLowerCase().includes(term)
        );
      }

      res.type('text/html').send(renderTimelineView(enriched, { search }));
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  router.get('/timeline-summary', (req, res) => {
    try {
      const auditLog = ctx.auditLog;
      if (!auditLog) {
        return res.type('text/html').send('');
      }

      const since = req.query.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const until = req.query.until || undefined;

      const result = auditLog.query({ since, until, limit: 10000 });
      const counts = { terminal: 0, task: 0, swarm: 0, system: 0, memory: 0, webhook: 0, dlq: 0, notification: 0, audit: 0 };
      let total = 0;
      for (const entry of result.entries) {
        const cat = categorizeAction(entry.action);
        counts[cat] = (counts[cat] || 0) + 1;
        total++;
      }
      counts.total = total;

      res.type('text/html').send(renderTimelineSummary(counts));
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── Dashboard Widget Fragments (Phase 47) ──────────────────

  router.get('/dashboard/health', (_req, res) => {
    try {
      const data = ctx.healthChecker ? ctx.healthChecker.check() : null;
      res.type('text/html').send(renderSystemHealth(data));
    } catch (err) {
      res.type('text/html').send(renderSystemHealth(null));
    }
  });

  router.get('/dashboard/terminals', (_req, res) => {
    try {
      const poolStatus = ctx.claudePool ? ctx.claudePool.getPoolStatus() : null;
      res.type('text/html').send(renderActiveTerminals(poolStatus));
    } catch (err) {
      res.type('text/html').send(renderActiveTerminals(null));
    }
  });

  router.get('/dashboard/tasks', (_req, res) => {
    try {
      const metrics = ctx.coordinator ? ctx.coordinator.getMetrics() : null;
      res.type('text/html').send(renderTaskSummary(metrics));
    } catch (err) {
      res.type('text/html').send(renderTaskSummary(null));
    }
  });

  router.get('/dashboard/notifications', (_req, res) => {
    try {
      const result = ctx.notifications ? ctx.notifications.getAll({ limit: 5 }) : null;
      res.type('text/html').send(renderRecentNotifications(result));
    } catch (err) {
      res.type('text/html').send(renderRecentNotifications(null));
    }
  });

  router.get('/dashboard/cost', (_req, res) => {
    try {
      const forecast = ctx.costForecaster ? ctx.costForecaster.getForecast() : null;
      res.type('text/html').send(renderCostBurnRate(forecast));
    } catch (err) {
      res.type('text/html').send(renderCostBurnRate(null));
    }
  });

  // ── Multi-Project Dashboard Fragment (Phase 62) ─────────────
  router.get('/dashboard/multi-project', (_req, res) => {
    try {
      const registry = loadRegistry();
      const chains = registry.chains || [];

      const projectMap = {};
      for (const chain of chains) {
        const proj = chain.projectDir || '(default)';
        if (!projectMap[proj]) {
          projectMap[proj] = {
            projectDir: chain.projectDir,
            chains: 0, running: 0, completed: 0, failed: 0,
            totalCostUsd: 0, lastActivity: null,
          };
        }
        const entry = projectMap[proj];
        entry.chains++;
        if (chain.status === 'running') entry.running++;
        if (chain.status === 'complete' || chain.status === 'assumed-complete') entry.completed++;
        if (chain.status === 'failed' || chain.status === 'aborted') entry.failed++;
        entry.totalCostUsd += chain.totalCostUsd || 0;
        if (!entry.lastActivity || chain.updatedAt > entry.lastActivity) {
          entry.lastActivity = chain.updatedAt;
        }
      }

      // Include server's own project directory even if no chains
      if (ctx.projectDir) {
        const norm = ctx.projectDir.replace(/\\/g, '/');
        const listed = Object.keys(projectMap).some(
          k => k.replace(/\\/g, '/') === norm
        );
        if (!listed) {
          projectMap[ctx.projectDir] = {
            projectDir: ctx.projectDir,
            chains: 0, running: 0, completed: 0, failed: 0,
            totalCostUsd: 0, lastActivity: null,
          };
        }
      }

      const projects = Object.values(projectMap)
        .sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || ''));

      res.type('text/html').send(renderMultiProjectDashboard(projects));
    } catch (err) {
      res.type('text/html').send(`<p>Error: ${escapeHtml(err.message)}</p>`);
    }
  });

  // ── WS Stats Fragment (Phase 49) ────────────────────────────
  router.get('/ws-stats', (_req, res) => {
    try {
      const wsStats = ctx.wss ? ctx.wss.getStats() : null;
      if (!wsStats) {
        res.type('text/html').send('<span class="text-muted" style="font-size:0.75rem">WS stats unavailable</span>');
        return;
      }
      res.type('text/html').send(
        `<div class="ws-stats" style="display:flex;gap:var(--sp-4);font-size:0.75rem;color:var(--text-secondary)">` +
        `<span title="Connected JSON clients"><strong>${wsStats.connectedClients}</strong> clients</span>` +
        `<span title="Binary terminal WS clients"><strong>${wsStats.binaryClients}</strong> terminals</span>` +
        `<span title="Messages sent"><strong>${wsStats.totalMessagesSent}</strong> sent</span>` +
        `<span title="Replay requests"><strong>${wsStats.replayRequests}</strong> replays</span>` +
        `</div>`
      );
    } catch (err) {
      res.type('text/html').send(`<span class="text-muted">Error: ${escapeHtml(err.message)}</span>`);
    }
  });

  return router;
}

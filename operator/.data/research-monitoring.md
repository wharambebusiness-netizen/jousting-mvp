# Real-Time Monitoring & Dashboard Widget Research

*Research date: 2026-02-27*

---

## 1. WebSocket Event Bridge: Inventory & Monitoring Value

### True Event Count

The CLAUDE.md states "72 bridged events" but the actual `BRIDGED_EVENTS` array in `ws.mjs:463-514` contains **96 events** as of the current codebase. The count grew through Phases 15–49.

### Event Categories

| Category | Count | Examples |
|---|---|---|
| Chain lifecycle | 7 | `chain:started`, `chain:complete`, `chain:error` |
| Session | 1 | `session:output` (throttled 1/sec) |
| Orchestrator/Agent | 9 | `round:start`, `agent:start`, `agent:complete` |
| Project | 1 | `project:files-changed` |
| Worker process (pool) | 11 | `worker:spawned`, `worker:unhealthy`, `worker:circuit-open` |
| Handoff | 2 | `handoff:generated`, `handoff:restart` |
| Coordination (coord:) | 20 | `coord:assigned`, `coord:budget-exceeded`, `coord:rate-adjusted` |
| Claude terminals (26 events) | 26 | `claude-terminal:activity-changed`, `claude-terminal:task-completed` |
| Shared memory | 4 | `shared-memory:updated`, `shared-memory:snapshot-written` |
| Terminal messages | 4 | `terminal-message:sent`, `terminal-message:broadcast` |
| Audit/DLQ/Webhook | 6 | `audit:recorded`, `dlq:added`, `webhook:delivered` |
| Notifications/Alerts | 4 | `notification:new`, `cost:alert`, `perf:slow-request` |
| Settings | 2 | `settings:changed`, `coordinator:reconfigured` |

### Top Events for Real-Time Monitoring

**Tier 1 — Highest monitoring value (subscribe to these):**

| Event | Data payload key fields | Monitoring use |
|---|---|---|
| `claude-terminal:activity-changed` | `terminalId`, `state` (active/idle/waiting/stopped), `previousState`, `assignedTask` | Live worker utilization; drives Live Feed panel |
| `claude-terminal:task-completed` | `terminalId`, `task`, `taskId` | Task throughput counter; KPI for efficiency |
| `claude-terminal:task-assigned` | `terminalId`, `task`, `taskId` | Work queue drain rate |
| `coord:task-complete` | task fields | Cross-worker task completion rate |
| `coord:budget-warning` / `coord:budget-exceeded` | budget, used | **Critical alert** — immediate cost intervention needed |
| `cost:alert` | threshold, actual, window | Direct cost monitoring hook |
| `claude-terminal:context-warning` | `terminalId`, context size | Predict upcoming handoffs |
| `claude-terminal:context-refresh-started/completed/failed` | `terminalId`, duration | Context refresh latency metric |
| `worker:unhealthy` / `worker:circuit-open` | `workerId`, reason | System health degradation alert |
| `perf:slow-request` | path, duration | Performance regression detection |

**Tier 2 — Secondary value (dashboards, charts):**

| Event | Monitoring use |
|---|---|
| `chain:started` / `chain:complete` / `chain:error` | Chain success rate chart |
| `coord:scale-up` | Swarm auto-scaling events |
| `coord:rate-adjusted` | Rate limiter adaptation (API pressure metric) |
| `claude-terminal:swarm-scaled-up/down` | Swarm sizing history |
| `handoff:generated` | Handoff frequency per worker |
| `coord:assigned` | Task assignment latency measurement |
| `worker:restarted` / `worker:idle-killed` | Pool churn rate |

**Tier 3 — Operational noise (filter out for dashboards):**

- `shared-memory:*` — too granular, high volume
- `terminal-message:*` — low monitoring value
- `audit:recorded` — high frequency, better via dedicated audit page
- `session:output` — already throttled 1/sec; raw terminal output not useful for widgets
- `coord:worktree-created/removed/merged` — operational detail, not KPI
- `settings:changed` — one-off administrative event

### Gap: No `utilization:snapshot` event

The `_utilization` struct (activeMs, idleMs, tasksCompleted) is computed in `claude-pool.mjs` and polled via REST (`/api/claude-terminals`). There is **no WS event for utilization percentage updates**. Workers currently emit `activity-changed` for state transitions, but cumulative utilization ratios (active% vs idle%) are only available via polling. This is the primary gap for a utilization chart.

---

## 2. Current Dashboard Widget Layout & Gaps

### What exists (Phase 47 Dashboard Widgets)

Located in `views/dashboard-widgets.mjs` and rendered via HTMX poll every 10s into `index.html`.

```
┌─────────────────┬─────────────────┐
│ dw-health       │ dw-terminals    │  ← 10s HTMX poll
│ System Health   │ Active Terminals│
├─────────────────┼─────────────────┤
│ dw-tasks        │ dw-notifications│  ← 10s HTMX poll
│ Task Donut      │ Recent 5 notifs │
├─────────────────────────────────────┤
│ dw-cost (full width)                │  ← 10s HTMX poll
│ Cost & Burn Rate widget             │
└─────────────────────────────────────┘
```

Then below: cost-summary-grid (30s poll), orch-summary (10s), quick-start form, git panel, chain table (15s), analytics (60s collapsed), reports (15s collapsed).

### Widget Details

| Widget | Renderer | Data source | Update |
|---|---|---|---|
| System Health | `renderSystemHealth()` | `healthChecker.check()` | 10s HTMX |
| Active Terminals | `renderActiveTerminals()` | `claudePool.getPoolStatus()` | 10s HTMX |
| Task Summary | `renderTaskSummary()` | `coordinator.getMetrics()` | 10s HTMX |
| Recent Notifications | `renderRecentNotifications()` | `notifications.getAll({limit:5})` | 10s HTMX |
| Cost & Burn Rate | `renderCostBurnRate()` | `costForecaster.getForecast()` | 10s HTMX |
| Cost Summary | HTMX fragment | `/views/cost-summary` | 30s HTMX |
| Analytics | SVG charts (static) | `/views/analytics` | 60s, lazy |
| Reports | Markdown viewer | `/views/report-viewer` | 15s, lazy |

### Critical Gaps Identified

1. **No real-time updates** — all widgets are poll-based (HTMX every N seconds). Zero WS-driven widget updates on the Dashboard page. The Console page has real-time WS updates for worker cards, but the Dashboard does not.

2. **No worker utilization chart** — the Active Terminals widget shows raw counts (running/active/idle/stopped) but has no time-series, no utilization percentage, no per-worker breakdown.

3. **No per-worker cost view on Dashboard** — the Cost widget shows global total. Per-worker costs are only available on the Console page (via `workerCosts` fetched from `/api/coordination/costs`).

4. **No task throughput metric** — tasks completed/hr is not displayed anywhere on the Dashboard.

5. **No rate limiter visibility** — `coord:rate-adjusted` events fire when the adaptive limiter throttles/recovers, but this is invisible in the UI. Users have no way to know if API pressure is causing slowdowns.

6. **Analytics section is historical only** — the Analytics panel (collapsed by default) shows 30-day bar chart of daily costs. No real-time cost trend (last hour/last 15min).

7. **No swarm status widget** — swarm state (enabled/disabled, size) is only visible on the Console page.

8. **Live Feed is Console-only** — the activity event stream (`appendLiveFeedEntry`) only exists on `/console`. The Dashboard has no live event ticker.

---

## 3. Real-Time Cost & Performance Display Possibilities

### Cost Display Architecture

**Current state:**
- `renderCostBurnRate()` in `dashboard-widgets.mjs:257` receives a `forecast` object with:
  - `totalCost` — cumulative USD spent
  - `burnRate.usdPerHour` — rolling burn rate
  - `daily.projectedDailyCost` — projected 24h cost
  - `budget.total` + `budget.usagePercent` — budget bar
  - `exhaustionEstimate.minutesRemaining` — time-to-exhaustion

**Real-time enhancement via WS:**

Subscribe to `['cost:alert', 'coord:budget-warning', 'coord:budget-exceeded']` and update the burn rate display inline without HTMX reload.

```javascript
// Client-side: listen for cost events
createWS(['cost:alert', 'coord:budget-*'], function(msg) {
  if (msg.event === 'cost:alert') {
    // Flash the cost widget, show toast
    document.getElementById('dw-cost').classList.add('dw-card--alert');
  }
  if (msg.event === 'coord:budget-exceeded') {
    htmx.trigger(document.getElementById('dw-cost'), 'reload');
  }
});
```

**Proposed: Live Cost Sparkline**

A 60-minute sliding window of cost samples (1/min), rendered as an SVG sparkline beside the burn rate value. Data source: accumulate cost deltas from `cost:alert` events, or poll `/api/coordination/costs` every 60s and diff.

SVG dimensions: 80×24px sparkline, no axes, filled area chart in accent color (`#6366f1`), with a threshold line at the daily budget rate.

### Performance Display

The `perf:slow-request` event fires with `{path, duration, threshold}` when a request exceeds the configured threshold. Currently there is no UI for this.

**Proposed: Perf Alert Badge**

A small badge on the System Health widget that shows the count of slow requests in the last 5 minutes. Clicking expands a list of affected endpoints. Subscribe to `['perf:slow-request']`, accumulate into a ring buffer, display count as red badge when >0.

---

## 4. Worker Utilization Chart Designs (SVG)

### Data Available

From `claudePool.getPoolStatus()` and individual terminal data:
- `activityState`: 'active' | 'idle' | 'waiting' | 'stopped' per terminal
- `utilization.tasksCompleted`, `utilization.tasksFailed` per terminal
- `utilization.activeMs`, `utilization.idleMs` per terminal (cumulative ms)
- `spawnedAt` per terminal (age)

The `claude-terminal:activity-changed` WS event provides real-time transitions with `{ terminalId, state, previousState, ts }`.

### Chart Design A: Per-Worker Activity Timeline (Gantt-style)

Best for: understanding individual worker behavior, spotting idle gaps.

```
SVG dimensions: 600 × (N_workers * 28 + 40)px

Y-axis: one row per worker (28px height each)
X-axis: sliding 5-minute window, auto-scrolling

Each row: colored blocks representing state segments
  active   → #10b981 (green)
  idle     → #f59e0b (amber)
  waiting  → #6366f1 (indigo)
  stopped  → #64748b (gray)

Implementation:
  - Maintain per-worker state history array: [{state, from, to}]
  - On WS event activity-changed: push segment, trim >5min old
  - Re-render SVG every 2s using requestAnimationFrame
  - rect elements: x=timeOffset, width=duration, height=20, y=rowY
```

SVG template:
```svg
<svg viewBox="0 0 600 {{H}}" class="util-timeline">
  <!-- X-axis time labels -->
  <text x="50" y="12" class="chart-label">-5m</text>
  <text x="300" y="12" class="chart-label">-2.5m</text>
  <text x="550" y="12" class="chart-label">now</text>

  <!-- Worker rows -->
  <g transform="translate(0, 20)">
    <!-- Row for worker-abc -->
    <text x="45" y="14" text-anchor="end" class="chart-label">worker-abc</text>
    <rect x="50" y="4" width="420" height="20" fill="#10b981" opacity="0.8" rx="2">
      <title>active: 7m 3s</title>
    </rect>
    <rect x="470" y="4" width="80" height="20" fill="#f59e0b" opacity="0.8" rx="2">
      <title>idle: 1m 20s</title>
    </rect>
  </g>
</svg>
```

### Chart Design B: Utilization Percentage Gauge (per-worker)

Best for: at-a-glance health of each worker.

```
SVG dimensions: 80×80px per worker (grid layout)

Design: semicircle arc gauge
  Background arc: #1e293b
  Fill arc:       green(>70%) → amber(40-70%) → red(<40%)
  Center text:    "72%" (activeMs / totalMs)

Implementation:
  - Compute pct = activeMs / (activeMs + idleMs + waitingMs)
  - Map [0..1] to arc path (150° sweep, start at 195°)
  - Re-render on WS event or every 30s poll
```

SVG template:
```svg
<svg viewBox="0 0 80 80" class="util-gauge" role="img" aria-label="Worker utilization: 72%">
  <!-- Background arc -->
  <path d="M 15 65 A 30 30 0 1 1 65 65" fill="none" stroke="#1e293b" stroke-width="8"/>
  <!-- Fill arc (dynamic width based on %) -->
  <path d="M 15 65 A 30 30 0 1 1 52 18" fill="none" stroke="#10b981" stroke-width="8"
    stroke-linecap="round"/>
  <!-- Label -->
  <text x="40" y="48" text-anchor="middle" class="gauge-pct">72%</text>
  <text x="40" y="60" text-anchor="middle" class="gauge-label">worker-abc</text>
</svg>
```

### Chart Design C: Pool-Level Stacked Area Chart

Best for: Dashboard overview of total pool utilization over time.

```
SVG dimensions: 600×100px (fits in dw-grid__full slot)

X-axis: last 30 minutes (or configurable)
Y-axis: 0 to max_workers count

Stacked areas (bottom to top):
  active   → #10b981 (green)
  waiting  → #6366f1 (indigo)
  idle     → #f59e0b (amber)
  stopped  → #64748b (gray)

Implementation:
  - Sample pool state every 30s: {ts, active, waiting, idle, stopped}
  - Keep 60 samples (30min at 30s interval)
  - Render as SVG <polygon> paths using standard stacked area algorithm
  - Update on claude-terminal:activity-changed events (debounced 1s)

Data update via WS:
  createWS(['claude-terminal:activity-changed'], function(msg) {
    // Increment/decrement state counters
    // Debounce: push sample every 30s
  });
```

SVG path generation (stacked area):
```javascript
function buildStackedAreaPath(samples, key, prevKey, chartW, chartH, maxWorkers) {
  // top edge: current key stacked on prev
  // bottom edge: prev key alone (reversed)
  // Returns SVG path string
}
```

### Chart Design D: Task Throughput Bars (last 24h hourly)

Best for: showing productivity over time.

```
SVG dimensions: 600×120px

X-axis: 24 hours (hourly buckets)
Y-axis: tasks completed count

Bars colored by success rate:
  all-success: #4ade80
  mixed:       #f59e0b
  high-fail:   #ef4444

Data source: accumulate coord:task-complete / coord:task-failed events
  with hourly bucketing in client-side array
  (or REST endpoint: /api/coordination/tasks with groupBy=hour)
```

---

## 5. Live Feed Panel in console.js — Analysis

### Current Implementation

Located in `console.js:1357-1410` and `console.html:81-88`.

**Architecture:**
- DOM element: `#live-feed-list` — a `<div>` with prepend-newest ordering
- Max entries: 50 (`MAX_LIVE_FEED_ENTRIES`)
- Counter: `#live-feed-count` badge
- Collapsible: toggle via `#live-feed-toggle` click → `.console-livefeed__list--collapsed`
- Real-time: WS subscription to `['claude-terminal:*', 'coord:task-*']`

**Events captured:**
| WS event | Feed entry |
|---|---|
| `claude-terminal:activity-changed` | `prev_state → new_state — task_label` |
| `claude-terminal:spawned` | `spawned` |
| `claude-terminal:exit` | `stopped` |
| `claude-terminal:task-assigned` | `task assigned — task_label` |
| `claude-terminal:task-completed` | `task completed — task_label` |

**Entry format:**
```
[HH:MM:SS] [icon] [terminal-id]  prev_state → new_state — task name
```

Colors per state: active=green(#10b981), idle=amber(#f59e0b), waiting=indigo(#6366f1), stopped=red(#ef4444), spawned=green, task-assigned=cyan(#22d3ee), task-completed=bright-green(#4ade80).

### Gaps in the Live Feed

1. **Missing events:** `coord:budget-warning`, `cost:alert`, `worker:unhealthy`, `claude-terminal:context-warning` are NOT shown in the live feed, despite being high-priority monitoring events.

2. **No severity filtering** — all entries have equal visual weight. A `CRITICAL` budget alert looks the same as an idle→active transition.

3. **No persistence** — feed is cleared on page navigation/reload. Events emitted before the user visits `/console` are lost (no replay on init).

4. **No filtering** — can't filter by terminal ID or event type.

5. **Counter never resets** — `liveFeedCount` increments forever but can't be cleared.

6. **Not available on Dashboard** — the Live Feed only exists in the Console sidebar. The Dashboard has no event stream widget.

### Enhancement Proposals for Live Feed

**A. Severity-based visual weight:**
```javascript
var FEED_LABELS = {
  // Add severity level
  'critical':       { icon: '⚠', color: '#ef4444', text: 'critical', bold: true },
  'budget-warning': { icon: '$', color: '#f97316', text: 'budget warning', bold: true },
  'context-warning':{ icon: '⧗', color: '#eab308', text: 'context pressure' },
};
```

**B. Event replay on init:**
```javascript
// After WS connect, request last N events from replay buffer
ws.send(JSON.stringify({ type: 'replay', afterSeq: -1 }));
// On replay response, filter for live-feed-relevant events and hydrate the list
```

**C. Dashboard mini-feed widget:**
A compact version of the Live Feed for the Dashboard — subscribe to `['claude-terminal:activity-changed', 'cost:alert', 'coord:budget-warning', 'claude-terminal:task-completed']`, display last 10 entries in a `dw-card`.

---

## 6. Implementation Roadmap

### Priority 1 (High Value, Low Effort): WS-Driven Widget Updates on Dashboard

**Target widgets:** `dw-health`, `dw-terminals`, `dw-cost`

**Approach:** Add a small JS block to `index.html` that subscribes to key WS events and calls `htmx.trigger(el, 'reload')` instead of waiting for the 10s poll.

```javascript
// In index.html <script>
createWS(['claude-terminal:activity-changed', 'claude-terminal:task-*',
          'cost:alert', 'coord:budget-*', 'claude-terminal:spawned',
          'claude-terminal:exit'], function(msg) {
  var e = msg.event;
  if (e && (e.startsWith('claude-terminal:') || e === 'cost:alert')) {
    // Debounce 1s
    htmx.trigger(document.getElementById('dw-terminals'), 'reload');
    htmx.trigger(document.getElementById('dw-cost'), 'reload');
  }
});
```

**Files to change:** `operator/public/index.html` (add script block)

---

### Priority 2 (High Value, Medium Effort): Pool Utilization Chart Widget

**Target:** New `dw-utilization` widget (full-width, below dw-cost)

**Approach:**
1. Add `renderWorkerUtilization(poolStatus)` to `views/dashboard-widgets.mjs`
2. Render Chart Design C (stacked area) as server-side SVG using pool status counts
3. For the time-series version: accumulate client-side via WS events (Chart Design C)
4. Add HTMX fragment route in `routes/views.mjs` for `/views/dashboard/utilization`
5. Add `<div id="dw-utilization">` to `index.html` with 15s poll

Server-side SVG (static snapshot — no time-series, quick win):
```javascript
export function renderWorkerUtilization(poolStatus) {
  if (!poolStatus) return '<div class="dw-card">...</div>';

  const { active=0, idle=0, waiting=0, stopped=0, total=0 } = poolStatus;
  const maxW = poolStatus.maxTerminals || Math.max(total, 1);

  // Render horizontal stacked bar: active | waiting | idle | stopped
  const w = 280; // chart width
  const bars = [
    { v: active,  color: '#10b981', label: 'active' },
    { v: waiting, color: '#6366f1', label: 'waiting' },
    { v: idle,    color: '#f59e0b', label: 'idle' },
    { v: stopped, color: '#64748b', label: 'stopped' },
  ];
  let x = 0;
  const rects = bars.map(b => {
    const bw = Math.round((b.v / maxW) * w);
    const r = `<rect x="${x}" y="0" width="${bw}" height="20"
      fill="${b.color}" opacity="0.85" rx="2">
      <title>${b.label}: ${b.v}</title>
    </rect>`;
    x += bw;
    return r;
  }).join('');

  const pct = total > 0 ? Math.round((active / total) * 100) : 0;

  return `<div class="dw-card dw-card--utilization">
    <div class="dw-card__header">
      <h3 class="dw-card__title">Worker Utilization</h3>
      <span class="dw-card__count" style="color:#10b981">${pct}% active</span>
    </div>
    <svg viewBox="0 0 280 20" class="util-bar-svg" role="img"
         aria-label="Worker state distribution">
      ${rects}
    </svg>
    <div class="dw-util-legend">
      ${bars.map(b => `<span><span style="color:${b.color}">■</span> ${b.label}: ${b.v}</span>`).join('')}
    </div>
  </div>`;
}
```

---

### Priority 3 (Medium Value, High Effort): Live Feed Dashboard Widget

**Target:** New `dw-livefeed` widget (collapsible, right column)

**Approach:**
- Subscribe client-side to `['claude-terminal:activity-changed', 'claude-terminal:task-*', 'cost:alert', 'coord:budget-*', 'worker:unhealthy']`
- Maintain client-side ring buffer (max 20 entries)
- Render inline in a `dw-card` with compact styling

**Files to change:** `operator/public/index.html` (add widget div + JS), `operator/public/style.css` (add `.dw-livefeed` styles)

---

### Priority 4 (Medium Value, Medium Effort): Client-Side Activity Timeline

**Target:** Full-width expandable section below `dw-utilization`

**Approach:**
- Pure client-side SVG — no server changes needed
- Subscribe to `claude-terminal:activity-changed` events
- Maintain per-worker state history in `Map<terminalId, [{state, from, to}]>`
- Render Chart Design A (Gantt-style) on a 2s `requestAnimationFrame` loop
- Prune history >10min old on each render

**Files to change:** `operator/public/index.html`, `operator/public/style.css`

---

### Priority 5 (Low Value, Low Effort): Enhanced Live Feed (Console)

**Target:** Add missing critical events to the existing Live Feed in `console.js`

Additional WS subscriptions: `['cost:alert', 'coord:budget-*', 'worker:unhealthy', 'claude-terminal:context-warning']`

```javascript
// In setupWsEvents() — add to subscription list
createWS(['claude-terminal:*', 'coord:task-*', 'cost:alert',
          'coord:budget-warning', 'coord:budget-exceeded',
          'worker:unhealthy'], function(msg) {
  // ... existing handlers ...

  // NEW: cost/health alerts with bold styling
  if (type === 'cost:alert') {
    appendLiveFeedEntry('system', 'budget-alert', null, '$' + (data.actual || 0).toFixed(3));
  }
  if (type === 'coord:budget-warning') {
    appendLiveFeedEntry('coord', 'budget-warning', null, (data.usagePercent * 100 | 0) + '% used');
  }
  if (type === 'worker:unhealthy') {
    appendLiveFeedEntry(data.workerId || 'worker', 'critical', null, data.reason || 'unhealthy');
  }
});
```

**Files to change:** `operator/public/console.js`

---

## Summary of Key Findings

| Finding | Severity | Impact |
|---|---|---|
| Dashboard widgets are 100% poll-based — no WS updates | High | 10s stale data for worker state |
| No utilization chart exists anywhere | High | Can't see pool efficiency |
| Live Feed missing critical cost/health events | Medium | Missed alerts during active sessions |
| `claude-terminal:activity-changed` is the single most valuable event | - | Drives all real-time worker state |
| `cost:alert` and `coord:budget-*` are fully wired but invisible in UI | High | Budget could be exceeded silently |
| WS replay buffer (Phase 49) enables zero-miss reconnects | + | Good foundation for reliable dashboards |
| Dashboard SVG charts are historical only (30-day) | Medium | No short-window trend visibility |
| Per-worker cost only visible in Console page | Low | Needed for cost attribution |

The most impactful single change is **subscribing the Dashboard to `claude-terminal:activity-changed` events and triggering `htmx.trigger(dw-terminals, 'reload')` in response** — this would make the Active Terminals widget effectively real-time for zero additional backend work.

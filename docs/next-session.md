# Next Session Instructions (S99)

## PIVOT: Operator Dashboard is Now the Primary Focus

The game engine and React UI are feature-complete. All future sessions focus on developing the **operator web dashboard** — the HTMX-based interface for managing the multi-agent orchestrator and chain automation system.

Read `CLAUDE.md` first (always), then this file.

## Context: S98

S98 added the **P8 Analytics Dashboard** — a new `/analytics` page with server-side rendered SVG charts for cost analysis and chain performance insights:

1. **Analytics view renderer** (`operator/views/analytics.mjs`) — 7 exported functions:
   - `aggregateAnalytics(chains)` — computes all metrics from raw chain data (cost totals, status breakdown, model grouping, daily cost aggregation, success rate, top chains, averages)
   - `renderCostTimeline(data)` — 30-day daily cost SVG bar chart with Y-axis labels, gridlines, and hover tooltips
   - `renderStatusBreakdown(data)` — SVG donut chart showing chain outcome distribution (complete/failed/running/aborted) with legend
   - `renderModelUsage(data)` — horizontal bar chart showing cost and chain count per model (opus/sonnet/haiku)
   - `renderAnalyticsMetrics(data)` — 6 metric cards: total cost, success rate, avg cost/chain, avg duration, total turns, total duration
   - `renderTopChains(data)` — top 10 chains by cost leaderboard table with links to chain detail
   - `renderAnalyticsPanel(chains)` — combines all charts into a single HTMX fragment

2. **Analytics page** (`operator/public/analytics.html`) — New page with HTMX auto-refresh (60s), skeleton loading states, project filter support via global `htmx:configRequest` injection

3. **Navigation** — "Analytics" link added between Dashboard and Orchestrator on all 5 HTML pages

4. **CSS** — Section 37 in style.css: `.analytics-panel`, `.chart-container`, `.chart-svg`, `.donut-layout`, `.hbar-row`, `.analytics-table` + responsive breakpoints

**Zero new dependencies** — all charts are inline SVG via template literals, consistent with the existing architecture.

**1526 tests, 24 suites, all passing.**

## What Changed (Files Modified)

```
NEW:  operator/views/analytics.mjs          SVG chart renderers (7 functions, ~280 lines)
NEW:  operator/public/analytics.html         Analytics page with HTMX skeleton loading
EDIT: operator/routes/views.mjs              Import analytics renderer, add /views/analytics fragment route with project filter
EDIT: operator/server.mjs                    Add /analytics page route
EDIT: operator/public/index.html             Add Analytics nav link
EDIT: operator/public/chain.html             Add Analytics nav link
EDIT: operator/public/orchestrator.html      Add Analytics nav link
EDIT: operator/public/settings.html          Add Analytics nav link
EDIT: operator/public/style.css              Section 37: analytics CSS (charts, donut, horizontal bars, analytics table, responsive)
EDIT: operator/__tests__/views.test.mjs      +20 tests: aggregation unit tests, chart renderer tests, route integration tests
EDIT: operator/__tests__/server.test.mjs     +2 tests: analytics page + fragment endpoint
EDIT: CLAUDE.md                              Updated test counts (1526), architecture listing (analytics.mjs, analytics.html)
```

## Milestone Status

- **M1-M6**: Core operator system — DONE
- **P1-P7**: Polish & enhancements — DONE (S90-S97)
- **P8**: Analytics dashboard — DONE (S98)

## Future Directions

Potential next work:
- **Performance optimization** — virtual scrolling for large chain lists, indexed persistence
- **Multi-user support** — auth, user roles, shared dashboards
- **Alerting** — email/slack notifications on chain failures or budget overruns
- **Analytics enhancements** — time range picker, drill-down charts, cost forecasting, token efficiency metrics
- **Mobile/PWA** — manifest, push notifications, responsive refinements

## Key Architecture Notes

- **Analytics renderer** follows same pattern as all other view renderers: export function → takes data → returns HTML string via template literal. No external chart library.
- **SVG charts** use inline SVG elements within template literals. Colors reference CSS custom properties via hardcoded hex values matching the design system (STATUS_COLORS, MODEL_COLORS constants).
- **`aggregateAnalytics()`** is a pure function that takes raw chain array and returns a comprehensive data object. All chart renderers consume this single data object.
- **Project filter** works automatically via the existing `htmx:configRequest` listener in app.js that injects `?project=` into all GET requests.
- **Daily cost aggregation** uses `startedAt` date (YYYY-MM-DD) to bucket chain costs into a 30-day window.

## Codebase Stats

```
Operator: 17 source files, ~4,500 lines code + ~3,300 lines tests
Routes:   28 API endpoints, 13 view fragment routes, 4 page routes, 1 WebSocket
Events:   17 bridged WS events, pattern-based subscriptions
Tests:    270 operator tests (server 94, views 112, errors 43, registry 21)
Total:    1526 tests across 24 suites (8 engine + 12 orchestrator + 4 operator)
```

## Running the Operator

```bash
node operator/server.mjs                    # API server on http://127.0.0.1:3100
node operator/server.mjs --port 8080        # Custom port
node operator/server.mjs --operator         # Combined mode: API + chain execution
```

Dashboard at http://127.0.0.1:3100, Analytics at /analytics, Orchestrator at /orchestrator, Settings at /settings.

## Working Style Reminder

- **Use Task subagents aggressively** for research/exploration (they CANNOT write/edit)
- Do all edits yourself in the main context
- Full autonomy — make decisions, don't ask for approval
- Full permissions granted — no pausing for confirmations
- Run `npm test` to verify after changes (1526 tests, 24 suites)

## Reference

- Operator plan: `docs/operator-plan.md` (M1-M6 specs)
- Design reference: `memory/web-design.md`
- Session history: `docs/session-history.md`
- CLAUDE.md has all commands, architecture, gotchas

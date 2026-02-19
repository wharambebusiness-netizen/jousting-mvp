---
name: accessibility-audit
description: Audit HTML pages and HTMX fragments for accessibility compliance
allowed-tools: Read, Glob, Grep, Bash
model: sonnet
context: fork
agent: general-purpose
---

Perform an accessibility audit of all operator UI pages and HTMX fragments.

## Pages to Audit

Read and analyze all 6 HTML pages:
1. operator/public/index.html — Dashboard
2. operator/public/chain.html — Chain detail
3. operator/public/projects.html — Projects file explorer
4. operator/public/analytics.html — Analytics dashboard
5. operator/public/orchestrator.html — Orchestrator status
6. operator/public/settings.html — Settings

Also audit HTMX fragment renderers:
- operator/views/helpers.mjs
- operator/views/chain-row.mjs
- operator/views/session-card.mjs
- operator/views/agent-card.mjs
- operator/views/terminal.mjs
- operator/views/analytics.mjs
- operator/views/projects.mjs

And client-side JS:
- operator/public/app.js (confirm dialog, keyboard shortcuts, modals)

## Checklist

### Semantic HTML (WCAG 2.1 Level A)
- [ ] Proper heading hierarchy (h1 > h2 > h3, no skipped levels)
- [ ] Landmark elements (nav, main, aside, footer)
- [ ] Lists use ul/ol/li, not div soup
- [ ] Tables have thead/tbody, th with scope
- [ ] Buttons vs links used correctly (action vs navigation)

### ARIA Labels (Level A/AA)
- [ ] Interactive elements have accessible names
- [ ] Icons/badges have aria-label or sr-only text
- [ ] Status indicators (dots, badges) have text alternatives
- [ ] Dynamic content regions have aria-live attributes
- [ ] SVG charts have accessible descriptions

### Keyboard Navigation (Level A)
- [ ] All interactive elements reachable via Tab
- [ ] Focus visible on all focusable elements
- [ ] Escape closes modals/dialogs
- [ ] No keyboard traps
- [ ] Custom keyboard shortcuts don't conflict with screen reader keys

### Color & Contrast (Level AA)
- [ ] Text contrast ratio >= 4.5:1 (normal text), >= 3:1 (large text)
- [ ] Check muted/secondary text colors against dark backgrounds
- [ ] Status colors (red/green/yellow) also convey meaning via text/icons
- [ ] Git badges readable without color alone

### HTMX Dynamic Content
- [ ] HTMX swaps announce content changes to screen readers
- [ ] Loading states announced (aria-busy, aria-live)
- [ ] Focus management after content swap
- [ ] Polling updates don't disrupt screen reader flow

### Forms
- [ ] All inputs have associated labels (not just placeholder)
- [ ] Required fields marked with aria-required
- [ ] Error messages associated with inputs via aria-describedby
- [ ] Form submission feedback announced

### Focus Management
- [ ] Confirm dialog traps focus correctly
- [ ] File preview panel manages focus on open/close
- [ ] Modal close returns focus to trigger element
- [ ] Toast notifications don't steal focus

## Output Format

```
ACCESSIBILITY AUDIT
===================
Level: CRITICAL (A violation) / HIGH (AA violation) / MEDIUM (best practice) / LOW (enhancement)

[CRITICAL] description — file:line
  WCAG: criterion number
  Fix: how to remediate

[HIGH] ...
```

End with summary: N issues by level, overall WCAG compliance estimate.

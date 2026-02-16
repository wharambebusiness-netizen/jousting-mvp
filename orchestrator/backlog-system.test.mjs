import { describe, it, expect } from 'vitest';
import { taskMatchesAgent, getAgentTaskPriority, agentHasCriticalTask } from './backlog-system.mjs';

// ── taskMatchesAgent ────────────────────────────────────────

describe('taskMatchesAgent', () => {
  it('matches when task.role equals agent role', () => {
    expect(taskMatchesAgent({ role: 'balance-analyst' }, 'balance-analyst', 'agent-1')).toBe(true);
  });

  it('matches when task.role equals agent ID', () => {
    expect(taskMatchesAgent({ role: 'balance-tuner' }, 'balance-analyst', 'balance-tuner')).toBe(true);
  });

  it('does not match when neither role nor ID match', () => {
    expect(taskMatchesAgent({ role: 'ui-dev' }, 'balance-analyst', 'agent-1')).toBe(false);
  });

  it('handles null agentId', () => {
    expect(taskMatchesAgent({ role: 'dev' }, 'dev', null)).toBe(true);
    expect(taskMatchesAgent({ role: 'dev' }, 'other', null)).toBeFalsy();
  });

  it('handles undefined agentId', () => {
    expect(taskMatchesAgent({ role: 'dev' }, 'dev')).toBe(true);
    expect(taskMatchesAgent({ role: 'dev' }, 'other')).toBeFalsy();
  });
});

// ── getAgentTaskPriority ────────────────────────────────────

describe('getAgentTaskPriority', () => {
  const backlog = [
    { id: 'BL-1', status: 'pending', role: 'dev', priority: 2 },
    { id: 'BL-2', status: 'pending', role: 'dev', priority: 1 },
    { id: 'BL-3', status: 'pending', role: 'qa', priority: 3 },
    { id: 'BL-4', status: 'completed', role: 'dev', priority: 1 },
    { id: 'BL-5', status: 'pending', role: 'dev' }, // no priority → defaults to 99
  ];

  it('returns highest (lowest number) priority for matching role', () => {
    expect(getAgentTaskPriority('dev', backlog)).toBe(1);
  });

  it('returns 99 when no tasks match', () => {
    expect(getAgentTaskPriority('unknown-role', backlog)).toBe(99);
  });

  it('only considers pending tasks', () => {
    const completed = [{ id: 'BL-1', status: 'completed', role: 'dev', priority: 1 }];
    expect(getAgentTaskPriority('dev', completed)).toBe(99);
  });

  it('matches by agentId as well', () => {
    const bl = [{ id: 'BL-1', status: 'pending', role: 'balance-tuner', priority: 1 }];
    expect(getAgentTaskPriority('balance-analyst', bl, 'balance-tuner')).toBe(1);
  });

  it('defaults missing priority to 99', () => {
    const bl = [{ id: 'BL-1', status: 'pending', role: 'dev' }];
    expect(getAgentTaskPriority('dev', bl)).toBe(99);
  });

  it('returns 99 for empty backlog', () => {
    expect(getAgentTaskPriority('dev', [])).toBe(99);
  });
});

// ── agentHasCriticalTask ────────────────────────────────────

describe('agentHasCriticalTask', () => {
  it('returns true when P1 task exists for role', () => {
    const bl = [{ status: 'pending', role: 'dev', priority: 1 }];
    expect(agentHasCriticalTask('dev', bl)).toBe(true);
  });

  it('returns false when only P2+ tasks exist', () => {
    const bl = [{ status: 'pending', role: 'dev', priority: 2 }];
    expect(agentHasCriticalTask('dev', bl)).toBe(false);
  });

  it('returns false when no tasks match role', () => {
    const bl = [{ status: 'pending', role: 'qa', priority: 1 }];
    expect(agentHasCriticalTask('dev', bl)).toBe(false);
  });

  it('returns false when P1 task is not pending', () => {
    const bl = [{ status: 'assigned', role: 'dev', priority: 1 }];
    expect(agentHasCriticalTask('dev', bl)).toBe(false);
  });

  it('matches by agentId', () => {
    const bl = [{ status: 'pending', role: 'balance-tuner', priority: 1 }];
    expect(agentHasCriticalTask('other-role', bl, 'balance-tuner')).toBe(true);
  });

  it('returns false for empty backlog', () => {
    expect(agentHasCriticalTask('dev', [])).toBe(false);
  });

  it('treats missing priority as 99 (not critical)', () => {
    const bl = [{ status: 'pending', role: 'dev' }];
    expect(agentHasCriticalTask('dev', bl)).toBe(false);
  });
});

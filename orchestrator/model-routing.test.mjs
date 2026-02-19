// Model Routing Tests (Phase 3)
import { describe, it, expect } from 'vitest';
import { resolveAgentModel, MODEL_TIERS, ROLE_MODEL_MAP } from './model-routing.mjs';

describe('resolveAgentModel', () => {
  it('returns haiku for coordination roles when user selects opus', () => {
    expect(resolveAgentModel('producer', 'opus')).toBe('haiku');
    expect(resolveAgentModel('tech-lead', 'opus')).toBe('haiku');
    expect(resolveAgentModel('architect', 'opus')).toBe('haiku');
    expect(resolveAgentModel('docs-writer', 'opus')).toBe('haiku');
  });

  it('returns sonnet for code roles when user selects opus', () => {
    expect(resolveAgentModel('ui-dev', 'opus')).toBe('sonnet');
    expect(resolveAgentModel('engine-dev', 'opus')).toBe('sonnet');
    expect(resolveAgentModel('qa-engineer', 'opus')).toBe('sonnet');
    expect(resolveAgentModel('backend-dev', 'opus')).toBe('sonnet');
  });

  it('returns opus for critical roles when user selects opus', () => {
    expect(resolveAgentModel('debugger', 'opus')).toBe('opus');
    expect(resolveAgentModel('refactorer', 'opus')).toBe('opus');
    expect(resolveAgentModel('security-auditor', 'opus')).toBe('opus');
  });

  it('caps to user model when role wants higher', () => {
    // debugger wants opus, but user set sonnet
    expect(resolveAgentModel('debugger', 'sonnet')).toBe('sonnet');
    // engine-dev wants sonnet, but user set haiku
    expect(resolveAgentModel('engine-dev', 'haiku')).toBe('haiku');
  });

  it('returns haiku for coordination roles even with haiku user model', () => {
    expect(resolveAgentModel('producer', 'haiku')).toBe('haiku');
    expect(resolveAgentModel('tech-lead', 'haiku')).toBe('haiku');
  });

  it('defaults unknown roles to sonnet', () => {
    expect(resolveAgentModel('unknown-role', 'opus')).toBe('sonnet');
    expect(resolveAgentModel('custom-thing', 'sonnet')).toBe('sonnet');
  });

  it('defaults invalid user model to sonnet ceiling', () => {
    // Invalid userModel → defaults to sonnet as ceiling
    // debugger wants opus but is capped to sonnet
    expect(resolveAgentModel('debugger', 'invalid')).toBe('sonnet');
    // producer wants haiku which is below sonnet ceiling → gets haiku
    expect(resolveAgentModel('producer', 'gpt-4')).toBe('haiku');
  });

  it('caps unknown role to user model when user model is haiku', () => {
    expect(resolveAgentModel('unknown-role', 'haiku')).toBe('haiku');
  });
});

describe('MODEL_TIERS', () => {
  it('has correct tier values', () => {
    expect(MODEL_TIERS.haiku).toBe(1);
    expect(MODEL_TIERS.sonnet).toBe(2);
    expect(MODEL_TIERS.opus).toBe(3);
  });
});

describe('ROLE_MODEL_MAP', () => {
  it('has entries for coordination roles', () => {
    expect(ROLE_MODEL_MAP['producer']).toBe('haiku');
    expect(ROLE_MODEL_MAP['tech-lead']).toBe('haiku');
  });

  it('has entries for code roles', () => {
    expect(ROLE_MODEL_MAP['ui-dev']).toBe('sonnet');
    expect(ROLE_MODEL_MAP['full-stack-dev']).toBe('sonnet');
  });

  it('has entries for critical roles', () => {
    expect(ROLE_MODEL_MAP['debugger']).toBe('opus');
    expect(ROLE_MODEL_MAP['security-auditor']).toBe('opus');
  });
});

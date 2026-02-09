// ============================================================
// Jousting MVP — AI Opponent Tests
// Comprehensive tests for the basic-ai module: validity, reasoning,
// commentary, difficulty levels, archetypes, pattern tracking, edge cases.
// ============================================================
import { describe, it, expect } from 'vitest';
import { ARCHETYPES, ARCHETYPE_LIST } from '../engine/archetypes';
import {
  JOUST_ATTACKS,
  JOUST_ATTACK_LIST,
  MELEE_ATTACKS,
  MELEE_ATTACK_LIST,
} from '../engine/attacks';
import { SpeedType, Stance, type AIDifficulty, type Attack, type PlayerState } from '../engine/types';
import {
  aiPickJoustChoice,
  aiPickJoustChoiceWithReasoning,
  aiPickJoustChoiceWithCommentary,
  aiPickMeleeAttack,
  aiPickMeleeAttackWithReasoning,
  aiPickMeleeAttackWithCommentary,
  OpponentHistory,
  generateCommentary,
} from './basic-ai';

// --- Helpers ---

const VALID_JOUST_IDS = new Set(JOUST_ATTACK_LIST.map(a => a.id));
const VALID_MELEE_IDS = new Set(MELEE_ATTACK_LIST.map(a => a.id));
const VALID_SPEEDS = new Set([SpeedType.Slow, SpeedType.Standard, SpeedType.Fast]);
const ALL_DIFFICULTIES: AIDifficulty[] = ['easy', 'medium', 'hard'];

function makePlayerState(archId: string): PlayerState {
  const arch = ARCHETYPES[archId];
  return {
    archetype: arch,
    currentStamina: arch.stamina,
    carryoverMomentum: 0,
    carryoverControl: 0,
    carryoverGuard: 0,
  };
}

function makeLowStaminaState(archId: string, ratio: number): PlayerState {
  const arch = ARCHETYPES[archId];
  return {
    archetype: arch,
    currentStamina: Math.floor(arch.stamina * ratio),
    carryoverMomentum: 0,
    carryoverControl: 0,
    carryoverGuard: 0,
  };
}

// ============================================================
// 1. Joust Choice Validity — every archetype x every difficulty
// ============================================================
describe('aiPickJoustChoice validity', () => {
  for (const arch of ARCHETYPE_LIST) {
    for (const diff of ALL_DIFFICULTIES) {
      it(`returns valid PassChoice for ${arch.id} at ${diff} difficulty`, () => {
        const state = makePlayerState(arch.id);
        const choice = aiPickJoustChoice(state, undefined, undefined, diff);

        expect(VALID_SPEEDS.has(choice.speed)).toBe(true);
        expect(VALID_JOUST_IDS.has(choice.attack.id)).toBe(true);
        expect(choice.attack.phase).toBe('joust');
        // shiftAttack should be undefined when no opponent attack is revealed
        expect(choice.shiftAttack).toBeUndefined();
      });
    }
  }
});

// ============================================================
// 2. Melee Attack Validity — every archetype x every difficulty
// ============================================================
describe('aiPickMeleeAttack validity', () => {
  for (const arch of ARCHETYPE_LIST) {
    for (const diff of ALL_DIFFICULTIES) {
      it(`returns valid melee Attack for ${arch.id} at ${diff} difficulty`, () => {
        const state = makePlayerState(arch.id);
        const attack = aiPickMeleeAttack(state, undefined, diff);

        expect(VALID_MELEE_IDS.has(attack.id)).toBe(true);
        expect(attack.phase).toBe('melee');
      });
    }
  }
});

// ============================================================
// 3. WithReasoning — Joust
// ============================================================
describe('aiPickJoustChoiceWithReasoning', () => {
  it('returns both choice and reasoning with correct structure', () => {
    const state = makePlayerState('charger');
    const result = aiPickJoustChoiceWithReasoning(state, undefined, undefined, 'medium');

    // Choice structure
    expect(result.choice).toBeDefined();
    expect(VALID_SPEEDS.has(result.choice.speed)).toBe(true);
    expect(VALID_JOUST_IDS.has(result.choice.attack.id)).toBe(true);

    // Reasoning structure
    expect(result.reasoning).toBeDefined();
    expect(result.reasoning.speed).toBeDefined();
    expect(result.reasoning.speed.weights).toBeDefined();
    expect(typeof result.reasoning.speed.weights.slow).toBe('number');
    expect(typeof result.reasoning.speed.weights.standard).toBe('number');
    expect(typeof result.reasoning.speed.weights.fast).toBe('number');
    expect(typeof result.reasoning.speed.staminaRatio).toBe('number');
    expect(typeof result.reasoning.speed.archetypeBias).toBe('string');
    expect(typeof result.reasoning.speed.wasRandom).toBe('boolean');

    expect(result.reasoning.attack).toBeDefined();
    expect(Array.isArray(result.reasoning.attack.scores)).toBe(true);
    expect(result.reasoning.attack.scores.length).toBe(JOUST_ATTACK_LIST.length);
    expect(typeof result.reasoning.attack.chosen).toBe('string');
    expect(typeof result.reasoning.attack.wasRandom).toBe('boolean');

    // Commentary is a string
    expect(typeof result.reasoning.commentary).toBe('string');
  });

  it('includes shift reasoning when opponent attack is revealed', () => {
    const state = makePlayerState('technician');
    const oppAttack = JOUST_ATTACKS.coupFort;
    const result = aiPickJoustChoiceWithReasoning(state, undefined, oppAttack, 'hard');

    expect(result.reasoning.shift).toBeDefined();
    expect(typeof result.reasoning.shift!.canShift).toBe('boolean');
    expect(typeof result.reasoning.shift!.currentCounterStatus).toBe('string');
    expect(typeof result.reasoning.shift!.decision).toBe('string');
  });

  it('does not include shift reasoning when no opponent attack is revealed', () => {
    const state = makePlayerState('duelist');
    const result = aiPickJoustChoiceWithReasoning(state, undefined, undefined, 'medium');

    expect(result.reasoning.shift).toBeUndefined();
  });
});

// ============================================================
// 4. WithReasoning — Melee
// ============================================================
describe('aiPickMeleeAttackWithReasoning', () => {
  it('returns both attack and reasoning with correct structure', () => {
    const state = makePlayerState('bulwark');
    const result = aiPickMeleeAttackWithReasoning(state, undefined, 'medium');

    expect(result.attack).toBeDefined();
    expect(VALID_MELEE_IDS.has(result.attack.id)).toBe(true);

    expect(result.reasoning).toBeDefined();
    expect(result.reasoning.attack).toBeDefined();
    expect(Array.isArray(result.reasoning.attack.scores)).toBe(true);
    expect(result.reasoning.attack.scores.length).toBe(MELEE_ATTACK_LIST.length);
    expect(typeof result.reasoning.attack.chosen).toBe('string');

    // Speed reasoning is stub for melee (N/A)
    expect(result.reasoning.speed.archetypeBias).toBe('N/A (melee)');
  });

  it('reasoning scores have expected fields', () => {
    const state = makePlayerState('tactician');
    const result = aiPickMeleeAttackWithReasoning(state, MELEE_ATTACKS.overhandCleave, 'hard');

    for (const entry of result.reasoning.attack.scores) {
      expect(typeof entry.attackName).toBe('string');
      expect(typeof entry.attackId).toBe('string');
      expect(typeof entry.score).toBe('number');
      expect(entry.score).toBeGreaterThanOrEqual(1); // min score = 1
      expect(Array.isArray(entry.factors)).toBe(true);
      expect(entry.factors.length).toBeGreaterThan(0); // at least 'Base: 5'
    }
  });
});

// ============================================================
// 5. WithCommentary — Joust and Melee
// ============================================================
describe('aiPickJoustChoiceWithCommentary', () => {
  it('returns choice and commentary string', () => {
    const state = makePlayerState('charger');
    const result = aiPickJoustChoiceWithCommentary(state, undefined, undefined, 'medium');

    expect(result.choice).toBeDefined();
    expect(VALID_SPEEDS.has(result.choice.speed)).toBe(true);
    expect(VALID_JOUST_IDS.has(result.choice.attack.id)).toBe(true);
    expect(typeof result.commentary).toBe('string');
  });

  it('generates low-stamina commentary when stamina is low', () => {
    const state = makeLowStaminaState('charger', 0.2);
    const result = aiPickJoustChoiceWithCommentary(state, undefined, undefined, 'medium');

    // At 20% stamina, commentary should be the lowStamina line
    expect(result.commentary).toContain('steed tires');
  });
});

describe('aiPickMeleeAttackWithCommentary', () => {
  it('returns attack and commentary string', () => {
    const state = makePlayerState('breaker');
    const result = aiPickMeleeAttackWithCommentary(state, undefined, 'hard');

    expect(result.attack).toBeDefined();
    expect(VALID_MELEE_IDS.has(result.attack.id)).toBe(true);
    expect(typeof result.commentary).toBe('string');
  });
});

// ============================================================
// 6. Difficulty Levels
// ============================================================
describe('Difficulty levels produce valid choices', () => {
  it('easy difficulty returns valid joust choice', () => {
    const state = makePlayerState('duelist');
    // Run multiple times to exercise the random path (easy has 60% random)
    for (let i = 0; i < 20; i++) {
      const choice = aiPickJoustChoice(state, undefined, undefined, 'easy');
      expect(VALID_SPEEDS.has(choice.speed)).toBe(true);
      expect(VALID_JOUST_IDS.has(choice.attack.id)).toBe(true);
    }
  });

  it('hard difficulty returns valid joust choice', () => {
    const state = makePlayerState('duelist');
    for (let i = 0; i < 20; i++) {
      const choice = aiPickJoustChoice(state, undefined, undefined, 'hard');
      expect(VALID_SPEEDS.has(choice.speed)).toBe(true);
      expect(VALID_JOUST_IDS.has(choice.attack.id)).toBe(true);
    }
  });

  it('easy difficulty returns valid melee attack', () => {
    const state = makePlayerState('bulwark');
    for (let i = 0; i < 20; i++) {
      const attack = aiPickMeleeAttack(state, undefined, 'easy');
      expect(VALID_MELEE_IDS.has(attack.id)).toBe(true);
    }
  });

  it('hard difficulty returns valid melee attack', () => {
    const state = makePlayerState('bulwark');
    for (let i = 0; i < 20; i++) {
      const attack = aiPickMeleeAttack(state, undefined, 'hard');
      expect(VALID_MELEE_IDS.has(attack.id)).toBe(true);
    }
  });
});

// ============================================================
// 7. All Archetypes — valid AI choices
// ============================================================
describe('All 6 archetypes produce valid AI choices', () => {
  const archIds = ['charger', 'technician', 'bulwark', 'tactician', 'breaker', 'duelist'];

  for (const archId of archIds) {
    it(`${archId}: joust choice is valid`, () => {
      const state = makePlayerState(archId);
      const choice = aiPickJoustChoice(state, undefined, undefined, 'medium');
      expect(VALID_SPEEDS.has(choice.speed)).toBe(true);
      expect(VALID_JOUST_IDS.has(choice.attack.id)).toBe(true);
    });

    it(`${archId}: melee attack is valid`, () => {
      const state = makePlayerState(archId);
      const attack = aiPickMeleeAttack(state, undefined, 'medium');
      expect(VALID_MELEE_IDS.has(attack.id)).toBe(true);
    });
  }
});

// ============================================================
// 8. OpponentHistory — Pattern Tracking
// ============================================================
describe('OpponentHistory pattern tracking', () => {
  it('predictedSpeed returns undefined with fewer than 2 entries', () => {
    const history = new OpponentHistory();
    expect(history.predictedSpeed()).toBeUndefined();
    history.recordSpeed(SpeedType.Fast);
    expect(history.predictedSpeed()).toBeUndefined();
  });

  it('predictedSpeed detects dominant speed (>=2 occurrences)', () => {
    const history = new OpponentHistory();
    history.recordSpeed(SpeedType.Fast);
    history.recordSpeed(SpeedType.Fast);
    expect(history.predictedSpeed()).toBe(SpeedType.Fast);
  });

  it('predictedSpeed returns undefined when no speed dominates', () => {
    const history = new OpponentHistory();
    history.recordSpeed(SpeedType.Slow);
    history.recordSpeed(SpeedType.Standard);
    history.recordSpeed(SpeedType.Fast);
    expect(history.predictedSpeed()).toBeUndefined();
  });

  it('predictedAttackId returns undefined with fewer than 2 entries', () => {
    const history = new OpponentHistory();
    expect(history.predictedAttackId()).toBeUndefined();
    history.recordAttack('coupFort');
    expect(history.predictedAttackId()).toBeUndefined();
  });

  it('predictedAttackId detects dominant attack (>=2 occurrences)', () => {
    const history = new OpponentHistory();
    history.recordAttack('coupFort');
    history.recordAttack('coupFort');
    expect(history.predictedAttackId()).toBe('coupFort');
  });

  it('reset clears all history', () => {
    const history = new OpponentHistory();
    history.recordSpeed(SpeedType.Fast);
    history.recordSpeed(SpeedType.Fast);
    history.recordAttack('coupFort');
    history.recordAttack('coupFort');
    history.reset();
    expect(history.predictedSpeed()).toBeUndefined();
    expect(history.predictedAttackId()).toBeUndefined();
  });

  it('history respects historyLength limit (older entries evicted)', () => {
    const history = new OpponentHistory();
    // Fill with Fast (3 = historyLength)
    history.recordSpeed(SpeedType.Fast);
    history.recordSpeed(SpeedType.Fast);
    history.recordSpeed(SpeedType.Fast);
    // Now push 2 Slow entries — evicts 2 of the 3 Fast entries
    history.recordSpeed(SpeedType.Slow);
    history.recordSpeed(SpeedType.Slow);
    // Window is [Fast, Slow, Slow] — Slow dominates
    expect(history.predictedSpeed()).toBe(SpeedType.Slow);
  });

  it('hard AI uses pattern history for joust choices without crashing', () => {
    const state = makePlayerState('tactician');
    const history = new OpponentHistory();
    history.recordAttack('coupFort');
    history.recordAttack('coupFort');
    history.recordSpeed(SpeedType.Fast);
    history.recordSpeed(SpeedType.Fast);

    // Should not throw, and should return valid choice
    const choice = aiPickJoustChoice(state, undefined, undefined, 'hard', history);
    expect(VALID_SPEEDS.has(choice.speed)).toBe(true);
    expect(VALID_JOUST_IDS.has(choice.attack.id)).toBe(true);
  });

  it('hard AI uses pattern history for melee attacks without crashing', () => {
    const state = makePlayerState('breaker');
    const history = new OpponentHistory();
    history.recordAttack('overhandCleave');
    history.recordAttack('overhandCleave');

    const attack = aiPickMeleeAttack(state, undefined, 'hard', history);
    expect(VALID_MELEE_IDS.has(attack.id)).toBe(true);
  });
});

// ============================================================
// 9. Consistency — stochastic but always within valid sets
// ============================================================
describe('Stochastic consistency', () => {
  it('50 joust picks are all valid PassChoices', () => {
    const state = makePlayerState('charger');
    for (let i = 0; i < 50; i++) {
      const choice = aiPickJoustChoice(state, JOUST_ATTACKS.courseDeLance, undefined, 'medium');
      expect(VALID_SPEEDS.has(choice.speed)).toBe(true);
      expect(VALID_JOUST_IDS.has(choice.attack.id)).toBe(true);
      if (choice.shiftAttack) {
        expect(VALID_JOUST_IDS.has(choice.shiftAttack.id)).toBe(true);
      }
    }
  });

  it('50 melee picks are all valid Attacks', () => {
    const state = makePlayerState('technician');
    for (let i = 0; i < 50; i++) {
      const attack = aiPickMeleeAttack(state, MELEE_ATTACKS.guardHigh, 'hard');
      expect(VALID_MELEE_IDS.has(attack.id)).toBe(true);
      expect(attack.phase).toBe('melee');
    }
  });
});

// ============================================================
// 10. Edge Cases — null/undefined previous attacks
// ============================================================
describe('Edge cases: null/undefined inputs', () => {
  it('joust AI handles undefined opponentLastAttack', () => {
    const state = makePlayerState('duelist');
    expect(() => aiPickJoustChoice(state, undefined, undefined, 'medium')).not.toThrow();
  });

  it('joust AI handles undefined opponentRevealedAttack', () => {
    const state = makePlayerState('duelist');
    expect(() => aiPickJoustChoice(state, JOUST_ATTACKS.coupFort, undefined, 'hard')).not.toThrow();
  });

  it('melee AI handles undefined opponentLastAttack', () => {
    const state = makePlayerState('breaker');
    expect(() => aiPickMeleeAttack(state, undefined, 'easy')).not.toThrow();
  });

  it('joust WithReasoning handles undefined attacks', () => {
    const state = makePlayerState('bulwark');
    expect(() => aiPickJoustChoiceWithReasoning(state, undefined, undefined, 'medium')).not.toThrow();
  });

  it('melee WithReasoning handles undefined attacks', () => {
    const state = makePlayerState('tactician');
    expect(() => aiPickMeleeAttackWithReasoning(state, undefined, 'hard')).not.toThrow();
  });

  it('joust WithCommentary handles undefined attacks', () => {
    const state = makePlayerState('charger');
    expect(() => aiPickJoustChoiceWithCommentary(state, undefined, undefined, 'easy')).not.toThrow();
  });

  it('melee WithCommentary handles undefined attacks', () => {
    const state = makePlayerState('breaker');
    expect(() => aiPickMeleeAttackWithCommentary(state, undefined, 'medium')).not.toThrow();
  });

  it('AI handles very low stamina (near zero) without crashing', () => {
    const state = makeLowStaminaState('charger', 0.05); // 5% stamina
    expect(() => aiPickJoustChoice(state, undefined, undefined, 'hard')).not.toThrow();
    expect(() => aiPickMeleeAttack(state, undefined, 'hard')).not.toThrow();

    const joustChoice = aiPickJoustChoice(state, undefined, undefined, 'hard');
    expect(VALID_SPEEDS.has(joustChoice.speed)).toBe(true);
    expect(VALID_JOUST_IDS.has(joustChoice.attack.id)).toBe(true);
  });

  it('AI handles zero stamina without crashing', () => {
    const arch = ARCHETYPES.duelist;
    const state: PlayerState = {
      archetype: arch,
      currentStamina: 0,
      carryoverMomentum: 0,
      carryoverControl: 0,
      carryoverGuard: 0,
    };
    expect(() => aiPickJoustChoice(state, undefined, undefined, 'medium')).not.toThrow();
    expect(() => aiPickMeleeAttack(state, undefined, 'medium')).not.toThrow();
  });
});

// ============================================================
// 11. generateCommentary direct tests
// ============================================================
describe('generateCommentary', () => {
  it('returns pattern-read commentary when patternDetected is true', () => {
    const commentary = generateCommentary('charger', 0.8, Stance.Balanced, true);
    expect(commentary).toContain('pattern');
  });

  it('returns lowStamina commentary when staRatio <= 0.35', () => {
    const commentary = generateCommentary('bulwark', 0.3, Stance.Balanced, false);
    expect(commentary).toContain('waning');
  });

  it('returns highMomentum commentary when staRatio >= 0.80 and aggressive', () => {
    const commentary = generateCommentary('charger', 0.85, Stance.Aggressive, false);
    expect(commentary).toContain('gallop');
  });

  it('returns aggressive commentary for aggressive stance at normal stamina', () => {
    const commentary = generateCommentary('bulwark', 0.6, Stance.Aggressive, false);
    expect(commentary).toContain('opening');
  });

  it('returns defensive commentary for defensive stance', () => {
    const commentary = generateCommentary('technician', 0.7, Stance.Defensive, false);
    expect(commentary).toContain('distance');
  });

  it('returns empty string for neutral (balanced stance, normal stamina, no pattern)', () => {
    const commentary = generateCommentary('duelist', 0.6, Stance.Balanced, false);
    expect(commentary).toBe('');
  });

  it('falls back to duelist commentary for unknown archetype id', () => {
    const commentary = generateCommentary('unknown_arch', 0.3, Stance.Balanced, false);
    // Should use duelist defaults, lowStamina line
    expect(commentary).toContain('Stamina fading');
  });
});

// ============================================================
// 12. Shift decision — with revealed opponent attack
// ============================================================
describe('Shift decision with revealed opponent attack', () => {
  it('may produce a shift attack when opponent attack is revealed', () => {
    // Run many times; shift is probabilistic but should not crash
    const state = makePlayerState('technician'); // high shift affinity
    let shiftedAtLeastOnce = false;
    for (let i = 0; i < 100; i++) {
      const choice = aiPickJoustChoice(state, undefined, JOUST_ATTACKS.coupFort, 'hard');
      expect(VALID_SPEEDS.has(choice.speed)).toBe(true);
      expect(VALID_JOUST_IDS.has(choice.attack.id)).toBe(true);
      if (choice.shiftAttack) {
        expect(VALID_JOUST_IDS.has(choice.shiftAttack.id)).toBe(true);
        shiftedAtLeastOnce = true;
      }
    }
    // It's possible (but extremely unlikely) to never shift in 100 tries;
    // we just verify validity above, not that shift always happens
  });

  it('shift attack is always a joust-phase attack when present', () => {
    const state = makePlayerState('tactician');
    for (let i = 0; i < 30; i++) {
      const choice = aiPickJoustChoice(state, undefined, JOUST_ATTACKS.portDeLance, 'hard');
      if (choice.shiftAttack) {
        expect(choice.shiftAttack.phase).toBe('joust');
      }
    }
  });
});

// ============================================================
// 13. Counter-aware scoring
// ============================================================
describe('Counter-aware attack scoring', () => {
  it('WithReasoning scores give bonus to attacks that counter opponent last attack', () => {
    const state = makePlayerState('duelist');
    // Opponent played coupFort — it is beaten by coupEnPassant and courseDeLance
    const result = aiPickJoustChoiceWithReasoning(state, JOUST_ATTACKS.coupFort, undefined, 'hard');
    const scores = result.reasoning.attack.scores;

    const cepScore = scores.find(s => s.attackId === 'coupEnPassant');
    const cdlScore = scores.find(s => s.attackId === 'courseDeLance');
    const cfScore = scores.find(s => s.attackId === 'coupFort');

    expect(cepScore).toBeDefined();
    expect(cdlScore).toBeDefined();
    expect(cfScore).toBeDefined();

    // coupEnPassant and courseDeLance beat coupFort, so they should have counter bonus factors
    expect(cepScore!.factors.some(f => f.includes('Counters'))).toBe(true);
    expect(cdlScore!.factors.some(f => f.includes('Counters'))).toBe(true);
  });

  it('WithReasoning melee scores penalize attacks countered by opponent last attack', () => {
    const state = makePlayerState('duelist');
    // Opponent played overhandCleave — it beats guardHigh and riposteStep
    const result = aiPickMeleeAttackWithReasoning(state, MELEE_ATTACKS.overhandCleave, 'hard');
    const scores = result.reasoning.attack.scores;

    const ghScore = scores.find(s => s.attackId === 'guardHigh');
    const rsScore = scores.find(s => s.attackId === 'riposteStep');

    expect(ghScore).toBeDefined();
    expect(rsScore).toBeDefined();

    // guardHigh and riposteStep are beaten by overhandCleave
    expect(ghScore!.factors.some(f => f.includes('Countered by'))).toBe(true);
    expect(rsScore!.factors.some(f => f.includes('Countered by'))).toBe(true);
  });
});

// ============================================================
// 14. Low stamina forces Slow speed
// ============================================================
describe('Low stamina behavior', () => {
  it('very low stamina (<=25%) forces Slow speed via reasoning', () => {
    const state = makeLowStaminaState('charger', 0.20);
    const result = aiPickJoustChoiceWithReasoning(state, undefined, undefined, 'hard');

    // At <= 25% stamina, the AI unconditionally picks Slow
    expect(result.choice.speed).toBe(SpeedType.Slow);
    expect(result.reasoning.speed.wasRandom).toBe(false);
  });
});

// ============================================================
// 15. Speed reasoning weights are non-negative
// ============================================================
describe('Speed reasoning weights', () => {
  it('all speed weights are non-negative for every archetype', () => {
    for (const arch of ARCHETYPE_LIST) {
      const state = makePlayerState(arch.id);
      const result = aiPickJoustChoiceWithReasoning(state, undefined, undefined, 'medium');
      const w = result.reasoning.speed.weights;
      expect(w.slow).toBeGreaterThanOrEqual(0);
      expect(w.standard).toBeGreaterThanOrEqual(0);
      expect(w.fast).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============================================================
// 16. Attack scores all have minimum of 1
// ============================================================
describe('Attack score minimum', () => {
  it('all joust attack scores are >= 1', () => {
    const state = makePlayerState('duelist');
    const result = aiPickJoustChoiceWithReasoning(state, JOUST_ATTACKS.coupFort, undefined, 'hard');
    for (const entry of result.reasoning.attack.scores) {
      expect(entry.score).toBeGreaterThanOrEqual(1);
    }
  });

  it('all melee attack scores are >= 1', () => {
    const state = makePlayerState('duelist');
    const result = aiPickMeleeAttackWithReasoning(state, MELEE_ATTACKS.overhandCleave, 'hard');
    for (const entry of result.reasoning.attack.scores) {
      expect(entry.score).toBeGreaterThanOrEqual(1);
    }
  });
});

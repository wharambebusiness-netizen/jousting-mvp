// ============================================================
// Jousting MVP — Archetype Data (v4.1 spec, Section 8)
// ============================================================
import type { Archetype } from './types';

export const ARCHETYPES: Record<string, Archetype> = {
  charger: {
    id: 'charger',
    name: 'Charger',
    momentum: 70,
    control: 45,
    guard: 55,
    initiative: 60,
    stamina: 50,
    identity: 'Raw impact; wins fast or fades',
  },
  technician: {
    id: 'technician',
    name: 'Technician',
    momentum: 50,
    control: 70,
    guard: 55,
    initiative: 60,
    stamina: 55,
    identity: 'Reactive specialist; shift master',
  },
  bulwark: {
    id: 'bulwark',
    name: 'Bulwark',
    momentum: 55,
    control: 55,
    guard: 75,
    initiative: 45,
    stamina: 65,
    identity: 'Immovable wall; wins on attrition',
  },
  tactician: {
    id: 'tactician',
    name: 'Tactician',
    momentum: 55,
    control: 65,
    guard: 50,
    initiative: 75,
    stamina: 55,
    identity: 'Tempo control; shift priority',
  },
  breaker: {
    id: 'breaker',
    name: 'Breaker',
    momentum: 65,
    control: 60,
    guard: 50,
    initiative: 55,
    stamina: 50,
    identity: 'Guard shatter; anti-Bulwark',
  },
  duelist: {
    id: 'duelist',
    name: 'Duelist',
    momentum: 60,
    control: 60,
    guard: 60,
    initiative: 60,
    stamina: 60,
    identity: 'Balanced generalist; adaptable',
  },
};

export const ARCHETYPE_LIST: Archetype[] = Object.values(ARCHETYPES);

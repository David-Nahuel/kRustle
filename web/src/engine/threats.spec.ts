import { describe, expect, it } from 'vitest';

import { type Stats, emptyStats } from './champions';
import { type Meta, type SpeciesUsage, type TeamsFile, buildMetagame } from './metagame';
import type { TeamMember } from './pokepaste';
import { type Threat, analyzeThreat, byDanger, metaThreats } from './threats';

const META: Meta = {
  format: 'M-C',
  generatedAt: '2026-10-20T00:00:00Z',
  halfLifeDays: 14,
  tournaments: 1,
  teams: 1,
  matches: 0,
  firstDate: null,
  lastDate: null,
};

// Garchomp con Scarf, Earthquake y Dragon Claw; el resto del equipo solo da contexto.
const TEAMS: TeamsFile = {
  species: ['Garchomp', 'Pelipper'],
  items: ['Choice Scarf', 'Damp Rock'],
  abilities: ['Rough Skin', 'Drizzle'],
  natures: ['Jolly', 'Modest'],
  moves: ['Earthquake', 'Dragon Claw', 'Hurricane'],
  sets: [
    [0, 0, 0, 0, [0, 1]],
    [1, 1, 1, 1, [2]],
  ],
  tournaments: [{ id: 't', name: 'T', date: '2026-10-19T00:00:00Z', players: 8 }],
  teams: [[0, 3, 3, 0, 0, 1]],
  matches: [],
};
const usage = (species: string, share: number) => ({ species, usage: share }) as SpeciesUsage;
const metagame = buildMetagame(
  {
    meta: META,
    usage: [usage('Garchomp', 0.4), usage('Corviknight', 0.3), usage('Pelipper', 0.2)],
    teams: TEAMS,
  },
  new Date('2026-10-20'),
);

const member = (species: string, moves: string[], sps: Partial<Stats> = {}): TeamMember => ({
  species,
  moves,
  nature: 'Adamant',
  sps: { ...emptyStats(), hp: 32, atk: 32, ...sps },
});
const corviknight = member('Corviknight', ['Brave Bird']);
const mamoswine = member('Mamoswine', ['Icicle Crash', 'Earthquake']);

describe('analyzeThreat', () => {
  it('su ataque contra cada uno es el que más daño hace de los que le afectan', () => {
    const raichu = member('Raichu', ['Thunderbolt']);
    const threat = analyzeThreat(metagame, [corviknight, raichu], 'Garchomp');
    // Corviknight vuela: Earthquake no le afecta. A Raichu, en cambio, le hace el doble.
    expect(threat.duels[0].theirs?.move).toBe('Dragon Claw');
    expect(threat.duels[1].theirs?.move).toBe('Earthquake');
  });

  it('la mejor respuesta es quien antes la debilita', () => {
    const threat = analyzeThreat(metagame, [corviknight, mamoswine], 'Garchomp');
    expect(threat.answer?.member).toBe(1);
    expect(threat.answer?.mine?.move).toBe('Icicle Crash');
    expect(threat.unanswered).toBe(false);
  });

  it('sin nadie que la dañe, no tiene respuesta y es más peligrosa', () => {
    const passive = member('Whimsicott', ['Tailwind', 'Encore']);
    const alone = analyzeThreat(metagame, [passive], 'Garchomp');
    expect(alone.answer).toBeUndefined();
    expect(alone.unanswered).toBe(true);
    const covered = analyzeThreat(metagame, [mamoswine], 'Garchomp');
    expect([covered, alone].sort(byDanger)[0]).toBe(alone);
  });
});

describe('byDanger', () => {
  it('a igual peligro (aunque el redondeo diga otra cosa), primero la más usada', () => {
    const threat = (species: string, danger: number, usage: number) =>
      ({ species, danger, usage }) as Threat;
    const list = [threat('A', 0.7500000000000002, 0.1), threat('B', 0.75, 0.2)];
    expect(list.sort(byDanger).map((t) => t.species)).toEqual(['B', 'A']);
  });
});

describe('metaThreats', () => {
  it('los más usados del formato, sin los que ya llevo', () => {
    expect(metaThreats(metagame, [corviknight])).toEqual(['Garchomp', 'Pelipper']);
  });
});

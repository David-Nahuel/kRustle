import { describe, expect, it } from 'vitest';

import { type Meta, type TeamsFile, buildMetagame } from './metagame';
import { SPECIES_PRIOR_GAMES, matchupFeatures } from './versus';

const META: Meta = {
  format: 'M-C',
  generatedAt: '2026-10-20T00:00:00Z',
  halfLifeDays: 14,
  tournaments: 1,
  teams: 3,
  matches: 0,
  firstDate: null,
  lastDate: null,
};

// Tres equipos de un Pokémon: X gana siempre a Y (40 veces); Z no ha jugado.
const TEAMS: TeamsFile = {
  species: ['X', 'Y', 'Z'],
  items: [],
  abilities: [],
  natures: [],
  moves: [],
  sets: [
    [0, null, null, null, []],
    [1, null, null, null, []],
    [2, null, null, null, []],
  ],
  tournaments: [{ id: 't', name: 'T', date: '2026-10-19T00:00:00Z', players: 8 }],
  teams: [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 1],
    [0, 0, 0, 0, 2],
  ],
  matches: Array.from({ length: 40 }, () => [0, 1, 1] as [number, number, 1]),
};
const metagame = buildMetagame({ meta: META, usage: [], teams: TEAMS }, new Date('2026-10-20'));

describe('matchupFeatures', () => {
  it('es positivo para quien ha ganado, negativo para quien ha perdido, y simétrico', () => {
    const xy = matchupFeatures(metagame, ['X'], ['Y']);
    const yx = matchupFeatures(metagame, ['Y'], ['X']);
    // 40-0 con 20 partidas al 50%: (40 + 10) / (40 + 20) − 0,5.
    const edge = (40 + SPECIES_PRIOR_GAMES / 2) / (40 + SPECIES_PRIOR_GAMES) - 0.5;
    expect(xy.matchups).toBeCloseTo(edge);
    expect(yx.matchups).toBeCloseTo(-edge);
    expect(xy.species).toBeCloseTo(-yx.species);
    expect(xy.species).toBeGreaterThan(0);
  });

  it('sin partidas entre ellos, no hay ventaja', () => {
    expect(matchupFeatures(metagame, ['X'], ['Z']).matchups).toBe(0);
  });
});

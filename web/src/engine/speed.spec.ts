import { describe, expect, it } from 'vitest';

import { emptyStats } from './champions';
import type { Combatant } from './damage';
import { compareSpeed, speedStat } from './speed';

const sps = (partial: Partial<ReturnType<typeof emptyStats>>) => ({ ...emptyStats(), ...partial });
const jollyChomp: Combatant = {
  species: 'Garchomp',
  nature: 'Jolly',
  sps: sps({ atk: 32, spe: 32, hp: 2 }),
};

describe('speedStat', () => {
  it('calcula la velocidad base a nivel 50 con SP y naturaleza', () => {
    // floor(1.1 × (102 + 32 + 20))
    expect(speedStat(jollyChomp)).toBe(169);
  });

  it('aplica Scarf, Tailwind, cambios de stat y parálisis', () => {
    expect(speedStat({ ...jollyChomp, item: 'Choice Scarf' })).toBe(253);
    expect(speedStat(jollyChomp, { tailwind: true })).toBe(338);
    expect(speedStat({ ...jollyChomp, boosts: { spe: -1 } })).toBe(112);
    expect(speedStat({ ...jollyChomp, status: 'par' })).toBe(84);
  });

  it('duplica con la habilidad de clima solo si hace ese clima', () => {
    const basculegion: Combatant = {
      species: 'Basculegion',
      ability: 'Swift Swim',
      nature: 'Adamant',
      sps: emptyStats(),
    };
    const dry = speedStat(basculegion);
    expect(speedStat(basculegion, { field: { weather: 'Rain' } })).toBe(dry * 2);
    expect(speedStat(basculegion, { field: { weather: 'Sun' } })).toBe(dry);
  });
});

describe('compareSpeed', () => {
  const sneasler = { species: 'Sneasler' };
  // 70% Jolly a velocidad máxima, 30% Adamant a velocidad máxima.
  const spreads = [
    { nature: 'Jolly', sps: sps({ atk: 32, spe: 32, hp: 2 }), probability: 0.7 },
    { nature: 'Adamant', sps: sps({ atk: 32, spe: 32, hp: 2 }), probability: 0.3 },
  ];

  it('da la probabilidad de moverse antes según los repartos del rival', () => {
    const me: Combatant = { species: 'Sneasler', nature: 'Jolly', sps: sps({ spe: 32 }) };
    const result = compareSpeed(me, sneasler, spreads);
    expect(result.tie).toBeCloseTo(0.7);
    expect(result.first).toBeCloseTo(0.3);
    expect(result.theirRange[0]).toBeLessThan(result.theirRange[1]);
  });

  it('Trick Room invierte quién se mueve antes', () => {
    const slow: Combatant = { species: 'Torkoal', nature: 'Quiet', sps: emptyStats() };
    const normal = compareSpeed(slow, sneasler, spreads);
    const trickRoom = compareSpeed(slow, sneasler, spreads, { trickRoom: true });
    expect(normal.second).toBeCloseTo(1);
    expect(trickRoom.first).toBeCloseTo(1);
  });
});

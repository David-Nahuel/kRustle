import { describe, expect, it } from 'vitest';

import { SP_TOTAL, statTotal } from './champions';
import type { NatureSpreads } from './metagame';
import { inferSpreads, spreadDistribution } from './spreads';

const probable = (set: Parameters<typeof inferSpreads>[0]) => inferSpreads(set)[0].sps;

describe('inferSpreads', () => {
  it('atacante rápido con naturaleza de velocidad: ataque + velocidad', () => {
    expect(
      probable({
        species: 'Sneasler',
        nature: 'Jolly',
        moves: ['Close Combat', 'Dire Claw', 'Protect'],
      }),
    ).toMatchObject({ atk: 32, spe: 32, hp: 2 });
  });

  it('atacante lento con naturaleza de ataque: PS + ataque', () => {
    expect(
      probable({
        species: 'Rillaboom',
        nature: 'Adamant',
        moves: ['Wood Hammer', 'Grassy Glide', 'Fake Out'],
      }),
    ).toMatchObject({ hp: 32, atk: 32 });
  });

  it('naturaleza defensiva: PS + la defensa que sube', () => {
    expect(
      probable({
        species: 'Incineroar',
        nature: 'Careful',
        moves: ['Fake Out', 'Flare Blitz', 'Parting Shot'],
      }),
    ).toMatchObject({ hp: 32, spd: 32, def: 2 });
  });

  it('naturaleza que baja velocidad: Trick Room, nada en velocidad', () => {
    expect(
      probable({ species: 'Ursaluna', nature: 'Brave', moves: ['Facade', 'Headlong Rush'] }),
    ).toMatchObject({ hp: 32, atk: 32, spe: 0 });
  });

  it('usa los stats de la mega para decidir', () => {
    const special = probable({
      species: 'Charizard',
      item: 'Charizardite Y',
      nature: 'Timid',
      moves: ['Heat Wave', 'Solar Beam'],
    });
    expect(special).toMatchObject({ spa: 32, spe: 32 });
  });

  it('nunca reparte más de 66 SP ni repite opciones iguales', () => {
    const options = inferSpreads({
      species: 'Garchomp',
      nature: 'Jolly',
      moves: ['Earthquake', 'Rock Slide'],
    });
    for (const o of options) expect(statTotal(o.sps)).toBeLessThanOrEqual(SP_TOTAL);
    const keys = options.map((o) => JSON.stringify(o.sps));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('spreadDistribution', () => {
  const data = new Map<string, NatureSpreads[]>([
    [
      'Garchomp',
      [
        {
          nature: 'Jolly',
          share: 0.6,
          spreads: [
            [[2, 32, 0, 0, 0, 32], 0.9],
            [[32, 32, 0, 0, 2, 0], 0.1],
          ],
        },
        { nature: 'Adamant', share: 0.4, spreads: [[[32, 32, 0, 0, 2, 0], 1]] },
      ],
    ],
    ['Garchomp-Mega-Z', [{ nature: 'Modest', share: 1, spreads: [[[2, 0, 0, 32, 0, 32], 1]] }]],
  ]);
  const chomp = { species: 'Garchomp', moves: ['Earthquake'] };

  it('pondera las naturalezas con lo visto en torneos y los repartos con Smogon', () => {
    const { source, spreads } = spreadDistribution(data, chomp, [
      ['Adamant', 0.75],
      ['Jolly', 0.25],
    ]);
    expect(source).toBe('smogon');
    expect(spreads[0]).toEqual({
      nature: 'Adamant',
      sps: { hp: 32, atk: 32, def: 0, spa: 0, spd: 2, spe: 0 },
      probability: 0.75,
    });
    expect(spreads[1].probability).toBeCloseTo(0.225);
    expect(spreads.reduce((sum, s) => sum + s.probability, 0)).toBeCloseTo(1);
  });

  it('sin datos de naturaleza usa las proporciones del ladder', () => {
    const { spreads } = spreadDistribution(data, chomp);
    expect(spreads[0].nature).toBe('Jolly');
    expect(spreads[0].probability).toBeCloseTo(0.54);
  });

  it('usa los repartos de la mega si lleva la piedra', () => {
    const { spreads } = spreadDistribution(data, { ...chomp, item: 'Garchompite Z' });
    expect(spreads).toHaveLength(1);
    expect(spreads[0].nature).toBe('Modest');
  });

  it('si la especie no está en Smogon, estima los repartos', () => {
    const { source, spreads } = spreadDistribution(data, {
      species: 'Pawmot',
      nature: 'Jolly',
      moves: ['Close Combat'],
    });
    expect(source).toBe('estimated');
    expect(spreads[0].sps).toMatchObject({ atk: 32, spe: 32 });
    expect(spreads.reduce((sum, s) => sum + s.probability, 0)).toBeCloseTo(1);
  });
});

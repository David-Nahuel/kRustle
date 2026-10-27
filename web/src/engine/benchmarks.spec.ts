import { describe, expect, it } from 'vitest';

import { type Stats, emptyStats } from './champions';
import { type Meta, type TeamsFile, buildMetagame } from './metagame';
import type { TeamMember } from './pokepaste';

import { type Goal, checkGoals, goalMoves, natureOptions, planSps } from './benchmarks';

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

// Un único equipo rival conocido: Incineroar con Sitrus y Garchomp con Scarf.
const TEAMS: TeamsFile = {
  species: ['Incineroar', 'Garchomp'],
  items: ['Sitrus Berry', 'Choice Scarf'],
  abilities: ['Intimidate', 'Rough Skin'],
  natures: ['Careful', 'Jolly'],
  moves: ['Fake Out', 'Flare Blitz', 'Earthquake', 'Dragon Claw'],
  sets: [
    [0, 0, 0, 0, [0, 1]],
    [1, 1, 1, 1, [2, 3]],
  ],
  tournaments: [{ id: 't', name: 'T', date: '2026-10-19T00:00:00Z', players: 8 }],
  teams: [[0, 3, 3, 0, 0, 1]],
  matches: [],
};

const metagame = buildMetagame(
  {
    meta: META,
    usage: [],
    teams: TEAMS,
    spreads: {
      source: { month: '2026-09', files: [], battles: 1 },
      species: {
        Garchomp: [{ nature: 'Jolly', share: 1, spreads: [[[2, 32, 0, 0, 0, 32], 1]] }],
      },
    },
  },
  new Date('2026-10-20T00:00:00Z'),
);

const me: TeamMember = {
  species: 'Rillaboom',
  item: 'Miracle Seed',
  ability: 'Grassy Surge',
  nature: 'Adamant',
  sps: { ...emptyStats(), hp: 32, atk: 32, spd: 2 },
  moves: ['Wood Hammer', 'Fake Out', 'Protect'],
};

/** El mismo Rillaboom con solo el Ataque puesto: le quedan 34 SP para los objetivos. */
const free: TeamMember = { ...me, sps: { ...emptyStats(), atk: 32 } };
const withSps = (member: TeamMember, sps: Partial<Stats>): TeamMember => ({
  ...member,
  sps: { ...member.sps, ...sps },
});
const chance = (member: TeamMember, goal: Goal) => checkGoals(metagame, member, [goal])[0];

describe('planSps', () => {
  it('ser más rápido: el mínimo de Velocidad que lo consigue', () => {
    const goal: Goal = { kind: 'outspeed', rival: 'Incineroar' };
    const plan = planSps(metagame, free, [goal]);
    if (!plan.ok) throw new Error(plan.reason);
    const spe = plan.sps.spe;
    expect(spe).toBeGreaterThan(0);
    expect(chance(withSps(free, { spe }), goal)).toBeGreaterThanOrEqual(0.9);
    expect(chance(withSps(free, { spe: spe - 1 }), goal)).toBeLessThan(0.9);
    // Solo cambia la Velocidad; lo demás se queda como estaba.
    expect(plan.sps).toEqual({ ...free.sps, spe });
    expect(plan.leftover).toBe(66 - 32 - spe);
  });

  it('aguantar: el mínimo de PS y Defensa, y ninguno sobra', () => {
    const goal: Goal = { kind: 'survive', rival: 'Incineroar', move: 'Flare Blitz' };
    const plan = planSps(metagame, free, [goal]);
    if (!plan.ok) throw new Error(plan.reason);
    const { hp, def } = plan.minimum;
    expect(plan.probabilities[0]).toBeGreaterThanOrEqual(0.9);
    expect(plan.probabilities[0]).toBeCloseTo(chance(withSps(free, { hp, def }), goal), 10);
    // Con un SP menos en cualquiera de los dos ya no llega: es el mínimo.
    if (hp > 0) expect(chance(withSps(free, { hp: hp - 1, def }), goal)).toBeLessThan(0.9);
    if (def > 0) expect(chance(withSps(free, { hp, def: def - 1 }), goal)).toBeLessThan(0.9);
    // Un ataque físico: la Defensa Especial no se toca.
    expect(plan.sps.spd).toBe(free.sps.spd);
  });

  it('Intimidate en el atacante hace falta menos', () => {
    const goal: Goal = { kind: 'survive', rival: 'Incineroar', move: 'Flare Blitz' };
    const total = (g: Goal) => {
      const plan = planSps(metagame, free, [g]);
      if (!plan.ok) throw new Error(plan.reason);
      return plan.minimum.hp + plan.minimum.def;
    };
    expect(total({ ...goal, intimidate: true })).toBeLessThan(total(goal));
  });

  it('con Tailwind hace falta menos Velocidad', () => {
    const goal: Goal = { kind: 'outspeed', rival: 'Incineroar' };
    const spe = (g: Goal) => {
      const plan = planSps(metagame, free, [g]);
      if (!plan.ok) throw new Error(plan.reason);
      return plan.sps.spe;
    };
    expect(spe({ ...goal, tailwind: true })).toBeLessThan(spe(goal));
  });

  it('un objetivo imposible lo dice, con lo más que se llega', () => {
    // Garchomp resiste Planta: Wood Hammer no lo debilita ni con todo el Ataque.
    const plan = planSps(metagame, free, [{ kind: 'ko', rival: 'Garchomp', move: 'Wood Hammer' }]);
    expect(plan).toMatchObject({ ok: false, reason: 'unreachable', goal: 0 });
  });

  it('si los objetivos no caben con los demás stats como están, dice cuántos SP faltan', () => {
    // Este Rillaboom ya tiene los 66 SP repartidos: no queda nada para la Velocidad.
    const plan = planSps(metagame, me, [{ kind: 'outspeed', rival: 'Incineroar' }]);
    expect(plan).toMatchObject({ ok: false, reason: 'tooMany', available: 0 });
    if (plan.ok || plan.reason !== 'tooMany') return;
    expect(plan.needed).toBeGreaterThan(0);
  });

  it('varios objetivos a la vez comparten los PS', () => {
    const goals: Goal[] = [
      { kind: 'survive', rival: 'Incineroar', move: 'Flare Blitz' },
      { kind: 'survive', rival: 'Garchomp', move: 'Dragon Claw' },
      { kind: 'outspeed', rival: 'Incineroar' },
    ];
    const blank = withSps(free, { atk: 0 });
    const plan = planSps(metagame, blank, goals);
    if (!plan.ok) throw new Error(plan.reason);
    for (const p of plan.probabilities) expect(p).toBeGreaterThanOrEqual(0.9);
    expect(checkGoals(metagame, { ...blank, sps: plan.sps }, goals)).toEqual(plan.probabilities);
  });
});

describe('la propuesta', () => {
  it('si ya cumple los objetivos, no quita nada aunque el mínimo sea menos', () => {
    // Rillaboom resiste Earthquake: el mínimo es 0 PS, pero no se le quitan los 32 que lleva.
    const plan = planSps(metagame, me, [
      { kind: 'survive', rival: 'Garchomp', move: 'Earthquake' },
    ]);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.minimum.hp).toBe(0);
    expect(plan.sps).toEqual(me.sps);
    expect(plan.leftover).toBe(0);
  });

  it('sube lo que falta con lo que sobra en los demás stats del objetivo', () => {
    // Todo en PS y Defensa Especial: para aguantar un ataque físico hace falta Defensa.
    const special = withSps(free, { hp: 32, def: 0, spd: 32, atk: 2 });
    const goal: Goal = { kind: 'survive', rival: 'Incineroar', move: 'Flare Blitz' };
    expect(chance(special, goal)).toBeLessThan(0.9);
    const plan = planSps(metagame, special, [goal]);
    if (!plan.ok) throw new Error(plan.reason);
    expect(chance({ ...special, sps: plan.sps }, goal)).toBeGreaterThanOrEqual(0.9);
    // La DefE y el Ataque no tienen que ver con el objetivo: no cambian.
    expect(plan.sps.spd).toBe(32);
    expect(plan.sps.atk).toBe(2);
    expect(plan.sps.hp + plan.sps.def).toBe(32);
    expect(plan.sps.def).toBeGreaterThanOrEqual(plan.minimum.def);
  });
});

describe('goalMoves', () => {
  it('los ataques del rival al aguantar y los tuyos al atacar, del más fuerte al más flojo', () => {
    // Rillaboom resiste Earthquake: Dragon Claw le hace más.
    expect(goalMoves(metagame, me, 'survive', 'Garchomp')).toEqual(['Dragon Claw', 'Earthquake']);
    // Sin Protect, que es de estado.
    expect(goalMoves(metagame, me, 'ko', 'Garchomp')).toEqual(['Wood Hammer', 'Fake Out']);
  });
});

describe('natureOptions', () => {
  const outspeed: Goal = { kind: 'outspeed', rival: 'Incineroar' };

  it('sugiere naturalezas que suben el stat del objetivo, de la que más ahorra a la que menos', () => {
    const current = planSps(metagame, free, [outspeed]);
    if (!current.ok) throw new Error(current.reason);
    const options = natureOptions(metagame, free, [outspeed]);
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.plan.needed).toBeLessThan(current.needed);
      expect(option.saved).toBe(current.needed - option.plan.needed);
    }
    expect(options.map((o) => o.plan.needed)).toEqual(
      [...options.map((o) => o.plan.needed)].sort((a, b) => a - b),
    );
    expect(options.map((o) => o.nature)).toContain('Jolly');
  });

  it('no sugiere las que bajan el stat con el que ataca', () => {
    // Rillaboom ataca con movimientos físicos: Timid (+Vel −Atq) no.
    const natures = natureOptions(metagame, free, [outspeed]).map((o) => o.nature);
    expect(natures).not.toContain('Timid');
    expect(natures).not.toContain(free.nature);
  });

  it('un movimiento de estado sin categoría no cuenta como ataque especial', () => {
    // La calculadora trae Parting Shot sin categoría: no es un ataque, así que Jolly (−AtE) vale.
    const pivot = { ...free, moves: ['Wood Hammer', 'Parting Shot'] };
    expect(natureOptions(metagame, pivot, [outspeed]).map((o) => o.nature)).toContain('Jolly');
    expect(goalMoves(metagame, pivot, 'ko', 'Garchomp')).toEqual(['Wood Hammer']);
  });

  it('a igual ahorro, primero la que baja un stat de ataque que no usa', () => {
    // Rillaboom ataca con movimientos físicos: Jolly (−AtE) antes que Hasty (−Def) o Naive (−DefE).
    const options = natureOptions(metagame, free, [outspeed]);
    const jolly = options.find((o) => o.nature === 'Jolly')!;
    for (const other of options.filter((o) => o.plan.needed === jolly.plan.needed)) {
      expect(options.indexOf(jolly)).toBeLessThanOrEqual(options.indexOf(other));
    }
  });

  it('sin objetivos, nada', () => {
    expect(natureOptions(metagame, free, [])).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';

import { emptyStats } from './champions';
import { type Meta, type TeamsFile, buildMetagame } from './metagame';
import type { TeamMember } from './pokepaste';

import { speedTiers } from './speed-tiers';
import { speedStat } from './speed';

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
    // Uso: Incineroar y Garchomp son "el meta" de estos datos.
    usage: (['Incineroar', 'Garchomp'] as const).map((species) => ({
      species,
      teams: 1,
      usage: 1,
      games: 0,
      winRate: null,
      items: [],
      abilities: [],
      natures: [],
      moves: [],
      teammates: [],
    })),
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

describe('speedTiers', () => {
  it('tus Pokémon entre los del meta, de más rápido a más lento', () => {
    const tiers = speedTiers(metagame, [me]);
    expect(tiers.map((t) => t.species).sort()).toEqual(['Garchomp', 'Incineroar', 'Rillaboom']);
    const speeds = tiers.map((t) => t.speed);
    expect(speeds).toEqual([...speeds].sort((a, b) => b - a));
    const mine = tiers.find((t) => t.member === 0)!;
    expect(mine.speed).toBe(speedStat(me));
    expect(mine.range).toEqual([mine.speed, mine.speed]);
  });

  it('del rival, su set más común: el Garchomp del meta lleva Scarf', () => {
    const garchomp = speedTiers(metagame, []).find((t) => t.species === 'Garchomp')!;
    expect(garchomp.item).toBe('Choice Scarf');
    expect(garchomp.member).toBeUndefined();
    expect(garchomp.range[0]).toBeLessThanOrEqual(garchomp.speed);
    expect(garchomp.range[1]).toBeGreaterThanOrEqual(garchomp.speed);
  });

  it('con Trick Room, al revés, y cuenta quién se mueve antes al revés', () => {
    const normal = speedTiers(metagame, [me]);
    const room = speedTiers(metagame, [me], { trickRoom: true });
    expect(room.map((t) => t.speed)).toEqual([...normal.map((t) => t.speed)].reverse());
    const before = normal.find((t) => t.member === 0)!.versus!;
    const after = room.find((t) => t.member === 0)!.versus!;
    expect(after.first).toBe(before.second);
    expect(after.second).toBe(before.first);
  });

  it('cada uno de los tuyos se compara con todos los rivales', () => {
    const tiers = speedTiers(metagame, [me]);
    const { first, second, depends } = tiers.find((t) => t.member === 0)!.versus!;
    expect(first + second + depends).toBe(tiers.filter((t) => t.member === undefined).length);
  });

  it('tu Tailwind duplica tu velocidad; el suyo, la de ellos', () => {
    const base = speedTiers(metagame, [me]);
    const mineTw = speedTiers(metagame, [me], { myTailwind: true });
    const theirsTw = speedTiers(metagame, [me], { theirTailwind: true });
    const speedOf = (tiers: typeof base, mine: boolean) =>
      tiers.find((t) => (t.member !== undefined) === mine && t.species !== 'Garchomp')!.speed;
    expect(speedOf(mineTw, true)).toBe(speedOf(base, true) * 2);
    expect(speedOf(theirsTw, false)).toBeGreaterThan(speedOf(base, false));
    expect(speedOf(theirsTw, true)).toBe(speedOf(base, true));
  });
});

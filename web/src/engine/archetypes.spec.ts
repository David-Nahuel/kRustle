import { describe, expect, it } from 'vitest';

import { archetypePaste, archetypeTeam } from './archetypes';
import { type ArchetypeSet, type Meta, type TeamsFile, buildMetagame } from './metagame';
import { parsePokepaste } from './pokepaste';

const META: Meta = {
  format: 'M-C',
  generatedAt: '2026-10-20T00:00:00Z',
  halfLifeDays: 14,
  tournaments: 0,
  teams: 0,
  matches: 0,
  firstDate: null,
  lastDate: null,
};
const NO_TEAMS: TeamsFile = {
  species: [],
  items: [],
  abilities: [],
  natures: [],
  moves: [],
  sets: [],
  tournaments: [],
  teams: [],
  matches: [],
};
// Smogon solo tiene datos de Incineroar: Careful con 32 PS / 2 Def / 32 DefEsp.
const metagame = buildMetagame({
  meta: META,
  usage: [],
  teams: NO_TEAMS,
  spreads: {
    source: { month: '2026-09', files: [], battles: 1 },
    species: {
      Incineroar: [{ nature: 'Careful', share: 1, spreads: [[[32, 0, 2, 0, 32, 0], 1]] }],
    },
  },
});

const SETS: ArchetypeSet[] = [
  {
    species: 'Incineroar',
    item: 'Sitrus Berry',
    ability: 'Intimidate',
    nature: 'Careful',
    moves: ['Fake Out', 'Flare Blitz', 'Parting Shot', 'Throat Chop'],
  },
  {
    species: 'Sneasler',
    item: 'White Herb',
    ability: 'Unburden',
    nature: 'Jolly',
    moves: ['Close Combat', 'Dire Claw', 'Protect'],
  },
];

describe('archetypeTeam', () => {
  it('pone los SP más comunes del ladder y, sin datos de Smogon, los estima', () => {
    const [incineroar, sneasler] = archetypeTeam(metagame, SETS);
    expect(incineroar.sps).toEqual({ hp: 32, atk: 0, def: 2, spa: 0, spd: 32, spe: 0 });
    expect(sneasler.sps).toMatchObject({ atk: 32, spe: 32 });
    expect(sneasler.nature).toBe('Jolly');
  });

  it('el paste se vuelve a leer igual, sin avisos', () => {
    const { members, warnings } = parsePokepaste(archetypePaste(metagame, SETS));
    expect(warnings).toEqual([]);
    expect(members.map((m) => [m.species, m.item, m.ability, m.moves.length])).toEqual([
      ['Incineroar', 'Sitrus Berry', 'Intimidate', 4],
      ['Sneasler', 'White Herb', 'Unburden', 3],
    ]);
  });
});

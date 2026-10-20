import { describe, expect, it } from 'vitest';

import { emptyStats } from './champions';
import { type Meta, type TeamsFile, buildMetagame } from './metagame';
import type { TeamMember } from './pokepaste';
import { computeMatchup, emptySide, freshStatus } from './matchup';

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

const input = {
  metagame,
  me,
  rivalTeam: ['Incineroar', 'Garchomp'],
  candidate: 0,
  field: { trickRoom: false },
  mySide: emptySide(),
  theirSide: emptySide(),
};

describe('computeMatchup', () => {
  it('usa el set inferido y los SP de Smogon del rival', () => {
    const m = computeMatchup({ ...input, rival: 'Garchomp' });
    expect(m.rivalSet.item).toBe('Choice Scarf');
    expect(m.spreads.source).toBe('smogon');
    expect(m.speed.second).toBe(1);
    // Los de estado también salen (Protect), pero sin daño.
    expect(m.myMoves.map((r) => r.move)).toEqual(['Wood Hammer', 'Fake Out', 'Protect']);
    expect(m.myMoves[2]).toMatchObject({ priority: { value: 4 } });
    expect(m.myMoves[2].odds).toBeUndefined();
    expect(m.theirMoves.map((r) => r.move)).toEqual(['Earthquake', 'Dragon Claw']);
  });

  it('Trick Room y Tailwind cambian quién se mueve antes', () => {
    const tr = computeMatchup({ ...input, rival: 'Garchomp', field: { trickRoom: true } });
    expect(tr.speed.first).toBe(1);
  });

  it('las pantallas del rival reducen mi daño y su Helping Hand aumenta el suyo', () => {
    const base = computeMatchup({ ...input, rival: 'Garchomp' });
    const reflect = computeMatchup({
      ...input,
      rival: 'Garchomp',
      theirSide: { ...emptySide(), reflect: true },
    });
    const helped = computeMatchup({
      ...input,
      rival: 'Garchomp',
      theirSide: { ...emptySide(), helpingHand: true },
    });
    expect(reflect.myMoves[0].odds!.likely.max).toBeLessThan(base.myMoves[0].odds!.likely.max);
    expect(helped.theirMoves[0].odds!.likely.max).toBeGreaterThan(
      base.theirMoves[0].odds!.likely.max,
    );
  });

  it('funciona con especies sin datos de torneos', () => {
    const m = computeMatchup({ ...input, rival: 'Pikachu', rivalTeam: ['Pikachu'] });
    expect(m.inference).toBeNull();
    expect(m.theirMoves).toEqual([]);
    expect(m.myMoves.length).toBeGreaterThan(0);
    expect(m.spreads.source).toBe('estimated');
  });

  it('los PS restantes del rival suben mi probabilidad de KO', () => {
    const full = computeMatchup({ ...input, rival: 'Garchomp' });
    const low = computeMatchup({
      ...input,
      rival: 'Garchomp',
      rivalStatus: { ...freshStatus(), hp: 25 },
    });
    expect(low.myMoves[0].odds!.ohkoChance).toBeGreaterThan(full.myMoves[0].odds!.ohkoChance);
  });

  it('una quemadura reduce el daño físico y la parálisis la velocidad', () => {
    const base = computeMatchup({ ...input, rival: 'Garchomp' });
    const burned = computeMatchup({
      ...input,
      rival: 'Garchomp',
      rivalStatus: { ...freshStatus(), status: 'brn' },
    });
    const paralyzed = computeMatchup({
      ...input,
      rival: 'Garchomp',
      rivalStatus: { ...freshStatus(), status: 'par' },
    });
    expect(burned.theirMoves[0].odds!.likely.max).toBeLessThan(base.theirMoves[0].odds!.likely.max);
    expect(paralyzed.speed.theirLikely).toBe(Math.floor(base.speed.theirLikely / 2));
  });

  it('los cambios de stat son de cada Pokémon', () => {
    const base = computeMatchup({ ...input, rival: 'Garchomp' });
    const boosted = computeMatchup({
      ...input,
      rival: 'Garchomp',
      myStatus: { hp: 100, boosts: { atk: 2 } },
    });
    expect(boosted.myMoves[0].odds!.likely.max).toBeGreaterThan(base.myMoves[0].odds!.likely.max);
  });

  it('lo revelado por el rival manda sobre la inferencia', () => {
    const m = computeMatchup({
      ...input,
      rival: 'Garchomp',
      revealed: { item: 'Life Orb', moves: ['Rock Slide'] },
    });
    expect(m.rivalSet.item).toBe('Life Orb');
    expect(m.rivalSet.moves).toContain('Rock Slide');
    expect(m.inference?.revealedMismatch).toBe(true);
  });

  it('explica por qué un ataque no afecta en lugar de ocultarlo', () => {
    const m = computeMatchup({
      ...input,
      rival: 'Garchomp',
      field: { trickRoom: false, terrain: 'Psychic' },
    });
    // Garchomp toca el suelo: Psychic Terrain bloquea el Fake Out.
    expect(m.myMoves[1]).toMatchObject({
      move: 'Fake Out',
      blocked: { code: 'psychicTerrain' },
    });
    expect(m.myMoves[1].odds).toBeUndefined();
  });

  it('Unburden duplica la velocidad al gastar el objeto', () => {
    const sneasler = {
      ...me,
      species: 'Sneasler',
      ability: 'Unburden',
      item: 'White Herb',
      nature: 'Jolly',
    };
    const base = computeMatchup({ ...input, me: sneasler, rival: 'Garchomp' });
    const unburden = computeMatchup({
      ...input,
      me: sneasler,
      rival: 'Garchomp',
      myStatus: { ...freshStatus(), itemConsumed: true },
    });
    expect(unburden.speed.mySpeed).toBe(base.speed.mySpeed * 2);
  });
});

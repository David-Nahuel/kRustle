import { describe, expect, it } from 'vitest';

import { inferSet } from './inference';
import { type Meta, type TeamsFile, buildMetagame } from './metagame';
import { groupTeams, playerIndex, playerTeams, searchPlayers } from './players';

const META: Meta = {
  format: 'M-C',
  generatedAt: '2026-10-20T00:00:00Z',
  halfLifeDays: 14,
  tournaments: 2,
  teams: 4,
  matches: 0,
  firstDate: null,
  lastDate: null,
};

// Tres jugadores con Incineroar. "zerox" siempre lo lleva con Safety Goggles; el resto, con Sitrus.
const TEAMS: TeamsFile = {
  species: ['Incineroar', 'Garchomp'],
  items: ['Sitrus Berry', 'Safety Goggles'],
  abilities: [],
  natures: [],
  moves: ['Fake Out'],
  sets: [
    [0, 0, null, null, [0]],
    [0, 1, null, null, [0]],
    [1, null, null, null, []],
  ],
  tournaments: [
    { id: 'a', name: 'Primero', date: '2026-10-01T00:00:00Z', players: 16 },
    { id: 'b', name: 'Segundo', date: '2026-10-10T00:00:00Z', players: 32 },
  ],
  teams: [
    [0, 4, 1, 0, 0, 2],
    [0, 2, 3, 0, 0, 2],
    [0, 1, 4, 0, 1, 2],
    [1, 5, 0, 0, 1, 2],
  ],
  matches: [],
  players: [
    { id: 'alice', name: 'Alice' },
    { id: 'bob99', name: 'Bob' },
    { id: 'zerox', name: 'Zero X' },
  ],
  teamPlayers: [0, 1, 2, 2],
};
const metagame = buildMetagame({ meta: META, usage: [], teams: TEAMS }, new Date('2026-10-20'));

describe('searchPlayers', () => {
  it('busca por usuario o nombre visible, sin importar mayúsculas ni espacios', () => {
    expect(searchPlayers(metagame, 'zero x').map((p) => p.id)).toEqual(['zerox']);
    expect(searchPlayers(metagame, 'BOB').map((p) => p.id)).toEqual(['bob99']);
  });

  it('cuenta los equipos y la fecha del último', () => {
    const [zerox] = searchPlayers(metagame, 'zer');
    expect(zerox.teams).toBe(2);
    expect(zerox.lastDate).toBe('2026-10-10T00:00:00Z');
  });

  it('no busca con menos de 2 letras', () => {
    expect(searchPlayers(metagame, 'a')).toEqual([]);
  });
});

describe('playerTeams', () => {
  it('lista los equipos del más reciente al más antiguo', () => {
    const teams = playerTeams(metagame, playerIndex(metagame, 'zerox')!);
    expect(teams.map((t) => t.tournament.name)).toEqual(['Segundo', 'Primero']);
    expect(teams[0].wins).toBe(5);
    expect(teams[0].sets.map((s) => s.species)).toEqual(['Incineroar', 'Garchomp']);
  });
});

describe('groupTeams', () => {
  it('junta los torneos en los que repitió equipo y suma el resultado', () => {
    const groups = groupTeams(playerTeams(metagame, playerIndex(metagame, 'zerox')!));
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
    expect([groups[0].wins, groups[0].losses]).toEqual([6, 4]);
    expect(groups[0].latest.tournament.name).toBe('Segundo');
  });
});

describe('inferSet con jugador conocido', () => {
  it('sus propios sets mandan sobre lo más usado', () => {
    const general = inferSet(metagame, 'Incineroar', ['Incineroar', 'Garchomp'])!;
    const zerox = inferSet(
      metagame,
      'Incineroar',
      ['Incineroar', 'Garchomp'],
      {},
      {
        player: playerIndex(metagame, 'zerox'),
      },
    )!;
    expect(general.fromPlayer).toBe(0);
    expect(zerox.fromPlayer).toBe(2);
    expect(zerox.candidates[0].item).toBe('Safety Goggles');
    expect(zerox.candidates[0].probability).toBeGreaterThan(0.99);
  });
});

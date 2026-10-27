import { describe, expect, it } from 'vitest';

import { type Meta, type TeamsFile, buildMetagame } from './metagame';
import { teamRecord } from './team-record';

const META: Meta = {
  format: 'M-C',
  generatedAt: '2026-10-20T00:00:00Z',
  halfLifeDays: 14,
  tournaments: 1,
  teams: 0,
  matches: 0,
  firstDate: null,
  lastDate: null,
};

const SPECIES = [
  'Rillaboom',
  'Incineroar',
  'Garchomp',
  'Kingambit',
  'Sneasler',
  'Gholdengo',
  'Pelipper',
  'Archaludon',
  'Basculegion',
  'Farigiraf',
  'Sylveon',
  'Milotic',
  'Tyranitar',
];
const MINE = SPECIES.slice(0, 6);

/** Un equipo del torneo con su resultado: `[torneo, victorias, derrotas, empates, sets…]`. */
const team = (wins: number, losses: number, species: string[]) => [
  0,
  wins,
  losses,
  0,
  ...species.map((s) => SPECIES.indexOf(s)),
];

/**
 * Datos de prueba: equipos parecidos al tuyo (5 de tus 6), un rival con Pelipper y otro sin él.
 */
function metagameWith(matches: TeamsFile['matches']) {
  const teams = [
    // 0, 1: parecidos al tuyo (sin Gholdengo y sin Sneasler).
    team(9, 1, ['Rillaboom', 'Incineroar', 'Garchomp', 'Kingambit', 'Sneasler', 'Milotic']),
    team(7, 2, ['Rillaboom', 'Incineroar', 'Garchomp', 'Kingambit', 'Gholdengo', 'Sylveon']),
    // 2: con Pelipper; 3: sin él.
    team(3, 3, ['Pelipper', 'Archaludon', 'Basculegion', 'Farigiraf', 'Sylveon', 'Tyranitar']),
    team(3, 3, ['Milotic', 'Archaludon', 'Basculegion', 'Farigiraf', 'Sylveon', 'Tyranitar']),
  ];
  const file: TeamsFile = {
    species: SPECIES,
    items: [],
    abilities: [],
    natures: [],
    moves: [],
    sets: SPECIES.map((_, i) => [i, null, null, null, []]),
    tournaments: [{ id: 't', name: 'Torneo', date: '2026-10-19T00:00:00Z', players: 64 }],
    teams,
    matches,
    players: [{ id: 'ana', name: 'Ana' }],
    teamPlayers: [0, -1, -1, -1],
  };
  return buildMetagame({ meta: META, usage: [], teams: file }, new Date('2026-10-20T00:00:00Z'));
}

/** `n` partidas del equipo `a` contra `b`, de las que `a` gana `wins`. */
function games(a: number, b: number, n: number, wins: number): TeamsFile['matches'] {
  return Array.from({ length: n }, (_, i) => [a, b, i < wins ? 1 : 2]);
}

describe('teamRecord', () => {
  const metagame = metagameWith([
    ...games(0, 2, 60, 6), // contra Pelipper: 10%
    ...games(3, 1, 120, 40), // el rival sin Pelipper gana 40 de 120: los tuyos, 80 (67%)
    ...games(0, 1, 30, 15), // espejo: no cuenta
  ]);

  it('cuenta las partidas de los equipos parecidos, sin los espejos', () => {
    const record = teamRecord(metagame, MINE)!;
    expect(record.shared).toBe(5);
    expect(record.teams).toBe(2);
    expect(record.games).toBe(180);
    expect(record.winRate).toBeCloseTo((6 + 80) / 180, 10);
    expect(record.margin).toBeGreaterThan(0);
  });

  it('destaca a los rivales contra los que les va claramente peor', () => {
    const record = teamRecord(metagame, MINE)!;
    expect(record.worst.map((v) => v.species)).toEqual(['Pelipper']);
    expect(record.worst[0]).toMatchObject({ games: 60, winRate: 0.1 });
    // Milotic solo está en el equipo sin Pelipper: les va mejor que en general.
    expect(record.best.map((v) => v.species)).toContain('Milotic');
    // Los que salen en todos los rivales no se alejan del general.
    expect([...record.worst, ...record.best].map((v) => v.species)).not.toContain('Archaludon');
  });

  it('sus mejores resultados, con torneo y jugador', () => {
    const [first] = teamRecord(metagame, MINE)!.runs;
    expect(first).toMatchObject({ tournament: 'Torneo', players: 64, player: 'Ana', wins: 9 });
  });

  it('sin bastantes partidas, nada (no se enseña ruido)', () => {
    const few = metagameWith(games(0, 2, 20, 10));
    expect(teamRecord(few, MINE)).toBeUndefined();
  });

  it('con menos de 4 Pokémon no hay con qué comparar', () => {
    expect(teamRecord(metagame, MINE.slice(0, 3))).toBeUndefined();
  });
});

import type { Metagame } from './metagame';

/**
 * Partidas al 50% que se suman a cada winrate sacado de los enfrentamientos, para que unos pocos
 * resultados no manden (un 3-0 se queda cerca del 50%).
 */
export const SPECIES_PRIOR_GAMES = 20;

/** Puntos (victoria 1, empate 0,5) y partidas. */
interface Tally {
  points: number;
  games: number;
}

interface VersusTable {
  /** Especie → resultados de los equipos que la llevan contra los que no (sin mirrors). */
  species: Map<string, Tally>;
  /** "X|Y" → resultados de equipos con X (y sin Y) contra equipos con Y (y sin X). */
  pairs: Map<string, Tally>;
}

const tables = new WeakMap<Metagame, VersusTable>();

/** Se calcula una vez por conjunto de datos (unas 24.000 partidas, decenas de ms). */
function table(metagame: Metagame): VersusTable {
  let cached = tables.get(metagame);
  if (cached) return cached;
  cached = { species: new Map(), pairs: new Map() };
  const add = (map: Map<string, Tally>, key: string, points: number) => {
    const tally = map.get(key) ?? { points: 0, games: 0 };
    tally.points += points;
    tally.games += 1;
    map.set(key, tally);
  };
  for (const [a, b, result] of metagame.matches) {
    const pointsA = result === 1 ? 1 : result === 2 ? 0 : 0.5;
    const teamA = metagame.teamSpecies[a];
    const teamB = metagame.teamSpecies[b];
    for (const [mine, theirs, points] of [
      [teamA, teamB, pointsA],
      [teamB, teamA, 1 - pointsA],
    ] as const) {
      for (const x of mine) {
        if (theirs.includes(x)) continue;
        add(cached.species, x, points);
        for (const y of theirs) if (!mine.includes(y)) add(cached.pairs, `${x}|${y}`, points);
      }
    }
  }
  tables.set(metagame, cached);
  return cached;
}

/** Winrate acercado al 50% según la muestra, menos 0,5 (positivo = gana más de lo que pierde). */
function edge(tally: Tally | undefined): number {
  if (!tally) return 0;
  return (tally.points + SPECIES_PRIOR_GAMES / 2) / (tally.games + SPECIES_PRIOR_GAMES) - 0.5;
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * Lo que dicen los enfrentamientos reales de un equipo contra otro, desde el lado de `mine`:
 *
 * - `species`: cuánto mejor rinden sus especies que las del rival en general.
 * - `matchups`: cómo les ha ido a sus especies contra las del rival en concreto.
 *
 * Los dos son 0 cuando no hay ventaja; positivos, a favor de `mine`.
 */
export function matchupFeatures(
  metagame: Metagame,
  mine: readonly string[],
  theirs: readonly string[],
): { species: number; matchups: number } {
  const { species, pairs } = table(metagame);
  const strength = (team: readonly string[]) => average(team.map((s) => edge(species.get(s))));
  const versus: number[] = [];
  for (const x of mine) {
    if (theirs.includes(x)) continue;
    for (const y of theirs) if (!mine.includes(y)) versus.push(edge(pairs.get(`${x}|${y}`)));
  }
  return { species: strength(mine) - strength(theirs), matchups: average(versus) };
}

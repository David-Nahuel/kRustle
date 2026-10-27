import type { Metagame } from './metagame';

/**
 * Cómo les ha ido en torneos a los equipos parecidos al tuyo (los que comparten casi todos sus
 * Pokémon) y contra qué rivales les ha ido peor o mejor.
 *
 * Es descriptivo, no una predicción: son partidas de otros jugadores, y quién gana depende sobre
 * todo de quién juega (ver `npm run validate-pick`). Para un enfrentamiento concreto (tu equipo
 * contra el suyo) no hay muestra; contra el meta entero, sí.
 */

/** Con menos partidas, el historial es ruido y no se enseña. */
export const MIN_GAMES = 50;
/** Lo mínimo para hablar de un rival concreto. */
const MIN_VERSUS_GAMES = 50;
/**
 * Para destacar un rival se pide más que el 95% habitual (z = 1,96): se miran unos 80 a la vez y
 * con el 95% saldrían ~4 por puro azar. Con el 99% (z = 2,58), menos de uno.
 */
const VERSUS_Z = 2.58;
/** Diferencia mínima con el winrate general para destacar un rival, aunque sea "seguro". */
const MIN_EDGE = 0.03;
const MAX_VERSUS = 5;
const MAX_BEST = 3;

export interface VersusSpecies {
  species: string;
  games: number;
  winRate: number;
  /** Diferencia con el winrate general de estos equipos. */
  delta: number;
}

export interface BestRun {
  tournament: string;
  date: string;
  players: number;
  player?: string;
  wins: number;
  losses: number;
  ties: number;
  species: string[];
}

export interface TeamRecord {
  /** Pokémon que comparten con el tuyo como mínimo (5 si hay muestra; si no, 4). */
  shared: number;
  teams: number;
  games: number;
  /** Empates a medias. */
  winRate: number;
  /** Margen del 95% del winrate (±). */
  margin: number;
  /** Rivales contra los que les va claramente peor o mejor que en general. */
  worst: VersusSpecies[];
  best: VersusSpecies[];
  /** Sus mejores resultados en torneos. */
  runs: BestRun[];
}

/**
 * Historial de los equipos parecidos a `team` (especies). `undefined` si no hay bastantes
 * partidas ni bajando a 4 Pokémon en común, o si el equipo tiene menos de 4.
 */
export function teamRecord(metagame: Metagame, team: readonly string[]): TeamRecord | undefined {
  const mine = new Set(team);
  if (mine.size < 4) return undefined;
  const sharedOf = metagame.teamSpecies.map((species) => species.filter((s) => mine.has(s)).length);

  for (const shared of [Math.min(5, mine.size), 4]) {
    const similar = (i: number) => sharedOf[i] >= shared;
    let games = 0;
    let points = 0;
    const versus = new Map<string, { games: number; points: number }>();
    for (const [a, b, result] of metagame.matches) {
      // Los espejos (dos equipos parecidos al tuyo) no dicen nada: uno gana y otro pierde.
      if (similar(a) === similar(b)) continue;
      const [rival, score] = similar(a)
        ? [b, result === 1 ? 1 : result === 0 ? 0.5 : 0]
        : [a, result === 2 ? 1 : result === 0 ? 0.5 : 0];
      games++;
      points += score;
      for (const species of metagame.teamSpecies[rival]) {
        const v = versus.get(species) ?? { games: 0, points: 0 };
        v.games++;
        v.points += score;
        versus.set(species, v);
      }
    }
    if (games < MIN_GAMES) continue;

    const winRate = points / games;
    const rivals = [...versus]
      .filter(([, v]) => v.games >= MIN_VERSUS_GAMES)
      .map(([species, v]): VersusSpecies => {
        const rate = v.points / v.games;
        return { species, games: v.games, winRate: rate, delta: rate - winRate };
      })
      // Solo lo que se aleja del general más de lo que daría el azar con esas partidas.
      .filter((v) => Math.abs(v.delta) >= Math.max(MIN_EDGE, margin(winRate, v.games, VERSUS_Z)));
    const teams = sharedOf.filter((n) => n >= shared).length;
    return {
      shared,
      teams,
      games,
      winRate,
      margin: margin(winRate, games),
      worst: rivals
        .filter((v) => v.delta < 0)
        .sort((x, y) => x.delta - y.delta)
        .slice(0, MAX_VERSUS),
      best: rivals
        .filter((v) => v.delta > 0)
        .sort((x, y) => y.delta - x.delta)
        .slice(0, MAX_VERSUS),
      runs: bestRuns(metagame, sharedOf, shared),
    };
  }
  return undefined;
}

/** Margen de un winrate `p` con `n` partidas (al 95% por defecto). */
function margin(p: number, n: number, z = 1.96): number {
  return z * Math.sqrt((p * (1 - p)) / n);
}

/** Los mejores resultados: más victorias que derrotas, y a igualdad, el torneo más grande. */
function bestRuns(metagame: Metagame, sharedOf: number[], shared: number): BestRun[] {
  return sharedOf
    .map((n, team) => ({ n, team }))
    .filter(({ n }) => n >= shared)
    .map(({ team }) => {
      const info = metagame.teamInfo[team];
      const tournament = metagame.tournaments[info.tournament];
      const player = metagame.players[metagame.teamPlayer[team]];
      return {
        tournament: tournament.name,
        date: tournament.date,
        players: tournament.players,
        player: player?.name,
        wins: info.wins,
        losses: info.losses,
        ties: info.ties,
        species: metagame.teamSpecies[team],
      };
    })
    .sort((a, b) => b.wins - b.losses - (a.wins - a.losses) || b.players - a.players)
    .slice(0, MAX_BEST);
}

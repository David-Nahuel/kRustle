import type { DamageOdds } from './damage';
import { type MoveRow, matchupAgainst, rivalProfile } from './matchup';
import type { Metagame } from './metagame';
import type { TeamMember } from './pokepaste';

/**
 * Amenazas del metajuego para un equipo: daño y velocidad de cada uno de sus Pokémon contra los
 * más usados del formato (con su set más probable y megaevolucionados si llevan piedra).
 *
 * No es una probabilidad de ganar: con los datos de torneos, quién gana depende casi todo de los
 * jugadores (ver `npm run validate-pick`). Son los mismos cálculos de la calculadora, resumidos.
 */

/** A partir de esta probabilidad, un KO se da por hecho al resumir. */
const LIKELY = 0.5;

export interface Hit {
  move: string;
  odds: DamageOdds;
}

export interface ThreatDuel {
  /** Índice en mi equipo. */
  member: number;
  /** Mi ataque que más le hace y el suyo que más me hace (sin ninguno que afecte, nada). */
  mine?: Hit;
  theirs?: Hit;
  /** Probabilidad de moverme antes sin contar prioridad (empates a medias). */
  first: number;
}

export interface Threat {
  species: string;
  usage: number;
  duels: ThreatDuel[];
  /** Mi mejor respuesta: quien más fácil la debilita. */
  answer?: ThreatDuel;
  /** Nadie de mi equipo la debilita en dos golpes. */
  unanswered: boolean;
  /** De cuántos de mi equipo se encarga de un golpe. */
  ohkos: number;
  /** Cuántos de mi equipo se mueven antes que ella. */
  faster: number;
  /** Para ordenar: más alto, más peligrosa. */
  danger: number;
}

/** El ataque que más rápido debilita: primero por KO de un golpe, luego en dos, luego daño. */
function strongest(rows: readonly MoveRow[]): Hit | undefined {
  const key = (odds: DamageOdds) => [odds.ohkoChance, odds.twoHkoChance, odds.likely.maxPercent];
  /** Compara por orden: el primer valor distinto decide. */
  const beats = (a: number[], b: number[]) => {
    const i = a.findIndex((x, k) => x !== b[k]);
    return i >= 0 && a[i] > b[i];
  };
  let best: Hit | undefined;
  for (const row of rows) {
    if (row.odds && (!best || beats(key(row.odds), key(best.odds)))) {
      best = { move: row.move, odds: row.odds };
    }
  }
  return best;
}

export function analyzeThreat(
  metagame: Metagame,
  team: readonly TeamMember[],
  species: string,
): Threat {
  // Sin compañeros conocidos: el set más probable de la especie en general.
  const profile = rivalProfile(metagame, species, [species]);
  const duels: ThreatDuel[] = team.map((me, member) => {
    const m = matchupAgainst(me, profile, { field: { trickRoom: false }, moves: metagame.moves });
    return {
      member,
      mine: strongest(m.myMoves),
      theirs: strongest(m.theirMoves),
      first: m.speed.first + m.speed.tie / 2,
    };
  });

  const kills = (hit?: Hit) => hit?.odds.twoHkoChance ?? 0;
  // La mejor respuesta: quien la debilita de un golpe y, si no, en dos; moverse antes desempata.
  const answerScore = (d: ThreatDuel) =>
    (d.mine?.odds.ohkoChance ?? 0) + kills(d.mine) + d.first * 0.25;
  const answer = duels
    .filter((d) => d.mine)
    .reduce<ThreatDuel | undefined>(
      (best, d) => (!best || answerScore(d) > answerScore(best) ? d : best),
      undefined,
    );
  const unanswered = kills(answer?.mine) < LIKELY;
  const ohkos = duels.filter((d) => (d.theirs?.odds.ohkoChance ?? 0) >= LIKELY).length;
  const faster = duels.filter((d) => d.first > LIKELY).length;
  const size = Math.max(team.length, 1);
  return {
    species,
    usage: metagame.usage.get(species)?.usage ?? 0,
    duels,
    answer,
    unanswered,
    ohkos,
    faster,
    danger:
      (unanswered ? 1 : 0) + (1 - kills(answer?.mine)) + ohkos / size + (1 - faster / size) * 0.5,
  };
}

/** Los Pokémon más usados del formato, sin los que ya llevo (no son una amenaza "de fuera"). */
export function metaThreats(metagame: Metagame, team: readonly TeamMember[], count = 20): string[] {
  const mine = new Set(team.map((m) => m.species));
  return [...metagame.usage.keys()].filter((s) => !mine.has(s)).slice(0, count);
}

/**
 * De más a menos peligrosa; a igual peligro, primero la más usada. Los empates son frecuentes y
 * por redondeo no siempre son exactos (0,75 frente a 0,7500000000000002): se comparan con margen.
 */
export function byDanger(a: Threat, b: Threat): number {
  const diff = b.danger - a.danger;
  return Math.abs(diff) > 1e-9 ? diff : b.usage - a.usage;
}

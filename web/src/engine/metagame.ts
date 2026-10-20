import type { MoveCatalog, MoveInfo } from './moves';

/** Tipos de los JSON que genera el pipeline (`pipeline/src/aggregate.rs`). */

export interface Meta {
  format: string;
  generatedAt: string;
  halfLifeDays: number;
  tournaments: number;
  teams: number;
  matches: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Mes ("2026-09") de las estadísticas de Smogon usadas para los SP, si las hay. */
  spreadsMonth?: string | null;
}

/** `[nombre, proporción]`. En movimientos es "sets que lo llevan" (suman ~4). */
export type Shares = [string, number][];

export interface SpeciesUsage {
  species: string;
  teams: number;
  usage: number;
  games: number;
  winRate: number | null;
  items: Shares;
  abilities: Shares;
  natures: Shares;
  moves: Shares;
  teammates: Shares;
}

/** `[especie, objeto, habilidad, naturaleza, [movimientos]]` como índices a las tablas. */
export type SetRow = [number, number | null, number | null, number | null, number[]];

export interface TeamsFile {
  species: string[];
  items: string[];
  abilities: string[];
  natures: string[];
  moves: string[];
  sets: SetRow[];
  tournaments: Tournament[];
  /** `[torneo, victorias, derrotas, empates, set1, …, set6]` */
  teams: number[][];
  /** `[equipoA, equipoB, resultado]`: 1 gana A, 2 gana B, 0 empate. */
  matches: [number, number, 0 | 1 | 2][];
  /** Jugadores (usuario de Limitless y último nombre visible). Ausente en datos antiguos. */
  players?: Player[];
  /** Índice en `players` del jugador de cada equipo. */
  teamPlayers?: number[];
}

export interface Player {
  id: string;
  name: string;
}

export interface Tournament {
  id: string;
  name: string;
  date: string;
  players: number;
}

/** SP en el orden de Showdown: PS / Atq / Def / AtEsp / DefEsp / Vel. */
export type SpTuple = [number, number, number, number, number, number];

export interface NatureSpreads {
  nature: string;
  /** Proporción de la especie que usa esta naturaleza. */
  share: number;
  /** Repartos más comunes con esta naturaleza; las probabilidades suman 1 dentro de ella. */
  spreads: [SpTuple, number][];
}

/** `spreads.json`: repartos reales de Smogon por forma de combate (las megas van aparte). */
export interface SpreadsFile {
  source: { month: string; files: string[]; battles: number };
  species: Record<string, NatureSpreads[]>;
}

/** `roster.json`: Pokémon y objetos legales, según el editor de equipos de Showdown. */
export interface RosterFile {
  /** Lo que se ve en team preview (sin megas ni formas de combate). */
  species: { name: string; sprite: string }[];
  /** Por orden alfabético; la posición de cada uno es la de su icono en `sprites/items.webp`. */
  items: string[];
  /** Movimientos legales con prioridad, objetivo y flags (la calculadora los trae incompletos). */
  moves?: Record<string, MoveInfo>;
}

export interface DecodedSet {
  species: string;
  item?: string;
  ability?: string;
  nature?: string;
  moves: string[];
}

/** Datos del formato ya indexados para consultas rápidas. */
export interface Metagame {
  meta: Meta;
  usage: Map<string, SpeciesUsage>;
  /** Especies de cada equipo, por índice de equipo. */
  teamSpecies: string[][];
  /** Peso de cada equipo según antigüedad y resultado (misma fórmula que el pipeline). */
  teamWeight: number[];
  sets: DecodedSet[];
  /** Especie → apariciones (equipo, set). */
  occurrences: Map<string, { team: number; set: number }[]>;
  /** Forma de combate → repartos de SP por naturaleza (vacío si no hay datos de Smogon). */
  spreads: Map<string, NatureSpreads[]>;
  tournaments: Tournament[];
  /** Torneo y resultado de cada equipo. */
  teamInfo: { tournament: number; wins: number; losses: number; ties: number; sets: number[] }[];
  players: Player[];
  /** Jugador de cada equipo (-1 si no se sabe). */
  teamPlayer: number[];
  /** Jugador → sus equipos, del más antiguo al más reciente. */
  playerTeams: Map<number, number[]>;
  /** Pokémon legales (vacío si no hay `roster.json`). */
  legalSpecies: string[];
  /** Objeto → posición de su icono en `sprites/items.webp`. */
  itemIcons: Map<string, number>;
  moves: MoveCatalog;
}

export interface MetagameFiles {
  meta: Meta;
  usage: SpeciesUsage[];
  teams: TeamsFile;
  spreads?: SpreadsFile;
  roster?: RosterFile;
}

const DAY_MS = 86_400_000;

export function buildMetagame(
  { meta, usage, teams: file, spreads, roster }: MetagameFiles,
  now: Date = new Date(),
): Metagame {
  const sets: DecodedSet[] = file.sets.map(([species, item, ability, nature, moves]) => ({
    species: file.species[species],
    item: item === null ? undefined : file.items[item],
    ability: ability === null ? undefined : file.abilities[ability],
    nature: nature === null ? undefined : file.natures[nature],
    moves: moves.map((m) => file.moves[m]),
  }));

  const tournamentAge = file.tournaments.map((t) =>
    Math.max(0, (now.getTime() - new Date(t.date).getTime()) / DAY_MS),
  );

  const teamSpecies: string[][] = [];
  const teamWeight: number[] = [];
  const occurrences = new Map<string, { team: number; set: number }[]>();
  const teamInfo: Metagame['teamInfo'] = [];
  const teamPlayer = file.teams.map((_, team) => file.teamPlayers?.[team] ?? -1);
  const playerTeams = new Map<number, number[]>();

  file.teams.forEach(([tournament, wins, losses, ties, ...setIds], team) => {
    teamInfo.push({ tournament, wins, losses, ties, sets: setIds });
    const player = teamPlayer[team];
    if (player >= 0) {
      let list = playerTeams.get(player);
      if (!list) playerTeams.set(player, (list = []));
      list.push(team);
    }
    const recency = 0.5 ** (tournamentAge[tournament] / meta.halfLifeDays);
    const winRate = (wins + 1) / (wins + losses + 2);
    teamWeight.push(recency * (0.5 + winRate));
    teamSpecies.push(setIds.map((s) => sets[s].species));
    for (const set of setIds) {
      const species = sets[set].species;
      let list = occurrences.get(species);
      if (!list) occurrences.set(species, (list = []));
      list.push({ team, set });
    }
  });

  return {
    meta,
    usage: new Map(usage.map((u) => [u.species, u])),
    teamSpecies,
    teamWeight,
    sets,
    occurrences,
    spreads: new Map(Object.entries(spreads?.species ?? {})),
    tournaments: file.tournaments,
    teamInfo,
    players: file.players ?? [],
    teamPlayer,
    playerTeams,
    legalSpecies: roster?.species.map((s) => s.name) ?? [],
    itemIcons: new Map(roster?.items.map((item, i) => [item, i])),
    moves: new Map(Object.entries(roster?.moves ?? {})),
  };
}

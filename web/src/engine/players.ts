import type { DecodedSet, Metagame, Tournament } from './metagame';

export interface PlayerMatch {
  index: number;
  id: string;
  name: string;
  teams: number;
  lastDate: string;
}

export interface PlayerTeam {
  team: number;
  tournament: Tournament;
  wins: number;
  losses: number;
  ties: number;
  sets: DecodedSet[];
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '');

/**
 * Busca por usuario de Limitless o nombre visible. Primero los que empiezan por lo escrito,
 * luego los que lo contienen; a igualdad, quien más equipos tiene.
 */
export function searchPlayers(metagame: Metagame, query: string, limit = 8): PlayerMatch[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const scored: { rank: number; match: PlayerMatch }[] = [];
  metagame.players.forEach((player, index) => {
    const teams = metagame.playerTeams.get(index);
    if (!teams?.length) return;
    const keys = [normalize(player.id), normalize(player.name)];
    const rank = keys.some((k) => k.startsWith(q)) ? 0 : keys.some((k) => k.includes(q)) ? 1 : -1;
    if (rank < 0) return;
    const last = metagame.teamInfo[teams[teams.length - 1]].tournament;
    scored.push({
      rank,
      match: {
        index,
        id: player.id,
        name: player.name,
        teams: teams.length,
        lastDate: metagame.tournaments[last].date,
      },
    });
  });
  return scored
    .sort((a, b) => a.rank - b.rank || b.match.teams - a.match.teams)
    .slice(0, limit)
    .map((s) => s.match);
}

/** Equipos de un jugador, del más reciente al más antiguo. */
export function playerTeams(metagame: Metagame, player: number): PlayerTeam[] {
  return (metagame.playerTeams.get(player) ?? [])
    .map((team) => {
      const info = metagame.teamInfo[team];
      return {
        team,
        tournament: metagame.tournaments[info.tournament],
        wins: info.wins,
        losses: info.losses,
        ties: info.ties,
        sets: info.sets.map((s) => metagame.sets[s]),
      };
    })
    .reverse();
}

export function playerIndex(metagame: Metagame, id: string): number | undefined {
  const index = metagame.players.findIndex((p) => p.id === id);
  return index >= 0 ? index : undefined;
}

export interface TeamGroup {
  /** El uso más reciente de este equipo. */
  latest: PlayerTeam;
  /** Torneos en los que lo ha llevado y resultado sumado. */
  count: number;
  wins: number;
  losses: number;
  ties: number;
}

/** Agrupa los equipos con los mismos 6 Pokémon (la gente repite equipo torneo tras torneo). */
export function groupTeams(teams: readonly PlayerTeam[]): TeamGroup[] {
  const groups = new Map<string, TeamGroup>();
  for (const t of teams) {
    const key = t.sets
      .map((s) => s.species)
      .sort()
      .join('|');
    const group = groups.get(key);
    if (group) {
      group.count++;
      group.wins += t.wins;
      group.losses += t.losses;
      group.ties += t.ties;
    } else {
      groups.set(key, { latest: t, count: 1, wins: t.wins, losses: t.losses, ties: t.ties });
    }
  }
  return [...groups.values()];
}

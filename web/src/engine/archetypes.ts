import { emptyStats } from './champions';
import type { ArchetypeSet, Metagame } from './metagame';
import { type TeamMember, formatMember } from './pokepaste';
import { spreadDistribution } from './spreads';

/**
 * Los sets de un arquetipo como equipo propio. Limitless no publica los Stat Points: se ponen los
 * más comunes en el ladder de Showdown para esa naturaleza o, sin datos de Smogon, una estimación.
 */
export function archetypeTeam(metagame: Metagame, sets: readonly ArchetypeSet[]): TeamMember[] {
  return sets.map((set) => {
    const member = {
      species: set.species,
      item: set.item ?? undefined,
      ability: set.ability ?? undefined,
      nature: set.nature ?? undefined,
      moves: set.moves.slice(0, 4),
    };
    const [spread] = spreadDistribution(metagame.spreads, member).spreads;
    return {
      ...member,
      nature: member.nature ?? spread?.nature,
      sps: spread?.sps ?? emptyStats(),
    };
  });
}

/** El mismo equipo en formato Showdown, para guardarlo en "Mi equipo". */
export function archetypePaste(metagame: Metagame, sets: readonly ArchetypeSet[]): string {
  return archetypeTeam(metagame, sets).map(formatMember).join('\n\n');
}

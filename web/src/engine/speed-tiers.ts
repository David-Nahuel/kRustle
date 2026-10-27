import { quantile } from './damage';
import { typicalProfile } from './matchup';
import type { Metagame } from './metagame';
import type { TeamMember } from './pokepaste';
import { speedStat } from './speed';

/**
 * Tabla de velocidades: tus Pokémon entre los más usados del formato, de más rápido a más lento
 * (al revés con Trick Room). De cada rival, su set más común y sus repartos del ladder.
 */

export interface SpeedTierOptions {
  myTailwind?: boolean;
  theirTailwind?: boolean;
  trickRoom?: boolean;
}

export interface SpeedEntry {
  species: string;
  /** Índice en tu equipo; sin definir si es un rival del meta. */
  member?: number;
  item?: string;
  /** Con el reparto más probable (o tus SP). */
  speed: number;
  /** El 90% central de sus repartos (igual que `speed` en los tuyos). */
  range: [number, number];
  /** Uso en el formato (solo los rivales). */
  usage?: number;
  /** En los tuyos: de cuántos rivales te mueves antes, después, o depende del reparto. */
  versus?: { first: number; second: number; depends: number };
}

/** Por encima de esta probabilidad, te mueves antes (o después) "seguro" al contarlo. */
const CLEAR = 0.9;

export function speedTiers(
  metagame: Metagame,
  team: readonly TeamMember[],
  { myTailwind, theirTailwind, trickRoom }: SpeedTierOptions = {},
  count = 30,
): SpeedEntry[] {
  const rivals = [...metagame.usage.keys()].slice(0, count).map((species) => {
    const { set, spreads } = typicalProfile(metagame, species);
    // Velocidad con cada reparto posible, y su probabilidad.
    const speeds = spreads.spreads.map(({ nature, sps, probability }) => ({
      speed: speedStat(
        { species: set.species, item: set.item, ability: set.ability, nature, sps },
        { tailwind: theirTailwind },
      ),
      probability,
    }));
    const pairs = speeds.map((v): [number, number] => [v.speed, v.probability]);
    const entry: SpeedEntry = {
      species,
      item: set.item,
      speed: speeds[0]?.speed ?? 0,
      range: pairs.length ? [quantile(pairs, 0.05), quantile(pairs, 0.95)] : [0, 0],
      usage: metagame.usage.get(species)?.usage,
    };
    return { entry, speeds };
  });

  const mine = team.map((member, index): SpeedEntry => {
    const speed = speedStat(member, { tailwind: myTailwind });
    const versus = { first: 0, second: 0, depends: 0 };
    for (const { speeds } of rivals) {
      // Probabilidad de moverte antes; un empate cuenta a medias (es un 50%).
      const first = speeds.reduce(
        (sum, v) =>
          sum +
          v.probability *
            (speed === v.speed ? 0.5 : (trickRoom ? speed < v.speed : speed > v.speed) ? 1 : 0),
        0,
      );
      if (first >= CLEAR) versus.first++;
      else if (first <= 1 - CLEAR) versus.second++;
      else versus.depends++;
    }
    return {
      species: member.species,
      member: index,
      item: member.item,
      speed,
      range: [speed, speed],
      versus,
    };
  });

  // De más rápido a más lento (al revés con Trick Room); a igual velocidad, los tuyos primero.
  const order = trickRoom ? 1 : -1;
  return [...mine, ...rivals.map((r) => r.entry)].sort(
    (a, b) =>
      order * (a.speed - b.speed) ||
      Number(b.member !== undefined) - Number(a.member !== undefined),
  );
}

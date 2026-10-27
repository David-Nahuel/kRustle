import { SP_PER_STAT, SP_TOTAL, STAT_IDS, type StatId, type Stats, getMove } from './champions';
import { type Distribution, atLeast, damageDistribution } from './combined';
import { type Combatant, type FieldState, damageRolls, maxHp } from './damage';
import { type RivalProfile, rivalProfile } from './matchup';
import type { Metagame } from './metagame';
import type { TeamMember } from './pokepaste';
import { speedStat } from './speed';

/**
 * Objetivos de Stat Points ("aguantar el Moonblast de Flutter Mane", "ser más rápido que
 * Garchomp") y el reparto mínimo que los cumple, con la naturaleza que ya lleva.
 *
 * Del rival se usa su set más común en torneos y sus repartos del ladder, así que cada objetivo
 * se cumple con una probabilidad: la suma de los repartos (y las tiradas de daño) en que sale.
 */

export type Goal =
  | { kind: 'survive'; rival: string; move: string; helpingHand?: boolean; intimidate?: boolean }
  | { kind: 'ko'; rival: string; move: string; helpingHand?: boolean }
  | { kind: 'outspeed'; rival: string; tailwind?: boolean };

/** Probabilidad a partir de la que un objetivo se da por cumplido. */
export const GOAL_CONFIDENCE = 0.9;

export type Plan =
  | {
      ok: true;
      /** Lo que se propone: los SP que faltan, sacados de lo que sobra en los demás. */
      sps: Stats;
      /** Lo mínimo que cumple los objetivos en los stats de los que dependen. */
      minimum: Stats;
      /** Probabilidad de cada objetivo con `sps`. */
      probabilities: number[];
      /** SP sin repartir en `sps` (solo si ya había SP sin repartir). */
      leftover: number;
    }
  /** Ni con 32 SP se cumple este objetivo; `best` es lo más que se llega. */
  | { ok: false; reason: 'unreachable'; goal: number; best: number }
  /** Cada uno se puede cumplir, pero juntos (con los demás stats como están) no caben. */
  | { ok: false; reason: 'tooMany'; needed: number; available: number; stats: StatId[] };

interface Evaluator {
  /** Stats de los que depende (vacío si no depende de ninguno: Foul Play usa el Ataque rival). */
  stats: StatId[];
  probability(sps: Stats): number;
}

/** Probabilidad de cumplir cada objetivo con los SP que lleva ahora. */
export function checkGoals(
  metagame: Metagame,
  member: TeamMember,
  goals: readonly Goal[],
): number[] {
  return goals.map((goal) => evaluator(metagame, member, goal).probability(member.sps));
}

/**
 * Cómo cumplir todos los objetivos (con `confidence` de probabilidad) moviendo los menos SP posibles.
 *
 * Primero se busca el mínimo que los cumple en los stats de los que dependen. La propuesta no es
 * ese mínimo a secas, que dejaría sin PS a quien ya aguanta lo pedido: sube lo que falta y lo que
 * sobra vuelve a donde estaba (PS primero). Los stats que no tocan los objetivos no cambian.
 */
export function planSps(
  metagame: Metagame,
  member: TeamMember,
  goals: readonly Goal[],
  confidence = GOAL_CONFIDENCE,
): Plan {
  const evaluators = goals.map((goal) => evaluator(metagame, member, goal));
  const involved = STAT_IDS.filter((s) => evaluators.some((e) => e.stats.includes(s)));
  const fixed = STAT_IDS.filter((s) => !involved.includes(s));
  const available = SP_TOTAL - fixed.reduce((sum, s) => sum + member.sps[s], 0);
  const withStats = (values: Partial<Stats>): Stats => ({ ...member.sps, ...values });

  // Cada objetivo por separado, con todo lo que le afecta al máximo: si ni así, no hay plan.
  for (const [i, e] of evaluators.entries()) {
    const best = e.probability(withStats(Object.fromEntries(e.stats.map((s) => [s, SP_PER_STAT]))));
    if (best < confidence) return { ok: false, reason: 'unreachable', goal: i, best };
  }

  // Los PS los comparten los objetivos de aguantar: se prueba cada valor y, con él, cada otro
  // stat por separado sube hasta cumplir lo suyo (más SP nunca empeora un objetivo).
  const hpValues = involved.includes('hp')
    ? Array.from({ length: SP_PER_STAT + 1 }, (_, i) => i)
    : [member.sps.hp];
  let best: Stats | undefined;
  let bestTotal = Infinity;
  for (const hp of hpValues) {
    const values: Partial<Stats> = { hp };
    let feasible = true;
    for (const stat of involved.filter((s) => s !== 'hp')) {
      const own = evaluators.filter((e) => e.stats.includes(stat));
      let value = 0;
      const meets = () =>
        own.every((e) => e.probability(withStats({ ...values, [stat]: value })) >= confidence);
      while (value <= SP_PER_STAT && !meets()) value++;
      if (value > SP_PER_STAT) {
        feasible = false;
        break;
      }
      values[stat] = value;
    }
    // Los de solo PS (o ninguno) también tienen que cumplirse con este valor.
    if (!feasible || evaluators.some((e) => e.probability(withStats(values)) < confidence)) {
      continue;
    }
    const total = involved.reduce((sum, s) => sum + (values[s] ?? 0), 0);
    // A igual coste, más PS: también ayudan contra lo que no está en los objetivos.
    if (total < bestTotal || (total === bestTotal && hp > (best?.hp ?? -1))) {
      best = withStats(values);
      bestTotal = total;
    }
  }

  if (!best) return { ok: false, reason: 'unreachable', goal: 0, best: 0 };
  if (bestTotal > available) {
    return { ok: false, reason: 'tooMany', needed: bestTotal, available, stats: involved };
  }
  const minimum = best;
  const proposal = { ...minimum };
  let spare = available - bestTotal;
  for (const stat of involved) {
    const back = Math.min(spare, Math.max(0, member.sps[stat] - minimum[stat]));
    proposal[stat] += back;
    spare -= back;
  }
  return {
    ok: true,
    sps: proposal,
    minimum,
    probabilities: evaluators.map((e) => e.probability(proposal)),
    leftover: spare,
  };
}

/**
 * Los movimientos de daño que se ofrecen para un objetivo (los suyos al aguantar, los tuyos al
 * atacar), del que más daño hace al que menos con su reparto más probable: el primero es el
 * objetivo que de verdad importa.
 */
export function goalMoves(
  metagame: Metagame,
  member: TeamMember,
  kind: Goal['kind'],
  rival: string,
): string[] {
  const profile = profileOf(metagame, rival);
  const likely = profile.spreads.spreads[0];
  const them: Combatant = {
    species: profile.set.species,
    item: profile.set.item,
    ability: profile.set.ability,
    nature: likely?.nature,
    sps: likely?.sps ?? member.sps,
  };
  const [attacker, defender] = kind === 'survive' ? [them, member] : [member, them];
  const moves = kind === 'survive' ? profile.set.moves : member.moves;
  // Daño máximo, sumando los golpes de los de varios impactos.
  const damage = (move: string) =>
    (damageRolls(attacker, defender, move) ?? []).reduce((sum, hit) => sum + Math.max(...hit), 0);
  return moves
    .filter((m) => {
      const move = getMove(m);
      return move && move.category !== 'Status';
    })
    .map((move) => ({ move, damage: damage(move) }))
    .sort((a, b) => b.damage - a.damage)
    .map(({ move }) => move);
}

function evaluator(metagame: Metagame, member: TeamMember, goal: Goal): Evaluator {
  const profile = profileOf(metagame, goal.rival);
  const me = (sps: Stats): Combatant => ({ ...member, sps });
  const rivals = profile.spreads.spreads.map(({ nature, sps, probability }) => ({
    combatant: {
      species: profile.set.species,
      item: profile.set.item,
      ability: profile.set.ability,
      nature,
      sps,
    } satisfies Combatant,
    probability,
  }));

  switch (goal.kind) {
    case 'survive': {
      const move = getMove(goal.move);
      const defense: StatId =
        (move?.overrideDefensiveStat as StatId | undefined) ??
        (move?.category === 'Physical' ? 'def' : 'spd');
      const field: FieldState = { helpingHand: goal.helpingHand };
      // El daño solo depende de la defensa (los PS no cambian las tiradas, solo el umbral).
      const rolls = memo((value: number) =>
        rivals.map(({ combatant, probability }) => {
          const hits = damageRolls(
            { ...combatant, boosts: goal.intimidate ? { atk: -1 } : undefined },
            me({ ...member.sps, [defense]: value }),
            goal.move,
            field,
          );
          const none: Distribution = [[0, 1]];
          return { dist: hits ? damageDistribution(hits) : none, probability };
        }),
      );
      const hp = memo((value: number) => maxHp(me({ ...member.sps, hp: value })));
      return {
        stats: ['hp', defense],
        probability: (sps) => {
          const max = hp(sps.hp);
          return rolls(sps[defense]).reduce(
            (sum, { dist, probability }) => sum + probability * (1 - atLeast(dist, max)),
            0,
          );
        },
      };
    }
    case 'ko': {
      const move = getMove(goal.move);
      const attack: StatId | undefined =
        move?.overrideOffensivePokemon === 'target'
          ? undefined
          : ((move?.overrideOffensiveStat as StatId | undefined) ??
            (move?.category === 'Physical' ? 'atk' : 'spa'));
      const field: FieldState = { helpingHand: goal.helpingHand };
      const targets = rivals.map(({ combatant, probability }) => ({
        combatant,
        probability,
        hp: maxHp(combatant),
      }));
      const chance = memo((value: number) =>
        targets.reduce((sum, { combatant, probability, hp }) => {
          const sps = attack ? { ...member.sps, [attack]: value } : member.sps;
          const hits = damageRolls(me(sps), combatant, goal.move, field);
          return sum + (hits ? probability * atLeast(damageDistribution(hits), hp) : 0);
        }, 0),
      );
      return {
        stats: attack ? [attack] : [],
        probability: (sps) => chance(attack ? sps[attack] : 0),
      };
    }
    case 'outspeed': {
      const theirs = rivals.map(({ combatant, probability }) => ({
        speed: speedStat(combatant),
        probability,
      }));
      const chance = memo((value: number) => {
        const mine = speedStat(me({ ...member.sps, spe: value }), { tailwind: goal.tailwind });
        return theirs.reduce(
          (sum, { speed, probability }) =>
            sum + probability * (mine > speed ? 1 : mine === speed ? 0.5 : 0),
          0,
        );
      });
      return { stats: ['spe'], probability: (sps) => chance(sps.spe) };
    }
  }
}

/** Set más probable del rival (como si lo vieras sin conocer a sus compañeros) y sus repartos. */
function profileOf(metagame: Metagame, rival: string): RivalProfile {
  return rivalProfile(metagame, rival, [rival]);
}

function memo<T>(compute: (value: number) => T): (value: number) => T {
  const cache = new Map<number, T>();
  return (value) => {
    if (!cache.has(value)) cache.set(value, compute(value));
    return cache.get(value)!;
  };
}

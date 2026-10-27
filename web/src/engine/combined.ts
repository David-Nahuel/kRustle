import { battleAbility } from './champions';
import { type Combatant, type FieldState, currentHp, damageRolls, maxHp, quantile } from './damage';
import type { Matchup } from './matchup';
import type { WeightedSpread } from './spreads';

/**
 * Daño combinado: dos Pokémon del mismo lado golpean al mismo objetivo en un turno ("¿lo
 * debilitan entre los dos?"). En dobles es la pregunta habitual, y la calculadora solo resuelve
 * golpes sueltos.
 *
 * Cada golpe tira su daño por separado, así que la probabilidad de KO sale de combinar las 16
 * tiradas de uno con las del otro. Como no se sabe quién golpea antes, se hace la media de los
 * dos órdenes, que solo importa con Sitrus Berry (se come tras el primer golpe si lo deja a la
 * mitad o menos) y con Multiscale o Shadow Shield (solo reducen el primero).
 */

/** Un ataque del golpe doble. `spreads` si no se conocen los SP de quien ataca (el rival). */
export interface ComboAttack {
  attacker: Combatant;
  move: string;
  spreads?: readonly WeightedSpread[];
}

export interface ComboOdds {
  /** Probabilidad de debilitarlo entre los dos, sumando sobre los repartos posibles. */
  koChance: number;
  /** Daño de los dos golpes juntos (% de los PS máximos) con los repartos más probables. */
  likely: { minPercent: number; maxPercent: number };
  /** Rango de daño conjunto (%) que cubre el 90% central de los repartos. */
  percentRange: [number, number];
}

/** Reducen el daño mientras el defensor tiene todos sus PS: solo el primer golpe. */
const FULL_HP_SHIELDS = new Set(['Multiscale', 'Shadow Shield']);

/** Daño total de un ataque (sumando sus golpes) y su probabilidad, de menor a mayor. */
type Distribution = [damage: number, probability: number][];

interface Hit {
  /** Contra el defensor como está. */
  fresh: Distribution;
  /** Contra el defensor ya golpeado (distinto solo si pierde Multiscale con el primer golpe). */
  hurt: Distribution;
}

/**
 * Daño combinado de dos ataques contra `defender`. Los repartos desconocidos van en el ataque
 * (`ComboAttack.spreads`) o en `defenderSpreads`. `null` si alguno de los dos no hace daño.
 */
export function comboOdds(
  first: ComboAttack,
  second: ComboAttack,
  defender: Combatant,
  field: FieldState = {},
  defenderSpreads?: readonly WeightedSpread[],
): ComboOdds | null {
  let koChance = 0;
  let likely: ComboOdds['likely'] | undefined;
  const mins: [number, number][] = [];
  const maxes: [number, number][] = [];

  const firstAttackers = variants(first.attacker, first.spreads);
  const secondAttackers = variants(second.attacker, second.spreads);
  for (const target of variants(defender, defenderSpreads)) {
    const max = maxHp(target.combatant);
    const hp = Math.max(1, currentHp(max, target.combatant.hpPercent ?? 100));
    const healing = sitrusHeal(target.combatant, max);
    const shielded = hp === max && hasFullHpShield(target.combatant);
    const hits = (attackers: typeof firstAttackers, move: string): Hit[] | null => {
      const result: Hit[] = [];
      for (const { combatant } of attackers) {
        const hit = hitAgainst(combatant, target.combatant, move, field, shielded);
        if (!hit) return null;
        result.push(hit);
      }
      return result;
    };
    const firstHits = hits(firstAttackers, first.move);
    const secondHits = hits(secondAttackers, second.move);
    if (!firstHits || !secondHits) return null;

    firstHits.forEach((a, i) => {
      secondHits.forEach((b, j) => {
        const probability =
          target.probability * firstAttackers[i].probability * secondAttackers[j].probability;
        const chance = (koInOrder(a, b, hp, max, healing) + koInOrder(b, a, hp, max, healing)) / 2;
        koChance += probability * chance;
        const minPercent = round1(((a.fresh[0][0] + b.fresh[0][0]) / max) * 100);
        const maxPercent = round1(((a.fresh.at(-1)![0] + b.fresh.at(-1)![0]) / max) * 100);
        likely ??= { minPercent, maxPercent };
        mins.push([minPercent, probability]);
        maxes.push([maxPercent, probability]);
      });
    });
  }
  if (!likely) return null;
  return {
    koChance: Math.min(1, koChance),
    likely,
    percentRange: [quantile(mins, 0.05), quantile(maxes, 0.95)],
  };
}

/**
 * Golpe doble a partir de dos enfrentamientos con el mismo rival (`mine`: mi Pokémon y un
 * compañero contra él) o contra mi Pokémon (`theirs`: el rival y un compañero suyo). Cada uno
 * trae ya sus estados, cambios de stat y el campo visto desde su lado.
 */
export function comboFromMatchups(
  side: 'mine' | 'theirs',
  main: Matchup,
  partner: Matchup,
  [mainMove, partnerMove]: [string, string],
): ComboOdds | null {
  if (side === 'mine') {
    return comboOdds(
      { attacker: main.mine, move: mainMove },
      { attacker: partner.mine, move: partnerMove },
      main.theirs,
      main.myField,
      main.spreads.spreads,
    );
  }
  return comboOdds(
    { attacker: main.theirs, move: mainMove, spreads: main.spreads.spreads },
    { attacker: partner.theirs, move: partnerMove, spreads: partner.spreads.spreads },
    main.mine,
    main.theirField,
  );
}

/** Cada reparto posible con su probabilidad, o el propio Pokémon si sus SP se conocen. */
function variants(
  combatant: Combatant,
  spreads?: readonly WeightedSpread[],
): { combatant: Combatant; probability: number }[] {
  if (!spreads?.length) return [{ combatant, probability: 1 }];
  return spreads.map(({ nature, sps, probability }) => ({
    combatant: { ...combatant, nature, sps },
    probability,
  }));
}

function hitAgainst(
  attacker: Combatant,
  defender: Combatant,
  move: string,
  field: FieldState,
  shielded: boolean,
): Hit | null {
  const rolls = damageRolls(attacker, defender, move, field);
  if (!rolls) return null;
  const fresh = distribution(rolls);
  if (!shielded) return { fresh, hurt: fresh };
  // Cualquier PS por debajo del máximo vale: el escudo ya no está.
  const hurt = damageRolls(attacker, { ...defender, hpPercent: 99 }, move, field);
  return { fresh, hurt: hurt ? distribution(hurt) : fresh };
}

/**
 * Probabilidad de KO si `a` golpea antes que `b`. Si `a` lo deja a la mitad o menos sin
 * debilitarlo, se come la Sitrus Berry (`healing` PS) antes de que llegue `b`.
 */
function koInOrder(a: Hit, b: Hit, hp: number, max: number, healing: number): number {
  let chance = 0;
  for (const [damage, probability] of a.fresh) {
    if (damage >= hp) {
      chance += probability;
      continue;
    }
    let left = hp - damage;
    if (healing && left <= Math.floor(max / 2)) left += healing;
    chance += probability * atLeast(b.hurt, left);
  }
  return chance;
}

function atLeast(dist: Distribution, damage: number): number {
  let chance = 0;
  for (const [value, probability] of dist) if (value >= damage) chance += probability;
  return chance;
}

/** Suma las tiradas de cada golpe (cada golpe tira las suyas por separado). */
function distribution(hits: number[][]): Distribution {
  let totals = new Map<number, number>([[0, 1]]);
  for (const rolls of hits) {
    const next = new Map<number, number>();
    for (const [sum, p] of totals) {
      for (const roll of rolls) {
        next.set(sum + roll, (next.get(sum + roll) ?? 0) + p / rolls.length);
      }
    }
    totals = next;
  }
  return [...totals].sort((x, y) => x[0] - y[0]);
}

function sitrusHeal(defender: Combatant, max: number): number {
  return defender.item === 'Sitrus Berry' && !defender.itemConsumed ? Math.floor(max / 4) : 0;
}

function hasFullHpShield(c: Combatant): boolean {
  return FULL_HP_SHIELDS.has(battleAbility(c.species, c.item, c.ability, c.mega) ?? '');
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

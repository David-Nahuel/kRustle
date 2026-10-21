import { Field, Move, Pokemon, calculate } from '@smogon/calc';

import { GEN, type Stats, battleForme, getItem, getMove, getSpecies } from './champions';
import type { WeightedSpread } from './spreads';

export interface Combatant {
  species: string;
  item?: string;
  ability?: string;
  nature?: string;
  sps: Stats;
  /** Cambios de stat (-6 a +6), p. ej. `{ atk: -1 }` tras un Intimidate. */
  boosts?: Partial<Stats>;
  status?: 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz';
  /** PS actuales en porcentaje (por defecto 100). */
  hpPercent?: number;
  /** Ya ha gastado o perdido el objeto (Sitrus, Focus Sash, White Herb, Knock Off...). */
  itemConsumed?: boolean;
  /**
   * Ha megaevolucionado (si lleva su piedra). Sin definir se supone que sí, como al planificar;
   * en la partida empieza en `false` hasta que megaevoluciona.
   */
  mega?: boolean;
}

export interface FieldState {
  weather?: 'Sun' | 'Rain' | 'Sand' | 'Snow';
  terrain?: 'Electric' | 'Grassy' | 'Psychic' | 'Misty';
  helpingHand?: boolean;
  reflect?: boolean;
  lightScreen?: boolean;
  auroraVeil?: boolean;
  friendGuard?: boolean;
  criticalHit?: boolean;
}

export interface DamageResult {
  move: string;
  /** Daño mínimo y máximo, en PS y en porcentaje de los PS máximos del defensor. */
  min: number;
  max: number;
  minPercent: number;
  maxPercent: number;
  /** "guaranteed OHKO", "75% chance to 2HKO"... */
  koText: string;
  /** Golpes necesarios para debilitar si siempre sale el daño mínimo. */
  hitsToKo: number;
  /** Menor número de golpes con alguna posibilidad de KO (0 si no llega en 4) y esa posibilidad (0–1). */
  ko: { hits: number; chance: number };
  description: string;
}

export interface DamageOdds {
  /** Resultado con el reparto más probable. */
  likely: DamageResult;
  /** Probabilidad de KO de un golpe / en dos golpes, sumando sobre los repartos posibles. */
  ohkoChance: number;
  twoHkoChance: number;
  /** Rango de daño (%) que cubre el 90% central de los repartos. */
  percentRange: [number, number];
}

/** Calcula el daño de un movimiento en dobles. Devuelve `null` si el movimiento no hace daño. */
export function calcDamage(
  attacker: Combatant,
  defender: Combatant,
  moveName: string,
  field: FieldState = {},
): DamageResult | null {
  const moveData = getMove(moveName);
  if (!moveData || moveData.category === 'Status') return null;

  const atk = toCalcPokemon(attacker);
  const def = toCalcPokemon(defender);
  const move = new Move(GEN, moveData.name, { isCrit: field.criticalHit });
  const result = calculate(
    GEN,
    atk,
    def,
    move,
    new Field({
      gameType: 'Doubles',
      weather: field.weather,
      terrain: field.terrain,
      attackerSide: { isHelpingHand: field.helpingHand },
      defenderSide: {
        isReflect: field.reflect,
        isLightScreen: field.lightScreen,
        isAuroraVeil: field.auroraVeil,
        isFriendGuard: field.friendGuard,
      },
    }),
  );

  const [min, max] = result.range();
  if (max === 0) return null;
  const maxHP = def.maxHP();
  const ko = result.kochance(false);
  const koHits = ko.n ?? 0;
  return {
    move: moveData.name,
    min,
    max,
    minPercent: round1((min / maxHP) * 100),
    maxPercent: round1((max / maxHP) * 100),
    koText: ko.text,
    ko: { hits: koHits, chance: koHits ? (ko.chance ?? 1) : 0 },
    hitsToKo: Math.ceil(def.curHP() / Math.max(min, 1)),
    description: result.desc(),
  };
}

/**
 * Daño cuando los SP de uno de los dos lados se desconocen (el rival): se calcula con cada
 * reparto posible y se resumen las probabilidades de KO.
 */
export function damageOverSpreads(
  attacker: Combatant,
  defender: Combatant,
  moveName: string,
  unknown: 'attacker' | 'defender',
  spreads: readonly WeightedSpread[],
  field: FieldState = {},
): DamageOdds | null {
  const results: { result: DamageResult; probability: number }[] = [];
  for (const { nature, sps, probability } of spreads) {
    const withSpread = (c: Combatant) => ({ ...c, nature, sps });
    const result =
      unknown === 'attacker'
        ? calcDamage(withSpread(attacker), defender, moveName, field)
        : calcDamage(attacker, withSpread(defender), moveName, field);
    if (!result) return null;
    results.push({ result, probability });
  }
  if (!results.length) return null;

  let ohkoChance = 0;
  let twoHkoChance = 0;
  for (const { result, probability } of results) {
    const { hits, chance } = result.ko;
    if (hits === 1) {
      ohkoChance += probability * chance;
      twoHkoChance += probability;
    } else if (hits === 2) {
      twoHkoChance += probability * chance;
    }
  }
  return {
    likely: results[0].result,
    ohkoChance,
    twoHkoChance,
    percentRange: [
      quantile(
        results.map((r) => [r.result.minPercent, r.probability]),
        0.05,
      ),
      quantile(
        results.map((r) => [r.result.maxPercent, r.probability]),
        0.95,
      ),
    ],
  };
}

/** Cuantil ponderado: el menor valor cuya probabilidad acumulada alcanza `q`. */
function quantile(values: [number, number][], q: number): number {
  const sorted = [...values].sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((sum, [, w]) => sum + w, 0);
  let acc = 0;
  for (const [value, w] of sorted) {
    acc += w;
    if (acc >= q * total) return value;
  }
  return sorted[sorted.length - 1][0];
}

export function toCalcPokemon(c: Combatant): Pokemon {
  // Sin objeto ya no hay mega posible si no la había, pero la mega no se deshace: se mantiene la forma.
  const item = c.itemConsumed && !getItem(c.item ?? '')?.megaStone ? undefined : c.item;
  const forme = battleForme(c.species, c.item, c.mega);
  const isMega = forme.includes('-Mega') && forme !== (getSpecies(c.species)?.name ?? c.species);
  const options = {
    item,
    // Al megaevolucionar cambia la habilidad: se deja que la librería use la de la mega.
    ability: isMega ? undefined : c.ability,
    nature: c.nature,
    evs: c.sps,
    boosts: c.boosts,
    status: c.status,
  };
  const pokemon = new Pokemon(GEN, forme, options);
  if (c.hpPercent === undefined || c.hpPercent >= 100) return pokemon;
  const curHP = Math.max(1, currentHp(pokemon.maxHP(), c.hpPercent));
  return new Pokemon(GEN, forme, { ...options, curHP });
}

/** PS máximos a nivel 50, con sus SP y naturaleza, en la forma con la que combate. */
export function maxHp(c: Combatant): number {
  return toCalcPokemon({ ...c, hpPercent: undefined }).maxHP();
}

/**
 * PS a partir del porcentaje guardado. Se redondea (no se trunca) para que los PS de tu Pokémon,
 * que se guardan como porcentaje, vuelvan exactos: 87 de 175 PS es el 49,71…%, y vuelve a ser 87.
 */
export function currentHp(max: number, percent: number): number {
  return Math.round((max * percent) / 100);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

import { type Combatant, type FieldState, toCalcPokemon } from './damage';
import type { WeightedSpread } from './spreads';

export interface SpeedContext {
  field?: FieldState;
  tailwind?: boolean;
}

/** Habilidades que duplican la velocidad con un clima o terreno, y cuál. */
export const WEATHER_SPEED: Record<string, Pick<FieldState, 'weather' | 'terrain'>> = {
  'Swift Swim': { weather: 'Rain' },
  Chlorophyll: { weather: 'Sun' },
  'Sand Rush': { weather: 'Sand' },
  'Slush Rush': { weather: 'Snow' },
  'Surge Surfer': { terrain: 'Electric' },
};

/** Si la habilidad duplica la velocidad con este clima o terreno. */
export function weatherBoosted(ability: string | undefined, field: FieldState): boolean {
  const needs = ability ? WEATHER_SPEED[ability] : undefined;
  if (!needs) return false;
  return needs.weather ? field.weather === needs.weather : field.terrain === needs.terrain;
}

/**
 * Velocidad efectiva en combate, con el mismo orden de redondeos que Showdown:
 * cambios de stat → modificadores encadenados (Scarf, Tailwind, habilidad) → parálisis.
 */
export function speedStat(
  c: Combatant,
  { field = {}, tailwind = false }: SpeedContext = {},
): number {
  const pokemon = toCalcPokemon(c);
  const ability = pokemon.ability ?? '';
  let speed = pokemon.rawStats.spe;

  const stage = Math.max(-6, Math.min(6, c.boosts?.spe ?? 0));
  speed = Math.floor(stage >= 0 ? (speed * (2 + stage)) / 2 : (speed * 2) / (2 - stage));

  let modifier = 4096;
  if (c.item === 'Choice Scarf' && !c.itemConsumed) modifier = chain(modifier, 6144);
  // Unburden: velocidad doble en cuanto pierde el objeto.
  if (ability === 'Unburden' && c.itemConsumed) modifier = chain(modifier, 8192);
  if (tailwind) modifier = chain(modifier, 8192);
  if (weatherBoosted(ability, field)) modifier = chain(modifier, 8192);
  if (ability === 'Quick Feet' && c.status) modifier = chain(modifier, 6144);
  speed = pokeRound((speed * modifier) / 4096);

  if (c.status === 'par' && ability !== 'Quick Feet') speed = Math.floor(speed / 2);
  return speed;
}

export interface SpeedComparison {
  mySpeed: number;
  /** Velocidad del rival con su reparto más probable, y mínima/máxima entre los posibles. */
  theirLikely: number;
  theirRange: [number, number];
  /** Probabilidad de moverte antes, empatar o moverte después (Trick Room ya aplicado). */
  first: number;
  tie: number;
  second: number;
}

export function compareSpeed(
  me: Combatant,
  them: Omit<Combatant, 'nature' | 'sps'>,
  theirSpreads: readonly WeightedSpread[],
  options: {
    field?: FieldState;
    myTailwind?: boolean;
    theirTailwind?: boolean;
    trickRoom?: boolean;
  } = {},
): SpeedComparison {
  const { field, myTailwind, theirTailwind, trickRoom } = options;
  const mySpeed = speedStat(me, { field, tailwind: myTailwind });

  let faster = 0;
  let tie = 0;
  let slower = 0;
  const speeds = theirSpreads.map(({ nature, sps, probability }) => {
    const theirs = speedStat({ ...them, nature, sps }, { field, tailwind: theirTailwind });
    if (mySpeed > theirs) faster += probability;
    else if (mySpeed === theirs) tie += probability;
    else slower += probability;
    return theirs;
  });

  return {
    mySpeed,
    theirLikely: speeds[0],
    theirRange: [Math.min(...speeds), Math.max(...speeds)],
    first: trickRoom ? slower : faster,
    tie,
    second: trickRoom ? faster : slower,
  };
}

/** `chainModify` de Showdown: multiplica modificadores en base 4096 redondeando. */
function chain(previous: number, next: number): number {
  return (previous * next + 2048) >> 12;
}

/** Redondeo de Showdown: x.5 hacia abajo. */
function pokeRound(x: number): number {
  return x % 1 > 0.5 ? Math.ceil(x) : Math.floor(x);
}

import { GEN, type Stats, battleAbility, battleForme, getMove, getSpecies } from './champions';
import type { FieldState } from './damage';

/** Datos de un movimiento que la calculadora de daño no trae (o trae incompletos). */
export interface MoveInfo {
  type: string;
  category: 'Physical' | 'Special' | 'Status';
  priority: number;
  /** "normal", "self", "allySide", "allAdjacentFoes"... (como en Showdown). */
  target: string;
  /** Subconjunto de flags de Showdown: powder, heal, sound, bullet, wind, contact, reflectable. */
  flags: string[];
}

export type MoveCatalog = ReadonlyMap<string, MoveInfo>;

/** Quien usa un movimiento o lo recibe. */
export interface Actor {
  species: string;
  item?: string;
  ability?: string;
  hpPercent?: number;
  /** Ha megaevolucionado (ver `Combatant.mega`). */
  mega?: boolean;
}

/** Objetivos que apuntan al rival (los únicos a los que afectan bloqueos e inmunidades). */
const AT_OPPONENT = new Set([
  'normal',
  'any',
  'adjacentFoe',
  'allAdjacentFoes',
  'allAdjacent',
  'randomNormal',
]);
const IGNORES_ABILITIES = new Set(['Mold Breaker', 'Teravolt', 'Turboblaze']);
const BLOCKS_PRIORITY = new Set(['Armor Tail', 'Queenly Majesty', 'Dazzling']);

/** Habilidades que anulan un tipo de ataque. */
const TYPE_ABSORBERS: Record<string, string[]> = {
  Electric: ['Lightning Rod', 'Volt Absorb', 'Motor Drive'],
  Water: ['Water Absorb', 'Storm Drain', 'Dry Skin'],
  Fire: ['Flash Fire', 'Well-Baked Body'],
  Grass: ['Sap Sipper'],
  Ground: ['Levitate', 'Earth Eater'],
};
const FLAG_BLOCKERS: Record<string, string> = {
  sound: 'Soundproof',
  bullet: 'Bulletproof',
  wind: 'Wind Rider',
};
/** Movimientos de estado que no afectan a ciertos tipos. */
const STATUS_TYPE_IMMUNITIES: Record<string, string[]> = {
  'Thunder Wave': ['Electric', 'Ground'],
  'Will-O-Wisp': ['Fire'],
  Toxic: ['Poison', 'Steel'],
  'Poison Powder': ['Poison', 'Steel'],
  'Leech Seed': ['Grass'],
};

/** Datos del movimiento: los del roster de Champions o, si no están, los de la calculadora. */
export function moveInfo(catalog: MoveCatalog | undefined, name: string): MoveInfo | undefined {
  const known = catalog?.get(name);
  if (known) return known;
  const move = getMove(name);
  if (!move) return undefined;
  return {
    type: move.type,
    category: move.category ?? 'Status',
    priority: move.priority ?? 0,
    // La calculadora solo trae el objetivo de los ataques en área.
    target: move.target ?? 'normal',
    flags: Object.keys(move.flags ?? {}),
  };
}

export interface Priority {
  value: number;
  /** Lo que la cambia respecto a la del movimiento ("Prankster", "Grassy Terrain"...). */
  source?: string;
}

/** Prioridad real del movimiento según la habilidad de quien lo usa y el campo. */
export function effectivePriority(
  name: string,
  info: MoveInfo,
  user: Actor,
  field: FieldState = {},
): Priority {
  const ability = battleAbility(user.species, user.item, user.ability, user.mega);
  const base = info.priority;
  if (name === 'Grassy Glide' && field.terrain === 'Grassy') {
    return { value: base + 1, source: 'Grassy Terrain' };
  }
  if (ability === 'Prankster' && info.category === 'Status') {
    return { value: base + 1, source: 'Prankster' };
  }
  if (ability === 'Gale Wings' && info.type === 'Flying' && (user.hpPercent ?? 100) >= 100) {
    return { value: base + 1, source: 'Gale Wings' };
  }
  if (ability === 'Triage' && info.flags.includes('heal')) {
    return { value: base + 3, source: 'Triage' };
  }
  return { value: base };
}

/**
 * Por qué un movimiento no afecta al objetivo. Es un código con sus datos, no una frase: la
 * interfaz lo traduce al idioma elegido.
 */
export type BlockReason =
  /** Armor Tail, Queenly Majesty y Dazzling paran la prioridad. */
  | { code: 'blockedByAbility'; ability: string }
  | { code: 'psychicTerrain' }
  | { code: 'pranksterDark' }
  /** Good as Gold, Levitate, Volt Absorb, Soundproof... */
  | { code: 'immuneByAbility'; ability: string }
  | { code: 'airBalloon' }
  | { code: 'magicBounce' }
  | { code: 'powder' }
  /** Thunder Wave a tipo Tierra, Will-O-Wisp a tipo Fuego... */
  | { code: 'statusType'; type: string }
  /** Inmunidad de tipo de un ataque (Normal contra Fantasma...). */
  | { code: 'typeImmune' }
  /** La calculadora no le hace daño por algo que no se detecta antes. */
  | { code: 'noDamage' };

/**
 * Por qué el movimiento no afecta al objetivo, o `undefined` si le afecta. Cubre bloqueos de
 * prioridad, Prankster contra tipo Siniestro, inmunidades de tipo y de habilidad.
 */
export function blockReason(
  name: string,
  info: MoveInfo,
  priority: Priority,
  user: Actor,
  target: Actor,
  field: FieldState = {},
): BlockReason | undefined {
  if (!AT_OPPONENT.has(info.target)) return undefined;

  const types: readonly string[] =
    getSpecies(battleForme(target.species, target.item, target.mega))?.types ?? [];
  const userAbility = battleAbility(user.species, user.item, user.ability, user.mega) ?? '';
  const ignoresAbility = IGNORES_ABILITIES.has(userAbility);
  const ability = ignoresAbility
    ? ''
    : (battleAbility(target.species, target.item, target.ability, target.mega) ?? '');
  const grounded =
    !types.includes('Flying') && ability !== 'Levitate' && target.item !== 'Air Balloon';

  if (priority.value > 0) {
    if (BLOCKS_PRIORITY.has(ability)) return { code: 'blockedByAbility', ability };
    if (field.terrain === 'Psychic' && grounded) return { code: 'psychicTerrain' };
  }
  if (priority.source === 'Prankster' && types.includes('Dark')) {
    return { code: 'pranksterDark' };
  }

  if (info.category === 'Status') {
    if (ability === 'Good as Gold') return { code: 'immuneByAbility', ability };
    if (ability === 'Magic Bounce' && info.flags.includes('reflectable')) {
      return { code: 'magicBounce' };
    }
    if (
      info.flags.includes('powder') &&
      (types.includes('Grass') || ability === 'Overcoat' || target.item === 'Safety Goggles')
    ) {
      return { code: 'powder' };
    }
    const immuneType = STATUS_TYPE_IMMUNITIES[name]?.find((t) => types.includes(t));
    if (immuneType) return { code: 'statusType', type: immuneType };
    return undefined;
  }

  if (effectiveness(info.type, types) === 0) return { code: 'typeImmune' };
  if (info.type === 'Ground' && target.item === 'Air Balloon') return { code: 'airBalloon' };
  if (TYPE_ABSORBERS[info.type]?.includes(ability)) return { code: 'immuneByAbility', ability };
  for (const [flag, blocker] of Object.entries(FLAG_BLOCKERS)) {
    if (info.flags.includes(flag) && ability === blocker) {
      return { code: 'immuneByAbility', ability };
    }
  }
  return undefined;
}

function effectiveness(attackType: string, defenderTypes: readonly string[]): number {
  const chart = [...GEN.types].find((t) => t.name === attackType)?.effectiveness as
    Record<string, number> | undefined;
  return defenderTypes.reduce((x, t) => x * (chart?.[t] ?? 1), 1);
}

/**
 * Lo que le hace Intimidate a quien lo recibe, según su habilidad: la de la mega solo si ya ha
 * megaevolucionado (con `mega` sin definir, la base: Intimidate salta al entrar, antes de la mega).
 * Defiant y Competitive salen ganando; Clear Body y compañía, inmunes.
 */
export function intimidateEffect(target: Actor): Partial<Stats> {
  if (target.item === 'Clear Amulet') return {};
  const ability = target.mega
    ? battleAbility(target.species, target.item, target.ability)
    : target.ability;
  switch (ability) {
    case 'Clear Body':
    case 'White Smoke':
    case 'Full Metal Body':
    case 'Hyper Cutter':
    case 'Inner Focus':
    case 'Oblivious':
    case 'Own Tempo':
    case 'Scrappy':
    case 'Mirror Armor':
      return {};
    case 'Defiant':
      return { atk: 1 };
    case 'Contrary':
    case 'Guard Dog':
      return { atk: 1 };
    case 'Competitive':
      return { atk: -1, spa: 2 };
    case 'Rattled':
      return { atk: -1, spe: 1 };
    case 'Simple':
      return { atk: -2 };
    default:
      return { atk: -1 };
  }
}

/** Suma cambios de stat sin pasarse de ±6. */
export function addBoosts(boosts: Partial<Stats>, delta: Partial<Stats>): Partial<Stats> {
  const result: Partial<Stats> = { ...boosts };
  for (const [stat, value] of Object.entries(delta) as [keyof Stats, number][]) {
    result[stat] = Math.max(-6, Math.min(6, (result[stat] ?? 0) + value));
  }
  return result;
}

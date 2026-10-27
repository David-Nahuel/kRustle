import type { Stats } from './champions';
import { type Combatant, type DamageOdds, type FieldState, damageOverSpreads } from './damage';
import { type Revealed, type SetInference, inferSet } from './inference';
import type { DecodedSet, Metagame } from './metagame';
import {
  type BlockReason,
  type MoveCatalog,
  type MoveInfo,
  type Priority,
  blockReason,
  effectivePriority,
  moveInfo,
} from './moves';
import type { TeamMember } from './pokepaste';
import { type SpeedComparison, compareSpeed } from './speed';
import { type SpreadDistribution, spreadDistribution } from './spreads';

/** Lo que afecta a un lado del campo. */
export interface SideConditions {
  tailwind: boolean;
  helpingHand: boolean;
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
  friendGuard: boolean;
}

/** Estado de un Pokémon concreto durante el combate. */
export interface BattleStatus {
  /** PS restantes en porcentaje (0 = debilitado). */
  hp: number;
  status?: Combatant['status'];
  /** Cambios de stat (-6 a +6). */
  boosts: Partial<Stats>;
  /** Ha gastado o perdido el objeto (activa Unburden). */
  itemConsumed?: boolean;
  /** Ha megaevolucionado. Sin definir se supone que sí (ver `Combatant.mega`). */
  mega?: boolean;
}

export function freshStatus(): BattleStatus {
  return { hp: 100, boosts: {} };
}

export interface FieldConditions {
  weather?: FieldState['weather'];
  terrain?: FieldState['terrain'];
  trickRoom: boolean;
  /** Todos los ataques, de los dos lados, como golpe crítico. */
  criticalHit?: boolean;
}

/** Ataques en área: en dobles hacen el 75% si golpean a más de un objetivo. */
const SPREAD_TARGETS = new Set(['allAdjacentFoes', 'allAdjacent']);

/** Habilidades que ponen clima o terreno al entrar (o al megaevolucionar). */
export const WEATHER_SETTERS: Record<string, FieldConditions['weather']> = {
  Drizzle: 'Rain',
  Drought: 'Sun',
  'Sand Stream': 'Sand',
  'Snow Warning': 'Snow',
};
export const TERRAIN_SETTERS: Record<string, FieldConditions['terrain']> = {
  'Grassy Surge': 'Grassy',
  'Electric Surge': 'Electric',
  'Psychic Surge': 'Psychic',
  'Misty Surge': 'Misty',
};

export function emptySide(): SideConditions {
  return {
    tailwind: false,
    helpingHand: false,
    reflect: false,
    lightScreen: false,
    auroraVeil: false,
    friendGuard: false,
  };
}

/** Un movimiento en el enfrentamiento: de daño o de estado. */
export interface MoveRow {
  move: string;
  info?: MoveInfo;
  priority: Priority;
  /** Por qué no afecta al rival (bloqueado o inmune); entonces no hay `odds`. */
  blocked?: BlockReason;
  /** Solo en movimientos de daño que afectan. */
  odds?: DamageOdds;
  /** En los ataques en área, el daño si golpea a un solo objetivo (ver `singleTargetOdds`). */
  singleTarget?: DamageOdds;
}

/** Lo que suponemos del rival: su set y sus repartos de SP posibles. */
export interface RivalProfile {
  /** `null` si la especie rival no aparece en los torneos. */
  inference: SetInference | null;
  set: DecodedSet;
  spreads: SpreadDistribution;
}

export interface Matchup {
  /** `null` si la especie rival no aparece en los torneos. */
  inference: SetInference | null;
  rivalSet: DecodedSet;
  spreads: SpreadDistribution;
  speed: SpeedComparison;
  /** Todos mis movimientos contra el rival y los suyos contra mí, de daño y de estado. */
  myMoves: MoveRow[];
  theirMoves: MoveRow[];
  /**
   * Los dos tal y como combaten (al rival le pone los SP y la naturaleza cada reparto), para
   * comparar velocidades en otras situaciones (Tailwind).
   */
  mine: Combatant;
  theirs: Combatant;
  /** Campo visto desde quien ataca: el mío al golpear yo y el suyo al golpear el rival. */
  myField: FieldState;
  theirField: FieldState;
}

export interface MatchupInput {
  metagame: Metagame;
  me: TeamMember;
  rival: string;
  rivalTeam: readonly string[];
  /** Índice del set candidato elegido para el rival (0 = el más probable). */
  candidate: number;
  field: FieldConditions;
  mySide: SideConditions;
  theirSide: SideConditions;
  myStatus?: BattleStatus;
  rivalStatus?: BattleStatus;
  /** Lo que el rival ha enseñado en la partida (objeto, habilidad, movimientos). */
  revealed?: Revealed;
  /** Calcula también el daño de los ataques en área contra un solo objetivo. */
  singleTargetOdds?: boolean;
  /** Índice del jugador rival en `metagame.players`, si se sabe quién es. */
  rivalPlayer?: number;
}

export function computeMatchup(input: MatchupInput): Matchup {
  const profile = rivalProfile(input.metagame, input.rival, input.rivalTeam, {
    candidate: input.candidate,
    revealed: input.revealed,
    player: input.rivalPlayer,
  });
  return matchupAgainst(input.me, profile, {
    field: input.field,
    mySide: input.mySide,
    theirSide: input.theirSide,
    myStatus: input.myStatus,
    theirStatus: input.rivalStatus,
    moves: input.metagame.moves,
    singleTargetOdds: input.singleTargetOdds,
  });
}

export interface ProfileOptions {
  /** Índice del set candidato elegido (0 = el más probable). */
  candidate?: number;
  revealed?: Revealed;
  /** Limita los repartos de SP a considerar (menos = más rápido). */
  maxSpreads?: number;
  /** Jugador rival: sus propios sets tienen prioridad. */
  player?: number;
}

/**
 * Set y repartos del rival. Es la parte cara de la inferencia y no depende de mi Pokémon,
 * así que se calcula una vez por rival.
 */
export function rivalProfile(
  metagame: Metagame,
  rival: string,
  rivalTeam: readonly string[],
  { candidate = 0, revealed, maxSpreads, player }: ProfileOptions = {},
): RivalProfile {
  const inference = inferSet(metagame, rival, rivalTeam, revealed, { player });
  const set: DecodedSet = inference?.candidates[candidate] ??
    inference?.candidates[0] ?? { species: rival, moves: [] };
  const spreads = spreadDistribution(metagame.spreads, set, inference?.natures, maxSpreads);
  return { inference, set, spreads };
}

/** La inferencia es lo caro y no depende de tu Pokémon: se guarda por metagame y especie. */
const typicalProfiles = new WeakMap<Metagame, Map<string, RivalProfile>>();

/**
 * Set y repartos de una especie sin saber con quién va (amenazas del meta, objetivos de SP,
 * tabla de velocidades): el más probable en general. Se calcula una vez por especie.
 */
export function typicalProfile(metagame: Metagame, species: string): RivalProfile {
  let cache = typicalProfiles.get(metagame);
  if (!cache) typicalProfiles.set(metagame, (cache = new Map()));
  let profile = cache.get(species);
  if (!profile) cache.set(species, (profile = rivalProfile(metagame, species, [species])));
  return profile;
}

export interface MatchupContext {
  field: FieldConditions;
  mySide?: SideConditions;
  theirSide?: SideConditions;
  myStatus?: BattleStatus;
  theirStatus?: BattleStatus;
  /** Prioridad, objetivo y flags de los movimientos (del roster). */
  moves?: MoveCatalog;
  /**
   * Calcula también el daño de los ataques en área contra un solo objetivo. Cuesta un cálculo
   * más por cada uno, así que solo lo pide la calculadora (no el recomendador).
   */
  singleTargetOdds?: boolean;
}

export function matchupAgainst(
  me: TeamMember,
  { inference, set: rivalSet, spreads }: RivalProfile,
  {
    field,
    mySide = emptySide(),
    theirSide = emptySide(),
    myStatus = freshStatus(),
    theirStatus = freshStatus(),
    moves,
    singleTargetOdds,
  }: MatchupContext,
): Matchup {
  const inBattle = (s: BattleStatus) => ({
    boosts: s.boosts,
    status: s.status,
    hpPercent: s.hp,
    itemConsumed: s.itemConsumed,
    mega: s.mega,
  });
  const mine: Combatant = { ...me, ...inBattle(myStatus) };
  const theirs: Combatant = {
    species: rivalSet.species,
    item: rivalSet.item,
    ability: rivalSet.ability,
    // Los SP y la naturaleza los pone cada reparto posible.
    sps: me.sps,
    ...inBattle(theirStatus),
  };

  const speed = compareSpeed(mine, theirs, spreads.spreads, {
    field: { weather: field.weather, terrain: field.terrain },
    myTailwind: mySide.tailwind,
    theirTailwind: theirSide.tailwind,
    trickRoom: field.trickRoom,
  });

  const rows = (
    names: string[],
    user: Combatant,
    target: Combatant,
    attackField: FieldState,
    unknown: 'attacker' | 'defender',
  ): MoveRow[] =>
    names.map((move) => {
      const info = moveInfo(moves, move);
      if (!info) return { move, priority: { value: 0 } };
      const priority = effectivePriority(move, info, actor(user), attackField);
      const blocked = blockReason(move, info, priority, actor(user), actor(target), attackField);
      if (blocked || info.category === 'Status') return { move, info, priority, blocked };
      const odds = damageOverSpreads(user, target, move, unknown, spreads.spreads, attackField);
      // Si la calculadora no le hace daño por algo que no detectamos, al menos no se oculta.
      if (!odds) return { move, info, priority, blocked: { code: 'noDamage' } };
      if (!singleTargetOdds || !SPREAD_TARGETS.has(info.target)) {
        return { move, info, priority, odds };
      }
      const singleTarget = damageOverSpreads(user, target, move, unknown, spreads.spreads, {
        ...attackField,
        singleTarget: true,
      });
      return { move, info, priority, odds, singleTarget: singleTarget ?? undefined };
    });

  const myField = fieldFor(field, mySide, theirSide);
  const theirField = fieldFor(field, theirSide, mySide);
  return {
    inference,
    rivalSet,
    spreads,
    speed,
    myMoves: rows(me.moves, mine, theirs, myField, 'defender'),
    theirMoves: rows(rivalSet.moves, theirs, mine, theirField, 'attacker'),
    mine,
    theirs,
    myField,
    theirField,
  };
}

function actor(c: Combatant) {
  return {
    species: c.species,
    item: c.itemConsumed ? undefined : c.item,
    ability: c.ability,
    hpPercent: c.hpPercent,
    mega: c.mega,
  };
}

/** Campo visto desde quien ataca: su Helping Hand y las pantallas de quien defiende. */
function fieldFor(
  field: FieldConditions,
  attacker: SideConditions,
  defender: SideConditions,
): FieldState {
  return {
    weather: field.weather,
    terrain: field.terrain,
    helpingHand: attacker.helpingHand,
    reflect: defender.reflect,
    lightScreen: defender.lightScreen,
    auroraVeil: defender.auroraVeil,
    friendGuard: defender.friendGuard,
    criticalHit: field.criticalHit,
  };
}

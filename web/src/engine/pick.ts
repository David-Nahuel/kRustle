import { battleAbility, battleForme, getSpecies } from './champions';
import type { DamageOdds } from './damage';
import {
  type FieldConditions,
  type MoveRow,
  type RivalProfile,
  TERRAIN_SETTERS,
  WEATHER_SETTERS,
  matchupAgainst,
  rivalProfile,
} from './matchup';
import type { DecodedSet, Metagame } from './metagame';
import { type MoveCatalog, addBoosts, intimidateEffect, moveInfo } from './moves';
import type { TeamMember } from './pokepaste';
import { type SpeedComparison, compareSpeed } from './speed';

/**
 * Situaciones de velocidad que cambian quién golpea antes: Trick Room y el Tailwind de cada lado
 * (si lo tienen los dos, se anulan).
 */
export const SPEED_STATES = [
  'none',
  'myTailwind',
  'theirTailwind',
  'trickRoom',
  'trickRoomMyTailwind',
  'trickRoomTheirTailwind',
] as const;
export type SpeedState = (typeof SPEED_STATES)[number];

type Redirection = 'Follow Me' | 'Rage Powder';
const REDIRECTIONS: Redirection[] = ['Follow Me', 'Rage Powder'];

/**
 * Lo que llevo entre mis 4 para frenar los ataques del rival: Wide Guard (los en área) y un
 * compañero que redirija (los de un objetivo).
 */
export type Protection = 'guard' | 'followMe' | 'ragePowder' | 'guardFollowMe' | 'guardRagePowder';
const PROTECTIONS: Record<Protection, { guard: boolean; redirect?: Redirection }> = {
  guard: { guard: true },
  followMe: { guard: false, redirect: 'Follow Me' },
  ragePowder: { guard: false, redirect: 'Rage Powder' },
  guardFollowMe: { guard: true, redirect: 'Follow Me' },
  guardRagePowder: { guard: true, redirect: 'Rage Powder' },
};
const PROTECTION_KINDS = Object.keys(PROTECTIONS) as Protection[];

/** Cómo acaba un 1 contra 1, separando lo que depende de quién golpea antes. */
export interface DuelOutcome {
  /**
   * La velocidad no cambia el daño, solo quién golpea antes: ganar = `decided` + `tied` × golpear
   * antes, donde `tied` es la probabilidad de necesitar los mismos golpes.
   */
  decided: number;
  tied: number;
  /** Probabilidad de golpear antes en cada situación de velocidad. */
  firstBy: Record<SpeedState, number>;
  /** El movimiento con el que antes me debilita el rival. */
  theirMove?: string;
}

/** Resultado estimado de un 1 contra 1 entre uno de mis Pokémon y uno rival. */
export interface Duel extends DuelOutcome {
  /** Probabilidad de que gane mi Pokémon sin Trick Room, Tailwind ni protecciones. */
  winChance: number;
  /** Probabilidad de golpear antes sin Trick Room ni Tailwind, contando velocidad y prioridad. */
  first: number;
  /** El movimiento con el que antes debilito al rival. */
  myMove?: string;
  /** El mismo duelo si llevo Wide Guard o quien redirija: sus ataques pierden algún turno. */
  protectedBy: Partial<Record<Protection, DuelOutcome>>;
}

/** Probabilidad de ganar el duelo en una situación de velocidad, con o sin protección. */
export function duelWin(duel: Duel, state: SpeedState, protection?: Protection): number {
  const outcome = (protection && duel.protectedBy[protection]) || duel;
  return outcome.decided + outcome.tied * outcome.firstBy[state];
}

/**
 * Qué protege a mi Pokémon `i` en una opción: Wide Guard (de quien sea, también de él mismo) y
 * un compañero que redirija (Follow Me antes que Rage Powder, que no afecta a todos).
 */
export function protectionFor(
  plan: Pick<PickPlan, 'wideGuard' | 'redirectors'>,
  i: number,
): Protection | undefined {
  const moves = plan.redirectors.filter(([k]) => k !== i).map(([, move]) => move);
  const redirect = REDIRECTIONS.find((move) => moves.includes(move));
  return PROTECTION_KINDS.find(
    (key) => PROTECTIONS[key].guard === plan.wideGuard && PROTECTIONS[key].redirect === redirect,
  );
}

export interface PickPlan {
  /** Índices de mi equipo: los 4 que llevo, los 2 que abren y los 2 de atrás. */
  bring: number[];
  leads: [number, number];
  back: [number, number];
  score: number;
  /** Lo bien cubierto que está cada rival con estos 4 (0–1), en el orden de `rivals`. */
  coverage: number[];
  /** Probabilidad supuesta de que Trick Room esté activo en un momento dado de la partida. */
  trickRoom: number;
  /** Si alguno de estos 4 pone Trick Room. */
  setsTrickRoom: boolean;
  /** Probabilidad supuesta de que mi Tailwind esté activo (0 si no llevo quien lo ponga). */
  tailwind: number;
  /** Lo mismo para el Tailwind del rival. */
  theirTailwind: number;
  /** Media de todos los enfrentamientos de estos 4: desempata opciones con la misma cobertura. */
  depth: number;
  /**
   * Quién megaevoluciona (índice de mi equipo), si llevo alguno con piedra. Solo puede uno por
   * combate: los demás que lleven piedra juegan con su forma base.
   */
  mega?: number;
  /** Si llevo quien ponga Wide Guard, y quién redirige (índice de mi equipo y movimiento). */
  wideGuard: boolean;
  redirectors: [number, Redirection][];
}

/** Lo que hace falta de una opción para valorar un duelo dentro de ella. */
export type PlanContext = Pick<
  PickPlan,
  'trickRoom' | 'tailwind' | 'theirTailwind' | 'mega' | 'wideGuard' | 'redirectors'
>;

/** Las tablas de 1 contra 1 con las que se valora cada opción. */
export interface DuelTables {
  /** `duels[mío][rival]`, con los que llevan piedra ya megaevolucionados. */
  duels: Duel[][];
  /** Lo mismo con todos en su forma base (para quien lleva piedra pero no megaevoluciona). */
  baseDuels: Duel[][];
}

export interface PickAnalysis extends DuelTables {
  rivals: string[];
  rivalSets: DecodedSet[];
  /** Clima y terreno supuestos para todos los cálculos. */
  field: FieldConditions;
  /** Quién de mi equipo puede megaevolucionar (lleva su piedra). */
  canMega: boolean[];
  /** Probabilidad de que el rival ponga Trick Room (según cuántos de sus sets lo llevan). */
  rivalTrickRoom: number;
  /** Probabilidad de que el rival ponga Tailwind, y quién suele llevarlo (con qué frecuencia). */
  rivalTailwind: number;
  rivalTailwindSetters: [string, number][];
  /** Quién del rival suele llevar Wide Guard y quién redirige (Follow Me, Rage Powder). */
  rivalWideGuard: [string, number][];
  rivalRedirection: [string, number][];
  /** Las mejores opciones, de mejor a peor. */
  plans: PickPlan[];
}

const BRING = 4;
/** Repartos de SP por rival: menos que en la calculadora, porque aquí se hacen 36 cálculos. */
const PICK_SPREADS = 8;
/** Peso de tener una segunda respuesta a un rival, frente a la mejor. */
const SECOND_ANSWER = 0.35;
/** Peso del rival peor cubierto: un Pokémon al que no ganas con nada puede barrerte. */
const WORST_CASE = 0.5;
/**
 * Parte de la partida que Trick Room está activo cuando un equipo lo pone: dura 4 turnos y no
 * siempre sale (Fake Out, Taunt, Imprison...). Por debajo de esta probabilidad se ignora.
 */
const TRICK_ROOM_UPTIME = 0.5;
/** Tailwind dura un turno menos que Trick Room (3 turnos útiles), aunque se puede volver a poner. */
const TAILWIND_UPTIME = 0.4;
const MIN_SPEED_CONTROL = 0.05;

interface Support {
  key: string;
  moves?: string[];
  abilities?: string[];
  /** Bonus al abrir con él. */
  lead: number;
  /** Bonus solo por llevarlo entre los 4: el apoyo no se ve en un 1 contra 1. */
  bring: number;
  /** Solo vale si el rival tiene ataques en área (Wide Guard). */
  againstSpread?: boolean;
  /**
   * Me hace más rápido que el rival (Tailwind, Icy Wind): contra un equipo de Trick Room vale
   * poco, porque con Trick Room activo juega en contra y sin él ya suelo ser más rápido.
   */
  speedsMeUp?: boolean;
}

/** Lo que cambia el valor del apoyo según el rival. */
export interface SupportContext {
  /** Parte de los rivales con ataques en área. */
  spread: number;
  /** Probabilidad de que el rival lleve Trick Room. */
  rivalTrickRoom: number;
}

/**
 * Lo que aporta un Pokémon más allá de su daño, megaevolucione o no (un Aerodactyl con su piedra
 * que no megaevoluciona sigue poniendo Tailwind y Wide Guard). Cada tipo cuenta una vez.
 * Trick Room, Tailwind, Wide Guard y la redirección no suman al llevarlos porque ya se calculan
 * en cada duelo (quién golpea antes, qué ataques pierden turnos); al abrir, sí, porque conviene
 * tenerlos desde el principio.
 */
const SUPPORT: Support[] = [
  { key: 'fakeout', moves: ['Fake Out'], lead: 0.06, bring: 0.01 },
  { key: 'speed', moves: ['Icy Wind', 'Electroweb'], lead: 0.06, bring: 0.03, speedsMeUp: true },
  { key: 'speed', moves: ['Tailwind'], lead: 0.06, bring: 0, speedsMeUp: true },
  { key: 'speed', moves: ['Trick Room'], lead: 0.06, bring: 0 },
  { key: 'redirect', moves: ['Follow Me', 'Rage Powder'], lead: 0.05, bring: 0 },
  { key: 'intimidate', abilities: ['Intimidate'], lead: 0.04, bring: 0.01 },
  { key: 'wideguard', moves: ['Wide Guard'], lead: 0.05, bring: 0, againstSpread: true },
  { key: 'screens', moves: ['Reflect', 'Light Screen', 'Aurora Veil'], lead: 0.03, bring: 0.02 },
];

/** Objetivos de los ataques en área, los que para Wide Guard. */
const SPREAD_TARGETS = new Set(['allAdjacentFoes', 'allAdjacent']);
/** Objetivos de los ataques a un solo rival, los que se pueden redirigir. */
const SINGLE_TARGETS = new Set(['normal', 'any', 'adjacentFoe']);
/**
 * Parte de los turnos en que el rival para un ataque con Wide Guard o lo redirige, cuando lo
 * lleva: no siempre lo trae, no siempre está en el campo y no lo usa cada turno.
 */
const HINDRANCE_RATE = 0.25;
const IGNORES_REDIRECTION = new Set(['Stalwart', 'Propeller Tail']);

/** Probabilidad de que un ataque mío pierda el turno, según a quién apunta. */
interface Hindrance {
  /** Contra Wide Guard (ataques en área). */
  spread: number;
  /** Contra Follow Me y Rage Powder (ataques a un objetivo). */
  single: number;
}

export interface PickOptions {
  maxPlans?: number;
  /** Jugador rival, si se sabe quién es: se usan sus propios sets. */
  rivalPlayer?: number;
}

export function analyzePick(
  metagame: Metagame,
  myTeam: readonly TeamMember[],
  rivals: readonly string[],
  { maxPlans = 3, rivalPlayer }: PickOptions = {},
): PickAnalysis {
  const profiles = rivals.map((r) =>
    rivalProfile(metagame, r, rivals, { maxSpreads: PICK_SPREADS, player: rivalPlayer }),
  );
  const field = impliedField(myTeam, profiles);
  const canMega = myTeam.map(isMega);
  const setsTr = myTeam.map((m) => m.moves.includes('Trick Room'));
  const setsTw = myTeam.map((m) => m.moves.includes('Tailwind'));
  const rivalTrickRoom = speedControlChance(profiles, 'Trick Room');
  const rivalTailwind = speedControlChance(profiles, 'Tailwind');
  const supportContext: SupportContext = {
    spread: spreadShare(profiles, metagame.moves),
    rivalTrickRoom,
  };

  // Lo que hace el rival para que mis ataques no lleguen: Wide Guard protege a los dos de los
  // ataques en área; Follow Me y Rage Powder desvían los de un objetivo hacia el compañero.
  const wideGuard = anyOf(profiles.map((p) => moveShare(p, 'Wide Guard')));
  const hindrance = (me: TeamMember, j: number): Hindrance => ({
    spread: HINDRANCE_RATE * wideGuard,
    single: HINDRANCE_RATE * redirectionChance(me, profiles, j),
  });

  // Lo que hago yo para que los suyos no lleguen: mi Wide Guard y quien redirija de los míos.
  const setsWg = myTeam.map((m) => m.moves.includes('Wide Guard'));
  const redirector = myTeam.map((m) => REDIRECTIONS.find((move) => m.moves.includes(move)));
  const protections = PROTECTION_KINDS.filter((key) => {
    const { guard, redirect } = PROTECTIONS[key];
    return (!guard || setsWg.some(Boolean)) && (!redirect || redirector.includes(redirect));
  });

  // Cada tabla, con la mega y (solo para quien lleva piedra) sin ella.
  const needs: DuelNeeds = {
    myTailwind: setsTw.some(Boolean),
    theirTailwind: rivalTailwind > 0,
    protections,
  };
  const table = (mega?: boolean) => (me: TeamMember) =>
    profiles.map((p, j) => duel(me, p, field, metagame.moves, needs, hindrance(me, j), mega));
  const mega = myTeam.map(table());
  const tables: DuelTables = {
    duels: mega,
    baseDuels: myTeam.map((me, i) => (canMega[i] ? table(false)(me) : mega[i])),
  };

  const plans = combinations(myTeam.length, Math.min(BRING, myTeam.length)).map((bring) => {
    // Trick Room puede ponerlo cualquiera de los dos; la probabilidad depende de si llevo setter.
    const setsTrickRoom = bring.some((i) => setsTr[i]);
    const trickRoom =
      1 - (1 - (setsTrickRoom ? TRICK_ROOM_UPTIME : 0)) * (1 - TRICK_ROOM_UPTIME * rivalTrickRoom);
    const context = {
      trickRoom,
      tailwind: bring.some((i) => setsTw[i]) ? TAILWIND_UPTIME : 0,
      theirTailwind: TAILWIND_UPTIME * rivalTailwind,
      wideGuard: bring.some((i) => setsWg[i]),
      redirectors: bring.flatMap((i): [number, Redirection][] => {
        const move = redirector[i];
        return move ? [[i, move]] : [];
      }),
    };
    // Si llevo varias megas, solo una megaevoluciona: me quedo con la que mejor resultado da.
    const megaOptions = bring.filter((i) => canMega[i]);
    const options = (megaOptions.length ? megaOptions : [undefined]).map((mega) =>
      evaluate(bring, { ...context, mega }, tables, rivals.length),
    );
    const best = options.reduce((a, b) => (b.score > a.score ? b : a));
    const leads = bestLeads(bring, rivals.length, myTeam, best.win, supportContext);
    const back = bring.filter((i) => !leads.includes(i)) as [number, number];
    return {
      bring,
      leads,
      back,
      score:
        best.score +
        supportBonus(
          bring.map((i) => myTeam[i]),
          'bring',
          supportContext,
        ),
      coverage: best.coverage,
      setsTrickRoom,
      ...context,
      depth: best.depth,
      mega: best.mega,
    };
  });

  return {
    rivals: [...rivals],
    rivalSets: profiles.map((p) => p.set),
    field,
    canMega,
    ...tables,
    rivalTrickRoom,
    rivalTailwind,
    rivalTailwindSetters: carriers(profiles, ['Tailwind']),
    rivalWideGuard: carriers(profiles, ['Wide Guard']),
    rivalRedirection: carriers(profiles, ['Follow Me', 'Rage Powder']),
    plans: plans.sort((a, b) => b.score - a.score || b.depth - a.depth).slice(0, maxPlans),
  };
}

/** Cobertura y puntuación de llevar estos 4, con una mega concreta. */
function evaluate(bring: number[], plan: PlanContext, tables: DuelTables, rivalCount: number) {
  const win = (i: number, j: number) => planWin(tables, plan, i, j);
  const coverage = Array.from({ length: rivalCount }, (_, j) => {
    const [best = 0, second = 0] = bring.map((i) => win(i, j)).sort((a, b) => b - a);
    return (best + SECOND_ANSWER * second) / (1 + SECOND_ANSWER);
  });
  const score = (average(coverage) + WORST_CASE * Math.min(...coverage)) / (1 + WORST_CASE);
  const depth = average(bring.flatMap((i) => coverage.map((_, j) => win(i, j))));
  return { mega: plan.mega, win, coverage, score, depth };
}

/**
 * Duelo de mi Pokémon `i` contra el rival `j` con una opción concreta: con su mega solo si es
 * quien megaevoluciona en ella.
 */
export function planDuel(
  tables: DuelTables,
  plan: Pick<PickPlan, 'mega'>,
  i: number,
  j: number,
): Duel {
  const base = plan.mega !== undefined && i !== plan.mega;
  return (base ? tables.baseDuels : tables.duels)[i][j];
}

/**
 * Cuánto pesa cada situación de velocidad en una opción. Trick Room y Tailwind se suponen
 * independientes; si los dos lados tienen Tailwind a la vez, se anulan.
 */
export function speedWeights(plan: PlanContext): Record<SpeedState, number> {
  const mine = plan.tailwind * (1 - plan.theirTailwind);
  const theirs = plan.theirTailwind * (1 - plan.tailwind);
  const neither = 1 - mine - theirs;
  const tr = plan.trickRoom;
  return {
    none: (1 - tr) * neither,
    myTailwind: (1 - tr) * mine,
    theirTailwind: (1 - tr) * theirs,
    trickRoom: tr * neither,
    trickRoomMyTailwind: tr * mine,
    trickRoomTheirTailwind: tr * theirs,
  };
}

/** Probabilidad de ganar con una opción concreta, mezclando las situaciones de velocidad. */
export function planWin(tables: DuelTables, plan: PlanContext, i: number, j: number): number {
  const d = planDuel(tables, plan, i, j);
  const weights = speedWeights(plan);
  const protection = protectionFor(plan, i);
  return SPEED_STATES.reduce(
    (sum, state) => sum + weights[state] * duelWin(d, state, protection),
    0,
  );
}

/** Con qué frecuencia lleva el movimiento este rival, según los sets de equipos parecidos. */
function moveShare({ inference, set }: RivalProfile, move: string): number {
  return inference
    ? (inference.moves.find(([m]) => m === move)?.[1] ?? 0)
    : Number(set.moves.includes(move));
}

/**
 * Probabilidad de que el rival tenga Trick Room o Tailwind: al menos uno de sus Pokémon lo
 * lleva (Farigiraf lleva Trick Room casi siempre; Whimsicott y Aerodactyl, Tailwind...).
 * Por debajo de `MIN_SPEED_CONTROL` se ignora.
 */
function speedControlChance(profiles: RivalProfile[], move: string): number {
  const chance = anyOf(profiles.map((p) => moveShare(p, move)));
  return chance >= MIN_SPEED_CONTROL ? chance : 0;
}

/** Probabilidad de que ocurra al menos uno de varios sucesos independientes. */
function anyOf(chances: number[]): number {
  return 1 - chances.reduce((none, p) => none * (1 - p), 1);
}

/** Rivales que suelen llevar alguno de estos movimientos (al menos el 10% de las veces). */
function carriers(profiles: RivalProfile[], moves: string[]): [string, number][] {
  return profiles
    .map((p): [string, number] => [p.set.species, Math.max(...moves.map((m) => moveShare(p, m)))])
    .filter(([, share]) => share >= 0.1)
    .sort((a, b) => b[1] - a[1]);
}

/**
 * Probabilidad de que el rival tenga, además del Pokémon `j`, quien desvíe los ataques de `me`:
 * Follow Me a todos; Rage Powder no a tipo Planta, Overcoat ni Safety Goggles. Stalwart y
 * Propeller Tail ignoran la redirección.
 */
function redirectionChance(me: TeamMember, profiles: RivalProfile[], j: number): number {
  const moves = REDIRECTIONS.filter((move) => redirectable(me, move));
  return anyOf(
    profiles
      .filter((_, k) => k !== j)
      .map((p) => Math.max(0, ...moves.map((move) => moveShare(p, move)))),
  );
}

/** Qué hay que calcular en cada duelo, según lo que pueden hacer los dos equipos. */
interface DuelNeeds {
  myTailwind: boolean;
  theirTailwind: boolean;
  /** Las formas de protegerme que permite mi equipo (Wide Guard, Follow Me, Rage Powder). */
  protections: Protection[];
}

/** Con `mega` a `false`, mi Pokémon juega con su forma base aunque lleve la piedra. */
function duel(
  me: TeamMember,
  profile: RivalProfile,
  field: FieldConditions,
  moves: MoveCatalog,
  needs: DuelNeeds,
  hindrance: Hindrance,
  mega?: boolean,
): Duel {
  // Al entrar en combate salta Intimidate: en un 1 contra 1, el de cada uno afecta al otro.
  const rival = profile.set;
  const intimidated = (
    target: { species: string; item?: string; ability?: string },
    source?: string,
  ) => (source === 'Intimidate' ? intimidateEffect(target) : {});
  const m = matchupAgainst(me, profile, {
    field: { ...field, trickRoom: false },
    moves,
    myStatus: { hp: 100, boosts: addBoosts({}, intimidated(me, rival.ability)), mega },
    theirStatus: { hp: 100, boosts: addBoosts({}, intimidated(rival, me.ability)) },
  });
  // Mis ataques pueden perder turnos contra Wide Guard o la redirección: a veces compensa otro.
  const myDelay = delayBy(hindrance.spread, hindrance.single);
  const mine = fastestKo(m.myMoves, myDelay);
  const myHits = mine ? hitsDistribution(mine.odds, myDelay(mine)) : NO_KO;
  const myPriority = mine?.priority.value ?? 0;

  // El daño no cambia con Tailwind ni Trick Room, solo quién se mueve antes.
  const compare = (myTailwind: boolean, theirTailwind: boolean) =>
    compareSpeed(m.mine, m.theirs, profile.spreads.spreads, {
      field: { weather: field.weather, terrain: field.terrain },
      myTailwind,
      theirTailwind,
    });
  const speeds = {
    none: m.speed,
    mine: needs.myTailwind ? compare(true, false) : m.speed,
    theirs: needs.theirTailwind ? compare(false, true) : m.speed,
  };

  // Cómo acaba según cuánto pierden los ataques del rival (por mi Wide Guard o mi redirección).
  const outcome = (theirDelay: (row: MoveRow) => number): DuelOutcome => {
    const theirs = fastestKo(m.theirMoves, theirDelay);
    const theirPriority = theirs?.priority.value ?? 0;
    // Con distinta prioridad golpea antes siempre el mismo; si no, según la velocidad.
    // Trick Room invierte el orden (la prioridad no).
    const fixed = myPriority !== theirPriority ? Number(myPriority > theirPriority) : undefined;
    const first = (s: SpeedComparison, trickRoom: boolean) =>
      fixed ?? (trickRoom ? s.second : s.first) + s.tie / 2;
    const firstBy: Record<SpeedState, number> = {
      none: first(speeds.none, false),
      myTailwind: first(speeds.mine, false),
      theirTailwind: first(speeds.theirs, false),
      trickRoom: first(speeds.none, true),
      trickRoomMyTailwind: first(speeds.mine, true),
      trickRoomTheirTailwind: first(speeds.theirs, true),
    };

    // Gana quien necesita menos golpes; con los mismos, quien golpea antes.
    const theirHits = theirs ? hitsDistribution(theirs.odds, theirDelay(theirs)) : NO_KO;
    let decided = 0;
    let tied = 0;
    for (const [a, pa] of myHits) {
      for (const [b, pb] of theirHits) {
        if (a < b) decided += pa * pb;
        else if (a === b && a === Infinity) decided += pa * pb * 0.5;
        else if (a === b) tied += pa * pb;
      }
    }
    return { decided, tied, firstBy, theirMove: theirs?.move };
  };

  const base = outcome(() => 0);
  const protectedBy: Duel['protectedBy'] = {};
  for (const kind of needs.protections) {
    const { guard, redirect } = PROTECTIONS[kind];
    const redirected = !!redirect && redirectable(rival, redirect);
    protectedBy[kind] = outcome(
      delayBy(guard ? HINDRANCE_RATE : 0, redirected ? HINDRANCE_RATE : 0),
    );
  }
  return {
    ...base,
    winChance: base.decided + base.tied * base.firstBy.none,
    first: base.firstBy.none,
    myMove: mine?.move,
    protectedBy,
  };
}

/** Turnos que pierde cada ataque según a quién apunta: en área o a un solo objetivo. */
function delayBy(spread: number, single: number): (row: MoveRow) => number {
  return (row) => {
    const target = row.info?.target ?? '';
    if (SPREAD_TARGETS.has(target)) return spread;
    return SINGLE_TARGETS.has(target) ? single : 0;
  };
}

/** Si a este Pokémon le afecta la redirección (Stalwart la ignora; Rage Powder es un polvo). */
function redirectable(
  target: { species: string; ability?: string; item?: string },
  move: Redirection,
): boolean {
  if (IGNORES_REDIRECTION.has(target.ability ?? '')) return false;
  return move === 'Follow Me' || !powderImmune(target);
}

function powderImmune(c: { species: string; ability?: string; item?: string }): boolean {
  const types: readonly string[] = getSpecies(c.species)?.types ?? [];
  return types.includes('Grass') || c.ability === 'Overcoat' || c.item === 'Safety Goggles';
}

const NO_KO: [number, number][] = [[Infinity, 1]];

/**
 * Turnos para debilitar como distribución: 1, 2, o los que salgan con la tirada mínima. Con
 * `delay`, la probabilidad de perder un turno (Wide Guard, redirección); se cuenta como mucho uno.
 */
function hitsDistribution(odds: DamageOdds, delay = 0): [number, number][] {
  const one = odds.ohkoChance;
  const two = Math.max(0, odds.twoHkoChance - one);
  const more = Math.max(0, 1 - one - two);
  const slow = Math.max(3, Math.min(odds.likely.hitsToKo, 6));
  const hits = (
    [
      [1, one],
      [2, two],
      [slow, more],
    ] as [number, number][]
  ).filter(([, p]) => p > 0);
  if (!delay) return hits;
  return hits.flatMap(([n, p]): [number, number][] => [
    [n, p * (1 - delay)],
    [n + 1, p * delay],
  ]);
}

function expectedHits(odds: DamageOdds, delay = 0): number {
  return hitsDistribution(odds, delay).reduce((sum, [hits, p]) => sum + hits * p, 0);
}

/** El movimiento de daño (que afecte) con el que antes se debilita al rival. */
function fastestKo(
  rows: MoveRow[],
  delay: (row: MoveRow) => number = () => 0,
): (MoveRow & { odds: DamageOdds }) | undefined {
  const turns = (r: MoveRow & { odds: DamageOdds }) => expectedHits(r.odds, delay(r));
  return rows
    .filter((r): r is MoveRow & { odds: DamageOdds } => !!r.odds)
    .reduce<(MoveRow & { odds: DamageOdds }) | undefined>(
      (best, r) => (!best || turns(r) < turns(best) ? r : best),
      undefined,
    );
}

/**
 * Si solo un equipo trae quien ponga clima (o terreno), lo normal es que esté activo.
 * Si los dos traen uno distinto, no se puede saber cuál quedará y no se asume ninguno.
 */
function impliedField(myTeam: readonly TeamMember[], rivals: RivalProfile[]): FieldConditions {
  const abilities = [
    ...myTeam.map((m) => battleAbility(m.species, m.item, m.ability)),
    ...rivals.map((r) => battleAbility(r.set.species, r.set.item, r.set.ability)),
  ];
  const only = <T>(values: (T | undefined)[]) => {
    const distinct = [...new Set(values.filter((v) => v !== undefined))];
    return distinct.length === 1 ? distinct[0] : undefined;
  };
  return {
    weather: only(abilities.map((a) => (a ? WEATHER_SETTERS[a] : undefined))),
    terrain: only(abilities.map((a) => (a ? TERRAIN_SETTERS[a] : undefined))),
    trickRoom: false,
  };
}

function isMega(member: TeamMember): boolean {
  return battleForme(member.species, member.item) !== member.species;
}

function bestLeads(
  bring: number[],
  rivalCount: number,
  team: readonly TeamMember[],
  win: (i: number, j: number) => number,
  context: SupportContext,
): [number, number] {
  let best: [number, number] = [bring[0], bring[1]];
  let bestScore = -Infinity;
  for (const [a, b] of combinations(bring.length, 2).map(([x, y]) => [bring[x], bring[y]])) {
    let pressure = 0;
    for (let j = 0; j < rivalCount; j++) pressure += Math.max(win(a, j), win(b, j));
    const score =
      pressure / Math.max(rivalCount, 1) + supportBonus([team[a], team[b]], 'lead', context);
    if (score > bestScore) {
      bestScore = score;
      best = [a, b];
    }
  }
  return best;
}

/** Movimientos y habilidades de apoyo de un Pokémon (Tailwind, Wide Guard, Intimidate...). */
export function supportRoles(member: Pick<TeamMember, 'moves' | 'ability'>): string[] {
  const roles = new Set<string>();
  for (const support of SUPPORT) {
    for (const move of support.moves ?? []) if (member.moves.includes(move)) roles.add(move);
    if (member.ability && support.abilities?.includes(member.ability)) roles.add(member.ability);
  }
  return [...roles];
}

/**
 * Bonus de apoyo de un grupo (la pareja que abre o los 4 que llevo). Cada tipo cuenta una vez:
 * dos Fake Out no valen el doble.
 */
export function supportBonus(
  members: Pick<TeamMember, 'moves' | 'ability'>[],
  kind: 'lead' | 'bring',
  { spread, rivalTrickRoom }: SupportContext,
): number {
  const best = new Map<string, number>();
  for (const support of SUPPORT) {
    const has = members.some(
      (m) =>
        support.moves?.some((move) => m.moves.includes(move)) ||
        (m.ability !== undefined && support.abilities?.includes(m.ability)),
    );
    if (!has) continue;
    const bonus =
      support[kind] *
      (support.againstSpread ? spread : 1) *
      (support.speedsMeUp ? 1 - rivalTrickRoom : 1);
    best.set(support.key, Math.max(best.get(support.key) ?? 0, bonus));
  }
  return [...best.values()].reduce((a, b) => a + b, 0);
}

/** Parte de los rivales cuyo set probable tiene algún ataque en área. */
function spreadShare(profiles: RivalProfile[], moves: MoveCatalog): number {
  const spreaders = profiles.filter(({ set }) =>
    set.moves.some((name) => {
      const info = moveInfo(moves, name);
      return !!info && info.category !== 'Status' && SPREAD_TARGETS.has(info.target);
    }),
  );
  return profiles.length ? spreaders.length / profiles.length : 0;
}

/** Todas las combinaciones de `k` índices entre `0..n-1`. */
export function combinations(n: number, k: number): number[][] {
  if (k === 0) return [[]];
  const result: number[][] = [];
  for (let first = 0; first <= n - k; first++) {
    for (const rest of combinations(n - first - 1, k - 1)) {
      result.push([first, ...rest.map((i) => i + first + 1)]);
    }
  }
  return result;
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

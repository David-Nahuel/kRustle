import {
  type StatId,
  type Stats,
  battleForme,
  emptyStats,
  getMove,
  getNature,
  getSpecies,
} from './champions';
import type { NatureSpreads, Shares, SpTuple } from './metagame';

export interface WeightedSpread {
  nature: string;
  sps: Stats;
  probability: number;
}

export interface SpreadDistribution {
  /** De más a menos probable; las probabilidades suman 1. */
  spreads: WeightedSpread[];
  /** `smogon`: repartos reales del ladder. `estimated`: deducidos con `inferSpreads`. */
  source: 'smogon' | 'estimated';
}

/**
 * Repartos de SP posibles para un set rival, con su probabilidad.
 *
 * La naturaleza se pondera con `natureOdds` (lo que se ve en torneos para este equipo, más
 * fiable que el ladder) y, dentro de cada naturaleza, los repartos salen de Smogon.
 * Si la especie no está en Smogon, se usan las estimaciones de `inferSpreads`.
 */
export function spreadDistribution(
  data: ReadonlyMap<string, NatureSpreads[]>,
  set: { species: string; item?: string; nature?: string; moves: string[] },
  natureOdds: Shares = set.nature ? [[set.nature, 1]] : [],
  maxSpreads = 20,
): SpreadDistribution {
  const entries = data.get(battleForme(set.species, set.item)) ?? data.get(set.species);
  if (!entries?.length) {
    const nature = set.nature ?? natureOdds[0]?.[0];
    const [probable, ...alternatives] = inferSpreads({ ...set, nature });
    const rest = alternatives.length ? 0.4 / alternatives.length : 0;
    return {
      source: 'estimated',
      spreads: [
        {
          nature: nature ?? 'Serious',
          sps: probable.sps,
          probability: alternatives.length ? 0.6 : 1,
        },
        ...alternatives.map((a) => ({
          nature: nature ?? 'Serious',
          sps: a.sps,
          probability: rest,
        })),
      ],
    };
  }

  const odds = new Map(natureOdds);
  const known = entries.filter((e) => (odds.get(e.nature) ?? 0) > 0);
  // Si las naturalezas vistas en torneos no aparecen en el ladder, manda el ladder.
  const weighted = known.length
    ? known.map((e) => ({ entry: e, weight: odds.get(e.nature)! }))
    : entries.map((e) => ({ entry: e, weight: e.share }));

  const all: WeightedSpread[] = weighted.flatMap(({ entry, weight }) =>
    entry.spreads.map(([sps, p]) => ({
      nature: entry.nature,
      sps: toStats(sps),
      probability: weight * p,
    })),
  );
  const top = all.sort((a, b) => b.probability - a.probability).slice(0, maxSpreads);
  const total = top.reduce((sum, s) => sum + s.probability, 0);
  return {
    source: 'smogon',
    spreads: top.map((s) => ({ ...s, probability: s.probability / total })),
  };
}

function toStats([hp, atk, def, spa, spd, spe]: SpTuple): Stats {
  return { hp, atk, def, spa, spd, spe };
}

export type SpreadKind = 'probable' | 'offensive' | 'bulky';

export interface SpreadOption {
  kind: SpreadKind;
  label: string;
  sps: Stats;
}

/** A partir de esta velocidad base se asume que invierte en velocidad (si la naturaleza no dice otra cosa). */
const FAST_BASE_SPEED = 95;

/**
 * Limitless no publica los Stat Points, así que se deducen de la naturaleza, el objeto y los
 * movimientos. Devuelve el reparto más probable y, si son distintas, las alternativas
 * "ofensivo" y "defensivo" para que la calculadora pueda mostrar el rango real de riesgo.
 */
export function inferSpreads(set: {
  species: string;
  item?: string;
  nature?: string;
  moves: string[];
}): SpreadOption[] {
  const species = getSpecies(battleForme(set.species, set.item));
  const base = species?.baseStats ?? { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const nature = set.nature ? getNature(set.nature) : undefined;
  const plus = nature?.plus !== nature?.minus ? nature?.plus : undefined;
  const minus = nature?.plus !== nature?.minus ? nature?.minus : undefined;

  const attackStat = mainAttackStat(set.moves) ?? (base.atk >= base.spa ? 'atk' : 'spa');
  const isAttacker = mainAttackStat(set.moves) !== null;
  const trickRoom = minus === 'spe';
  const fast =
    !trickRoom && (plus === 'spe' || set.item === 'Choice Scarf' || base.spe >= FAST_BASE_SPEED);

  const offensive = trickRoom
    ? spread({ hp: 32, [attackStat]: 32, def: 2 })
    : spread({ [attackStat]: 32, spe: 32, hp: 2 });
  const bulkyStat: StatId = plus === 'def' || plus === 'spd' ? plus : 'def';
  const bulky = spread({ hp: 32, [bulkyStat]: 32, [bulkyStat === 'def' ? 'spd' : 'def']: 2 });
  const balancedBulk = spread({ hp: 32, def: 17, spd: 17 });

  let probable: Stats;
  if (plus === 'def' || plus === 'spd') {
    probable = bulky;
  } else if (!isAttacker) {
    probable = balancedBulk;
  } else if (plus === 'atk' || plus === 'spa' || plus === 'spe' || !nature) {
    probable = fast || trickRoom ? offensive : spread({ hp: 32, [attackStat]: 32, spe: 2 });
  } else {
    // Naturaleza neutra o que baja un stat de ataque: lo más común es ataque + velocidad.
    probable = offensive;
  }

  const options: SpreadOption[] = [
    { kind: 'probable', label: 'Probable', sps: probable },
    { kind: 'offensive', label: 'Ofensivo', sps: offensive },
    { kind: 'bulky', label: 'Defensivo', sps: isAttacker ? balancedBulk : bulky },
  ];
  return options.filter(
    (o, i) => i === 0 || !options.slice(0, i).some((prev) => sameStats(prev.sps, o.sps)),
  );
}

/** Stat de ataque que más usan sus movimientos ofensivos, o `null` si no tiene ninguno. */
function mainAttackStat(moves: string[]): 'atk' | 'spa' | null {
  let physical = 0;
  let special = 0;
  for (const name of moves) {
    const move = getMove(name);
    if (!move?.basePower) continue;
    if (move.category === 'Physical') physical++;
    else if (move.category === 'Special') special++;
  }
  if (physical === 0 && special === 0) return null;
  return physical >= special ? 'atk' : 'spa';
}

function spread(partial: Partial<Stats>): Stats {
  return { ...emptyStats(), ...partial };
}

function sameStats(a: Stats, b: Stats): boolean {
  return (Object.keys(a) as StatId[]).every((s) => a[s] === b[s]);
}

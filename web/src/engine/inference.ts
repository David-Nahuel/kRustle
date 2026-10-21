import type { DecodedSet, Metagame, Shares } from './metagame';

/** Lo que ya se ha visto del rival durante la partida. */
export interface Revealed {
  item?: string;
  ability?: string;
  moves?: string[];
}

export interface SetCandidate extends DecodedSet {
  probability: number;
}

export interface SetInference {
  species: string;
  /** Sets completos más probables, de mayor a menor. */
  candidates: SetCandidate[];
  items: Shares;
  abilities: Shares;
  natures: Shares;
  moves: Shares;
  /** Sets observados que encajan con lo revelado. */
  sampleSize: number;
  /** Equipos de la muestra que comparten ≥ 3 compañeros con el rival. */
  similarTeams: number;
  /** Lo revelado no encaja con ningún set conocido: el resultado es aproximado. */
  revealedMismatch: boolean;
  /** Sets de la muestra que son del propio rival (si se sabe quién es). */
  fromPlayer: number;
}

export interface InferenceOptions {
  /**
   * Cuánto más pesa un equipo por cada compañero que comparte con el rival
   * (`peso × e^(boost × compartidos)`). Con el valor por defecto, si hay equipos casi idénticos
   * al del rival mandan ellos (la gente copia equipos y repite el suyo).
   * Ajustado con datos reales de M-C: 2–3 da el mejor acierto (objeto 81% frente a 71% sin ponderar).
   */
  similarityBoost?: number;
  maxCandidates?: number;
  /**
   * Índice del jugador rival, si se sabe quién es. Sus propios sets pesan mucho más: si ya ha
   * llevado este Pokémon, lo más probable es que lo lleve igual.
   */
  player?: number;
}

/**
 * Peso extra de los equipos del propio rival. Equivale a compartir unos 3 compañeros más
 * (e^(2,5 × 2,8) ≈ 1000), así que no lo anula todo: si su equipo es antiguo y otro jugador ha
 * llevado hace poco uno casi idéntico, puede mandar el de otro (lo normal es que el rival se haya
 * pasado a esa versión). Ajustado con `npm run validate` en M-C: entre 300 y 3000 da el mejor
 * acierto; con 1e6 (sus sets mandan siempre) el objeto baja del 91% al 89%.
 */
const PLAYER_BOOST = 1e3;

/**
 * Infiere el set de un Pokémon rival. Se ponderan más los equipos parecidos al del rival,
 * porque el mismo Pokémon se lleva distinto según el núcleo de equipo.
 * Devuelve `null` si la especie no aparece en la muestra.
 */
export function inferSet(
  metagame: Metagame,
  species: string,
  opponentTeam: readonly string[],
  revealed: Revealed = {},
  { similarityBoost = 2.5, maxCandidates = 5, player }: InferenceOptions = {},
): SetInference | null {
  const occurrences = metagame.occurrences.get(species);
  if (!occurrences?.length) return null;

  const teammates = new Set(opponentTeam.filter((s) => s !== species));
  const weighted = occurrences.map(({ team, set }) => {
    const shared = metagame.teamSpecies[team].filter((s) => teammates.has(s)).length;
    const own = player !== undefined && metagame.teamPlayer[team] === player;
    const weight =
      metagame.teamWeight[team] * Math.exp(similarityBoost * shared) * (own ? PLAYER_BOOST : 1);
    return { set, shared, own, weight };
  });

  const matching = weighted.filter(({ set }) => matchesRevealed(metagame.sets[set], revealed));
  const revealedMismatch = matching.length === 0;
  const pool = revealedMismatch ? weighted : matching;

  const bySet = new Map<number, number>();
  const items = new Map<string, number>();
  const abilities = new Map<string, number>();
  const natures = new Map<string, number>();
  const moves = new Map<string, number>();
  let total = 0;
  for (const { set, weight } of pool) {
    const s = metagame.sets[set];
    total += weight;
    add(bySet, set, weight);
    if (s.item) add(items, s.item, weight);
    if (s.ability) add(abilities, s.ability, weight);
    if (s.nature) add(natures, s.nature, weight);
    for (const m of s.moves) add(moves, m, weight);
  }

  const ranked = [...bySet]
    .sort((a, b) => b[1] - a[1])
    .map(([set, w]) => ({ ...metagame.sets[set], probability: w / total }));
  // Al forzar lo visto, sets que solo se diferenciaban en eso quedan iguales: se fusionan.
  const candidates = (
    revealedMismatch ? mergeIdentical(ranked.map((c) => applyRevealed(c, revealed, moves))) : ranked
  ).slice(0, maxCandidates);

  return {
    species,
    candidates,
    items: shares(items, total),
    abilities: shares(abilities, total),
    natures: shares(natures, total),
    moves: shares(moves, total),
    sampleSize: pool.length,
    similarTeams: pool.filter((p) => p.shared >= 3).length,
    revealedMismatch,
    fromPlayer: pool.filter((p) => p.own).length,
  };
}

function matchesRevealed(set: DecodedSet, revealed: Revealed): boolean {
  if (revealed.item && set.item !== revealed.item) return false;
  if (revealed.ability && set.ability !== revealed.ability) return false;
  return (revealed.moves ?? []).every((m) => set.moves.includes(m));
}

/** Si nada encaja con lo visto, se fuerza lo visto sobre el set más probable. */
function applyRevealed(
  candidate: SetCandidate,
  revealed: Revealed,
  moveWeights: Map<string, number>,
): SetCandidate {
  const known = revealed.moves ?? [];
  const rest = candidate.moves
    .filter((m) => !known.includes(m))
    .sort((a, b) => (moveWeights.get(b) ?? 0) - (moveWeights.get(a) ?? 0));
  return {
    ...candidate,
    item: revealed.item ?? candidate.item,
    ability: revealed.ability ?? candidate.ability,
    moves: [...known, ...rest].slice(0, 4),
  };
}

function mergeIdentical(candidates: SetCandidate[]): SetCandidate[] {
  const byKey = new Map<string, SetCandidate>();
  for (const c of candidates) {
    const key = JSON.stringify([c.item, c.ability, c.nature, [...c.moves].sort()]);
    const existing = byKey.get(key);
    if (existing) existing.probability += c.probability;
    else byKey.set(key, { ...c });
  }
  return [...byKey.values()].sort((a, b) => b.probability - a.probability);
}

function add<K>(map: Map<K, number>, key: K, weight: number): void {
  map.set(key, (map.get(key) ?? 0) + weight);
}

function shares(map: Map<string, number>, total: number): Shares {
  return [...map].sort((a, b) => b[1] - a[1]).map(([name, w]) => [name, w / total]);
}

/**
 * Etiquetas cortas y distintas para los sets candidatos: el objeto y, mientras dos coincidan,
 * lo que los diferencia (naturaleza, movimientos, habilidad). En último caso, se numeran.
 * Se comparan los nombres en inglés; `display` los pasa al idioma de la interfaz al final.
 */
export function candidateLabels(
  candidates: readonly SetCandidate[],
  display: (name: string) => string = (name) => name,
  noItem = 'No item',
): string[] {
  const parts = candidates.map((c) => [c.item ?? '']);
  const label = (i: number) => parts[i].join(' · ');
  const refine = (
    detail: (c: SetCandidate, others: SetCandidate[], used: string[]) => string | undefined,
  ) => {
    const current = candidates.map((_, i) => label(i));
    candidates.forEach((c, i) => {
      const others = candidates.filter((_, j) => j !== i && current[j] === current[i]);
      const extra = others.length ? detail(c, others, parts[i]) : undefined;
      if (extra) parts[i].push(extra);
    });
  };

  refine((c, others) =>
    c.nature && others.some((o) => o.nature !== c.nature) ? c.nature : undefined,
  );
  for (let pass = 0; pass < 3; pass++) {
    refine((c, others, used) =>
      c.moves.find((m) => !used.includes(m) && others.some((o) => !o.moves.includes(m))),
    );
  }
  refine((c, others) =>
    c.ability && others.some((o) => o.ability !== c.ability) ? c.ability : undefined,
  );

  const seen = new Map<string, number>();
  return candidates.map((_, i) => {
    const n = (seen.get(label(i)) ?? 0) + 1;
    seen.set(label(i), n);
    const text = parts[i].map((part) => (part ? display(part) : noItem)).join(' · ');
    return n === 1 ? text : `${text} (${n})`;
  });
}

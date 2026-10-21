// Mide si el recomendador de pick sabe quién gana: separa los torneos más recientes, aprende con
// los anteriores y, en cada enfrentamiento real, compara lo que puntúa cada equipo contra el otro
// con quién ganó. Lo compara con dos referencias que solo miran datos:
//
// - el winrate de las especies de cada equipo,
// - cómo les fue a las especies de un equipo contra las del otro.
//
// Después ajusta una combinación de los tres (regresión logística) con la mitad de las partidas
// y la evalúa con la otra mitad.
//
//   npm run validate-pick -- [formato] [máximo de partidas]
import { readFileSync } from 'node:fs';

import { archetypeTeam } from '../src/engine/archetypes.ts';
import { type ArchetypeSet, type TeamsFile, buildMetagame } from '../src/engine/metagame.ts';
import { analyzePick } from '../src/engine/pick.ts';
import { SPECIES_PRIOR_GAMES, matchupFeatures } from '../src/engine/versus.ts';

const HELD_OUT_TOURNAMENTS = 15;

const format = process.argv[2] ?? 'M-C';
const limit = Number(process.argv[3] ?? Infinity);
const dir = new URL(`../public/data/${format}/`, import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
const file: TeamsFile = read('teams.json');

if (file.tournaments.length <= HELD_OUT_TOURNAMENTS) {
  console.log(
    `${format}: solo ${file.tournaments.length} torneos, hacen falta más de ${HELD_OUT_TOURNAMENTS}`,
  );
  process.exit(0);
}

const cut = file.tournaments.length - HELD_OUT_TOURNAMENTS;
const inTrain = file.teams.map((t) => t[0] < cut);
const train: TeamsFile = {
  ...file,
  teams: file.teams.filter((_, i) => inTrain[i]),
  teamPlayers: file.teamPlayers?.filter((_, i) => inTrain[i]),
  // Los enfrentamientos de entrenamiento, con los índices de equipo ya filtrados.
  matches: (() => {
    const index: number[] = [];
    let n = 0;
    for (const t of inTrain) index.push(t ? n++ : -1);
    return file.matches
      .filter(([a, b]) => inTrain[a] && inTrain[b])
      .map(([a, b, r]) => [index[a], index[b], r] as [number, number, 0 | 1 | 2]);
  })(),
};
const metagame = buildMetagame(
  {
    meta: read('meta.json'),
    usage: [],
    teams: train,
    spreads: read('spreads.json'),
    roster: read('roster.json'),
  },
  new Date(file.tournaments[cut - 1].date),
);

const sets = (team: number): ArchetypeSet[] =>
  file.teams[team].slice(4).map((id) => {
    const [species, item, ability, nature, moves] = file.sets[id];
    return {
      species: file.species[species],
      item: item === null ? null : file.items[item],
      ability: ability === null ? null : file.abilities[ability],
      nature: nature === null ? null : file.natures[nature],
      moves: moves.map((m) => file.moves[m]),
    };
  });
const species = (team: number) => sets(team).map((s) => s.species);
const score = (mine: number, theirs: number) =>
  analyzePick(metagame, archetypeTeam(metagame, sets(mine)), species(theirs)).plans[0]?.score ?? 0;

const test = file.matches.filter(([a, b, r]) => !inTrain[a] && !inTrain[b] && r !== 0);
const step = Number.isFinite(limit) ? Math.max(1, Math.floor(test.length / limit)) : 1;
const sample = test.filter((_, i) => i % step === 0).slice(0, limit);

interface Row {
  features: number[];
  won: number;
}
const rows: Row[] = [];
const start = Date.now();
for (const [a, b, result] of sample) {
  const versus = matchupFeatures(metagame, species(a), species(b));
  rows.push({
    features: [score(a, b) - score(b, a), versus.species, versus.matchups],
    won: result === 1 ? 1 : 0,
  });
}

const NAMES = ['recomendador', 'winrate de las especies', 'enfrentamientos entre especies'];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const accuracy = (data: Row[], predict: (r: Row) => number) =>
  data.reduce((n, r) => n + (predict(r) > 0.5 === (r.won === 1) ? 1 : 0), 0) / data.length;
const logLoss = (data: Row[], predict: (r: Row) => number) =>
  -data.reduce((s, r) => {
    const p = Math.min(1 - 1e-6, Math.max(1e-6, predict(r)));
    return s + (r.won ? Math.log(p) : Math.log(1 - p));
  }, 0) / data.length;

console.log(
  `${format}: ${rows.length} enfrentamientos de los últimos ${HELD_OUT_TOURNAMENTS} torneos ` +
    `(${((Date.now() - start) / rows.length / 2).toFixed(0)} ms por análisis)\n`,
);
console.log('Acierto de cada predictor por separado (gana quien tiene más):');
NAMES.forEach((name, k) => {
  const acc = accuracy(rows, (r) => (r.features[k] === 0 ? 0.5 : r.features[k] > 0 ? 1 : 0));
  console.log(`  ${name.padEnd(32)} ${pct(acc)}`);
});

// Regresión logística (sin término independiente: el orden de los equipos no importa) con la
// primera mitad; evaluación con la segunda.
function fit(data: Row[], use: number[]): number[] {
  const w = use.map(() => 0);
  for (let iter = 0; iter < 3000; iter++) {
    const grad = w.map(() => 0);
    for (const r of data) {
      const z = use.reduce((s, k, j) => s + w[j] * r.features[k], 0);
      const p = 1 / (1 + Math.exp(-z));
      use.forEach((k, j) => (grad[j] += (p - r.won) * r.features[k]));
    }
    w.forEach((_, j) => (w[j] -= (0.5 * grad[j]) / data.length));
  }
  return w;
}
const half = Math.floor(rows.length / 2);
const [fitRows, evalRows] = [rows.slice(0, half), rows.slice(half)];
console.log(
  `\nCombinaciones (ajustadas con ${fitRows.length} partidas, evaluadas con ${evalRows.length}):`,
);
console.log(
  `  ${'siempre 50%'.padEnd(44)} acierto  50.0%  log-loss ${logLoss(evalRows, () => 0.5).toFixed(4)}`,
);
for (const use of [[0], [1], [2], [1, 2], [0, 1, 2]]) {
  const w = fit(fitRows, use);
  const predict = (r: Row) =>
    1 / (1 + Math.exp(-use.reduce((s, k, j) => s + w[j] * r.features[k], 0)));
  const label = use.map((k) => NAMES[k]).join(' + ');
  console.log(
    `  ${label.padEnd(44)} acierto ${pct(accuracy(evalRows, predict)).padStart(6)}  ` +
      `log-loss ${logLoss(evalRows, predict).toFixed(4)}  pesos [${w.map((x) => x.toFixed(2)).join(', ')}]`,
  );
}
console.log(`\n(prior de ${SPECIES_PRIOR_GAMES} partidas al 50% en los winrates de los datos)`);

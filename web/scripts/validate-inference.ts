// Mide el acierto de la inferencia de sets con datos reales: separa los torneos más recientes,
// infiere los sets de sus equipos usando solo los anteriores y compara con lo que llevaban.
//
//   npm run validate -- [formato] [boost1,boost2,...]
//   npm run validate -- M-C 0,1,2.5
import { readFileSync } from 'node:fs';

import { type InferenceOptions, inferSet } from '../src/engine/inference.ts';
import { type DecodedSet, type TeamsFile, buildMetagame } from '../src/engine/metagame.ts';

const HELD_OUT_TOURNAMENTS = 15;
const DEFAULT_BOOST = 2.5;

const format = process.argv[2] ?? 'M-C';
const boosts = (process.argv[3] ?? `0,${DEFAULT_BOOST}`).split(',').map(Number);
const dir = new URL(`../public/data/${format}/`, import.meta.url);
const meta = JSON.parse(readFileSync(new URL('meta.json', dir), 'utf8'));
const file: TeamsFile = JSON.parse(readFileSync(new URL('teams.json', dir), 'utf8'));

const cut = file.tournaments.length - HELD_OUT_TOURNAMENTS;
const inTrain = file.teams.map((t) => t[0] < cut);
const train: TeamsFile = {
  ...file,
  teams: file.teams.filter((_, i) => inTrain[i]),
  teamPlayers: file.teamPlayers?.filter((_, i) => inTrain[i]),
  matches: [],
};
const test = file.teams
  .map((row, i) => ({ row, player: file.teamPlayers?.[i] ?? -1 }))
  .filter((_, i) => !inTrain[i]);
const metagame = buildMetagame(
  { meta, usage: [], teams: train },
  new Date(file.tournaments[cut - 1].date),
);

const decode = (setId: number): DecodedSet => {
  const [species, item, ability, nature, moves] = file.sets[setId];
  return {
    species: file.species[species],
    item: item === null ? undefined : file.items[item],
    ability: ability === null ? undefined : file.abilities[ability],
    nature: nature === null ? undefined : file.natures[nature],
    moves: moves.map((m) => file.moves[m]),
  };
};

/** Acierto sobre los Pokémon de prueba que cumplan `include`, con las opciones de cada uno. */
function measure(
  label: string,
  include: (species: string, player: number) => boolean,
  options: (player: number) => InferenceOptions,
): void {
  let n = 0;
  const hits = { item: 0, ability: 0, nature: 0, moves: 0 };
  for (const { row, player } of test) {
    const team = row.slice(4).map(decode);
    const species = team.map((s) => s.species);
    for (const truth of team) {
      if (!include(truth.species, player)) continue;
      const guess = inferSet(metagame, truth.species, species, {}, options(player))?.candidates[0];
      if (!guess) continue;
      n++;
      if (guess.item === truth.item) hits.item++;
      if (guess.ability === truth.ability) hits.ability++;
      if (guess.nature === truth.nature) hits.nature++;
      hits.moves +=
        guess.moves.filter((m) => truth.moves.includes(m)).length / Math.max(1, truth.moves.length);
    }
  }
  const pct = (x: number) => `${((x / n) * 100).toFixed(1)}%`.padStart(6);
  console.log(
    `${label.padEnd(26)} objeto ${pct(hits.item)}  habilidad ${pct(hits.ability)}  ` +
      `naturaleza ${pct(hits.nature)}  movimientos ${pct(hits.moves)}  (n=${n})`,
  );
}

console.log(`${format}: ${test.length} equipos de los últimos ${HELD_OUT_TOURNAMENTS} torneos\n`);
for (const similarityBoost of boosts) {
  measure(
    `boost ${similarityBoost}`,
    () => true,
    () => ({ similarityBoost }),
  );
}

// Pokémon que su jugador ya había llevado antes: ¿cuánto aporta saber quién es el rival?
const playedBefore = (species: string, player: number) =>
  (metagame.playerTeams.get(player) ?? []).some((t) => metagame.teamSpecies[t].includes(species));
console.log('\nPokémon que el rival ya había llevado en torneos anteriores:');
measure('sin saber quién es', playedBefore, () => ({ similarityBoost: DEFAULT_BOOST }));
measure('sabiendo quién es', playedBefore, (player) => ({
  similarityBoost: DEFAULT_BOOST,
  player,
}));

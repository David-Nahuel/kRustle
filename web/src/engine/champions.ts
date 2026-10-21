import { Generations, toID } from '@smogon/calc';

/** Pokémon Champions es la "generación 0" de @smogon/calc: nivel 50 fijo y Stat Points en lugar de EVs. */
export const GEN = Generations.get(0);

export const SP_PER_STAT = 32;
export const SP_TOTAL = 66;

export type StatId = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type Stats = Record<StatId, number>;

export const STAT_IDS: readonly StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

export function emptyStats(): Stats {
  return { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
}

export function statTotal(stats: Stats): number {
  return STAT_IDS.reduce((sum, s) => sum + stats[s], 0);
}

/**
 * Pokémon que se ven en team preview con un nombre que la calculadora no conoce, porque solo trae
 * sus formas de combate. Aegislash ataca en forma Blade y se defiende en Shield (Stance Change),
 * que es justo "Aegislash-Both". `previewSpecies` deshace el cambio.
 */
const CALC_FORMES: Readonly<Record<string, string>> = { Aegislash: 'Aegislash-Both' };
const CALC_IDS = new Map(Object.entries(CALC_FORMES).map(([name, forme]) => [toID(name), forme]));

export function getSpecies(name: string) {
  return GEN.species.get(toID(CALC_IDS.get(toID(name)) ?? name));
}

export function getMove(name: string) {
  return GEN.moves.get(toID(name));
}

export function getItem(name: string) {
  return GEN.items.get(toID(name));
}

export function getAbility(name: string) {
  return GEN.abilities.get(toID(name));
}

export function getNature(name: string) {
  return GEN.natures.get(toID(name));
}

/**
 * Forma que tendrá en combate: la mega si lleva su piedra y ha megaevolucionado. Con `mega`
 * sin definir se supone que sí (al planificar la partida); en la calculadora, empieza sin ella.
 * No se usa `Pokemon.getForme` de la librería porque confunde las megas X/Y/Z nuevas
 * (Garchompite Z → "Garchomp-Mega", Raichunite Y → "Raichu-Mega-X").
 */
export function battleForme(species: string, item?: string, mega = true): string {
  const baseName = getSpecies(species)?.name ?? species;
  if (!mega) return baseName;
  const stone: Readonly<Record<string, string>> | undefined = item
    ? getItem(item)?.megaStone
    : undefined;
  return stone?.[baseName] ?? baseName;
}

/** Habilidad en combate: las megas tienen la suya (Charizard-Mega-Y → Drought). */
export function battleAbility(
  species: string,
  item?: string,
  ability?: string,
  mega = true,
): string | undefined {
  const forme = battleForme(species, item, mega);
  if (forme === (getSpecies(species)?.name ?? species)) return ability;
  return getSpecies(forme)?.abilities?.[0] || ability;
}

/** Piedras con las que puede megaevolucionar la especie (Charizard → Charizardite X e Y). */
export function megaStonesFor(species: string): string[] {
  const baseName = getSpecies(species)?.name ?? species;
  const stones: string[] = [];
  for (const item of GEN.items) {
    const stone: Readonly<Record<string, string>> | undefined = item.megaStone;
    if (stone?.[baseName]) stones.push(item.name);
  }
  return stones.sort();
}

/**
 * Especie tal y como se ve en team preview: las megas cuentan como su forma base, que es lo que
 * va antes de "-Mega" ("Charizard-Mega-X" → "Charizard", "Meowstic-F-Mega" → "Meowstic-F").
 */
export function previewSpecies(name: string): string {
  const species = getSpecies(name);
  if (!species) return name;
  // Cualquier forma de combate de Aegislash ("Aegislash-Blade"...) se ve como Aegislash.
  const preview = Object.keys(CALC_FORMES).find(
    (p) => species.name === p || species.name.startsWith(`${p}-`),
  );
  if (preview) return preview;
  const base = species.name.replace(/-(Mega|Primal)(-.*)?$/, '');
  return base === species.name
    ? species.name
    : (getSpecies(base)?.name ?? species.baseSpecies ?? base);
}

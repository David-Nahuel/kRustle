import { SideKey, StatPoints, StatsTable } from './calculator.types';

export type PokemonSet = {
  name: string;
  level: number;
  types: string[];
  ability: string;
  item?: string;
  nature?: string;
  teraType?: string;
  sp?: StatPoints;
  boosts?: StatsTable;
  currentHp?: number;
  status?: string;
  moves: string[];
};

export type EditTarget = {
  pokemon: PokemonSet;
  side: SideKey;
  index: number;
};

export type PokemonDexEntry = {
  name: string;
  types: string[];
  abilities: Record<string, string>;
  moves: string[];
};

export type MoveDexEntry = {
  name: string;
  type: string;
  category?: string;
  description?: string;
  target?: string;
  power?: number;
  accuracy?: number;
  pp?: number;
  priority?: number;
};

export type ItemDexEntry = {
  name: string;
  description?: string;
};

export type AbilityDexEntry = {
  name: string;
  description?: string;
};
import type { PokemonSet } from './pokemon.models';

export type TeamImportRequest = {
  allyShowdown: string;
  enemyNames: string[];
};

export type TeamRecommendationReason = {
  pokemonName: string;
  summary: string;
};

export type TeamImportResponse = {
  recommendedLeadFour: string[];
  allyTeam: PokemonSet[];
  completedEnemyTeam: PokemonSet[];
  reasoning?: TeamRecommendationReason[];
};

export type CalculatorSession = {
  allyTeam: PokemonSet[];
  enemyTeam: PokemonSet[];
  recommendedFour: string[];
  source: 'manual' | 'team-import';
};
export type StatsTable = {
  hp?: number;
  atk?: number;
  def?: number;
  spa?: number;
  spd?: number;
  spe?: number;
};

export type StatPoints = StatsTable;

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

export type EnemySlot = {
  name: string;
};

export type TeamImportFormValue = {
  myPaste: string;
  enemyNames: string[];
};

export type BattleSession = {
  myTeam: PokemonSet[];
  enemyTeam: PokemonSet[];
  source: 'manual' | 'api';
};
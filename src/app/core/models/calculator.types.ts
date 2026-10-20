export type SideKey = 'mine' | 'enemy';

export type ScreenKey = 'auroraVeil' | 'lightScreen' | 'reflect';

export type StatsTable = {
  hp?: number;
  atk?: number;
  def?: number;
  spa?: number;
  spd?: number;
  spe?: number;
};

export type StatPoints = StatsTable;

export type SideScreens = {
  auroraVeil: boolean;
  lightScreen: boolean;
  reflect: boolean;
};

export type ThreatLevel = 'OHKO' | '2HKO' | 'Chip';

export type SpStatOption = {
  key: keyof StatPoints;
  label: string;
};
import { ThreatLevel } from './calculator.types';

export type DamageRow = {
  moveName: string;
  description: string;
  damage: number[];
  minPercent: string;
  maxPercent: string;
  koChance: string;
  threat: ThreatLevel;
};
import { describe, expect, it } from 'vitest';

import {
  type MoveInfo,
  addBoosts,
  blockReason,
  effectivePriority,
  intimidateEffect,
  moveInfo,
} from './moves';

const CATALOG = new Map<string, MoveInfo>([
  ['Trick Room', { type: 'Psychic', category: 'Status', priority: -7, target: 'all', flags: [] }],
  [
    'Thunder Wave',
    { type: 'Electric', category: 'Status', priority: 0, target: 'normal', flags: ['reflectable'] },
  ],
  [
    'Tailwind',
    { type: 'Flying', category: 'Status', priority: 0, target: 'allySide', flags: ['wind'] },
  ],
  [
    'Rage Powder',
    { type: 'Bug', category: 'Status', priority: 2, target: 'self', flags: ['powder'] },
  ],
  [
    'Spore',
    {
      type: 'Grass',
      category: 'Status',
      priority: 0,
      target: 'normal',
      flags: ['powder', 'reflectable'],
    },
  ],
  ['Recover', { type: 'Normal', category: 'Status', priority: 0, target: 'self', flags: ['heal'] }],
]);
const info = (name: string) => moveInfo(CATALOG, name)!;
const check = (
  move: string,
  user: string,
  ability: string | undefined,
  target: string,
  targetAbility?: string,
  field = {},
) => {
  const u = { species: user, ability };
  const t = { species: target, ability: targetAbility };
  return blockReason(move, info(move), effectivePriority(move, info(move), u, field), u, t, field);
};

describe('moveInfo', () => {
  it('usa los datos del roster y, si no están, los de la calculadora', () => {
    expect(info('Trick Room').priority).toBe(-7);
    expect(moveInfo(CATALOG, 'Fake Out')).toMatchObject({ priority: 3, category: 'Physical' });
  });
});

describe('effectivePriority', () => {
  it('Prankster da +1 solo a los movimientos de estado', () => {
    const whimsicott = { species: 'Whimsicott', ability: 'Prankster' };
    expect(effectivePriority('Tailwind', info('Tailwind'), whimsicott)).toEqual({
      value: 1,
      source: 'Prankster',
    });
    expect(effectivePriority('Moonblast', moveInfo(CATALOG, 'Moonblast')!, whimsicott).value).toBe(
      0,
    );
  });

  it('Grassy Glide tiene prioridad en Grassy Terrain y Gale Wings solo con los PS al máximo', () => {
    const rilla = { species: 'Rillaboom', ability: 'Grassy Surge' };
    const glide = moveInfo(CATALOG, 'Grassy Glide')!;
    expect(effectivePriority('Grassy Glide', glide, rilla, { terrain: 'Grassy' }).value).toBe(1);
    expect(effectivePriority('Grassy Glide', glide, rilla).value).toBe(0);
    const talon = { species: 'Talonflame', ability: 'Gale Wings' };
    const bird = moveInfo(CATALOG, 'Brave Bird')!;
    expect(effectivePriority('Brave Bird', bird, talon).value).toBe(1);
    expect(effectivePriority('Brave Bird', bird, { ...talon, hpPercent: 90 }).value).toBe(0);
  });
});

describe('blockReason', () => {
  it('Prankster falla contra tipo Siniestro', () => {
    expect(check('Thunder Wave', 'Whimsicott', 'Prankster', 'Kingambit')).toEqual({
      code: 'pranksterDark',
    });
    expect(check('Thunder Wave', 'Raichu', 'Lightning Rod', 'Kingambit')).toBeUndefined();
  });

  it('Armor Tail y Psychic Terrain bloquean la prioridad', () => {
    expect(check('Fake Out', 'Incineroar', 'Intimidate', 'Farigiraf', 'Armor Tail')).toEqual({
      code: 'blockedByAbility',
      ability: 'Armor Tail',
    });
    expect(
      check('Fake Out', 'Incineroar', 'Intimidate', 'Garchomp', 'Rough Skin', {
        terrain: 'Psychic',
      }),
    ).toEqual({ code: 'psychicTerrain' });
    // Los que no tocan el suelo no están protegidos por Psychic Terrain.
    expect(
      check('Fake Out', 'Incineroar', 'Intimidate', 'Talonflame', 'Flame Body', {
        terrain: 'Psychic',
      }),
    ).toBeUndefined();
  });

  it('Mold Breaker ignora las habilidades que bloquean', () => {
    expect(
      check('Sucker Punch', 'Kingambit', 'Mold Breaker', 'Farigiraf', 'Armor Tail'),
    ).toBeUndefined();
  });

  it('inmunidades de estado: Good as Gold, polvos, tipos', () => {
    expect(check('Thunder Wave', 'Raichu', 'Lightning Rod', 'Gholdengo', 'Good as Gold')).toEqual({
      code: 'immuneByAbility',
      ability: 'Good as Gold',
    });
    expect(check('Spore', 'Amoonguss', 'Regenerator', 'Rillaboom', 'Grassy Surge')).toEqual({
      code: 'powder',
    });
    expect(check('Thunder Wave', 'Raichu', 'Lightning Rod', 'Garchomp', 'Rough Skin')).toEqual({
      code: 'statusType',
      type: 'Ground',
    });
    expect(check('Thunder Wave', 'Raichu', 'Lightning Rod', 'Hatterene', 'Magic Bounce')).toEqual({
      code: 'magicBounce',
    });
  });

  it('inmunidades de daño por tipo y por habilidad', () => {
    expect(check('Earthquake', 'Garchomp', 'Rough Skin', 'Rotom-Wash', 'Levitate')).toEqual({
      code: 'immuneByAbility',
      ability: 'Levitate',
    });
    expect(check('Thunderbolt', 'Raichu', 'Lightning Rod', 'Raichu', 'Lightning Rod')).toEqual({
      code: 'immuneByAbility',
      ability: 'Lightning Rod',
    });
    expect(check('Close Combat', 'Sneasler', 'Unburden', 'Gengar', 'Cursed Body')).toEqual({
      code: 'typeImmune',
    });
    expect(
      check('Earthquake', 'Garchomp', 'Rough Skin', 'Incineroar', 'Intimidate'),
    ).toBeUndefined();
  });

  it('usa los tipos de la mega solo si ya ha megaevolucionado', () => {
    const info = moveInfo(CATALOG, 'Earthquake')!;
    const garchomp = { species: 'Garchomp', ability: 'Rough Skin' };
    const zard = (mega: boolean) => ({ species: 'Charizard', item: 'Charizardite X', mega });
    // Charizard es Fuego/Volador; la Mega X, Fuego/Dragón.
    expect(blockReason('Earthquake', info, { value: 0 }, garchomp, zard(false))).toEqual({
      code: 'typeImmune',
    });
    expect(blockReason('Earthquake', info, { value: 0 }, garchomp, zard(true))).toBeUndefined();
  });

  it('no se aplican a movimientos sobre uno mismo o el campo', () => {
    expect(check('Trick Room', 'Farigiraf', 'Armor Tail', 'Kingambit')).toBeUndefined();
    expect(check('Rage Powder', 'Amoonguss', 'Regenerator', 'Rillaboom')).toBeUndefined();
  });
});

describe('intimidateEffect', () => {
  it('depende de la habilidad de quien lo recibe', () => {
    expect(intimidateEffect({ species: 'Garchomp', ability: 'Rough Skin' })).toEqual({ atk: -1 });
    expect(intimidateEffect({ species: 'Kingambit', ability: 'Defiant' })).toEqual({ atk: 1 });
    expect(intimidateEffect({ species: 'Milotic', ability: 'Competitive' })).toEqual({
      atk: -1,
      spa: 2,
    });
    expect(intimidateEffect({ species: 'Metagross', ability: 'Clear Body' })).toEqual({});
    expect(
      intimidateEffect({ species: 'Garchomp', ability: 'Rough Skin', item: 'Clear Amulet' }),
    ).toEqual({});
  });

  it('se suma a los cambios de stat sin pasarse de ±6', () => {
    expect(addBoosts({ atk: -6, spe: 1 }, { atk: -1, spa: 2 })).toEqual({
      atk: -6,
      spe: 1,
      spa: 2,
    });
  });
});

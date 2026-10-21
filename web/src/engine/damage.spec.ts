import { describe, expect, it } from 'vitest';

import {
  abilitiesByUsage,
  battleForme,
  emptyStats,
  megaStonesFor,
  previewSpecies,
} from './champions';
import { type Combatant, calcDamage, currentHp, damageOverSpreads, maxHp } from './damage';
import type { SpeciesUsage } from './metagame';

const sps = (partial: Partial<ReturnType<typeof emptyStats>>) => ({ ...emptyStats(), ...partial });

const garchomp: Combatant = {
  species: 'Garchomp',
  item: 'Choice Scarf',
  ability: 'Rough Skin',
  nature: 'Jolly',
  sps: sps({ atk: 32, spe: 32, hp: 2 }),
};
const incineroar: Combatant = {
  species: 'Incineroar',
  item: 'Sitrus Berry',
  ability: 'Intimidate',
  nature: 'Careful',
  sps: sps({ hp: 32, spd: 32, def: 2 }),
};

describe('battleForme', () => {
  it('resuelve las megas nuevas por su piedra', () => {
    expect(battleForme('Garchomp', 'Garchompite Z')).toBe('Garchomp-Mega-Z');
    expect(battleForme('Raichu', 'Raichunite Y')).toBe('Raichu-Mega-Y');
    expect(battleForme('Charizard', 'Charizardite X')).toBe('Charizard-Mega-X');
    expect(battleForme('Garchomp', 'Choice Scarf')).toBe('Garchomp');
  });

  it('con la piedra pero sin megaevolucionar aún, es la forma base', () => {
    expect(battleForme('Charizard', 'Charizardite Y', false)).toBe('Charizard');
  });

  it('Aegislash, que la calculadora solo conoce por sus formas, ataca en Blade y defiende en Shield', () => {
    expect(battleForme('Aegislash', 'Life Orb')).toBe('Aegislash-Both');
  });
});

describe('previewSpecies', () => {
  it('cualquier forma de Aegislash se ve como Aegislash', () => {
    for (const name of ['Aegislash', 'Aegislash-Both', 'Aegislash-Blade', 'Aegislash-Shield']) {
      expect(previewSpecies(name)).toBe('Aegislash');
    }
    expect(previewSpecies('Charizard-Mega-Y')).toBe('Charizard');
  });
});

describe('abilitiesByUsage', () => {
  const usage = (abilities: [string, number][]) => ({ abilities }) as SpeciesUsage;

  it('pone primero la más usada en torneos, aunque no sea la primera del dex', () => {
    expect(
      abilitiesByUsage('Rillaboom', usage([['Grassy Surge', 0.99]]), ['Overgrow', 'Grassy Surge']),
    ).toEqual(['Grassy Surge', 'Overgrow']);
  });

  it('ignora lo que no es una habilidad de la especie', () => {
    expect(
      abilitiesByUsage('Incineroar', usage([['Levitate', 0.5]]), ['Blaze', 'Intimidate']),
    ).toEqual(['Blaze', 'Intimidate']);
  });

  it('sin la lista completa, usa la de la calculadora (solo trae la primera)', () => {
    expect(abilitiesByUsage('Incineroar')).toEqual(['Blaze']);
  });
});

describe('megaStonesFor', () => {
  it('lista todas las piedras de la especie', () => {
    expect(megaStonesFor('Charizard')).toEqual(['Charizardite X', 'Charizardite Y']);
    expect(megaStonesFor('Incineroar')).toEqual([]);
  });
});

describe('calcDamage', () => {
  it('calcula un rango de daño coherente', () => {
    const r = calcDamage(garchomp, incineroar, 'Earthquake')!;
    expect(r.move).toBe('Earthquake');
    expect(r.minPercent).toBeGreaterThan(0);
    expect(r.maxPercent).toBeGreaterThan(r.minPercent);
    expect(r.description).toContain('Earthquake');
  });

  it('calcula con Aegislash en los dos sentidos', () => {
    const aegislash: Combatant = {
      species: 'Aegislash',
      item: 'Life Orb',
      ability: 'Stance Change',
      nature: 'Quiet',
      sps: sps({ hp: 32, spa: 32, def: 2 }),
    };
    expect(calcDamage(aegislash, garchomp, 'Shadow Ball')!.maxPercent).toBeGreaterThan(0);
    expect(calcDamage(incineroar, aegislash, 'Flare Blitz')!.maxPercent).toBeGreaterThan(0);
  });

  it('aplica los cambios de stat (Intimidate)', () => {
    const normal = calcDamage(garchomp, incineroar, 'Earthquake')!;
    const intimidated = calcDamage({ ...garchomp, boosts: { atk: -1 } }, incineroar, 'Earthquake')!;
    expect(intimidated.max).toBeLessThan(normal.max);
  });

  it('megaevoluciona si lleva la piedra, con los tipos y stats de la mega', () => {
    const base = calcDamage({ ...garchomp, item: undefined }, incineroar, 'Earthquake')!;
    const mega = calcDamage({ ...garchomp, item: 'Garchompite Z' }, incineroar, 'Earthquake')!;
    expect(mega.description).toContain('Garchomp-Mega-Z');
    // Garchomp-Mega-Z es Dragón puro: Earthquake pierde el STAB.
    expect(mega.max).toBeLessThan(base.max);
  });

  it('con la piedra pero sin megaevolucionar, calcula con la forma base', () => {
    const zard: Combatant = {
      species: 'Charizard',
      item: 'Charizardite Y',
      ability: 'Solar Power',
      nature: 'Modest',
      sps: sps({ spa: 32, spe: 32, hp: 2 }),
    };
    const before = calcDamage({ ...zard, mega: false }, incineroar, 'Air Slash')!;
    const after = calcDamage({ ...zard, mega: true }, incineroar, 'Air Slash')!;
    expect(before.description).not.toContain('Mega');
    expect(after.description).toContain('Charizard-Mega-Y');
    expect(after.max).toBeGreaterThan(before.max);
  });

  it('los PS actuales afectan a los golpes necesarios', () => {
    const full = calcDamage(garchomp, incineroar, 'Earthquake')!;
    const low = calcDamage(garchomp, { ...incineroar, hpPercent: 30 }, 'Earthquake')!;
    expect(low.hitsToKo).toBeLessThan(full.hitsToKo);
  });

  it('los PS escritos a mano vuelven exactos tras guardarse como porcentaje', () => {
    const max = maxHp(incineroar);
    expect(max).toBeGreaterThan(150);
    for (let hp = 0; hp <= max; hp++) expect(currentHp(max, (hp / max) * 100)).toBe(hp);
  });

  it('devuelve null para movimientos de estado o desconocidos', () => {
    expect(calcDamage(garchomp, incineroar, 'Protect')).toBeNull();
    expect(calcDamage(garchomp, incineroar, 'Movimiento Inventado')).toBeNull();
  });
});

describe('damageOverSpreads', () => {
  const offensive = { nature: 'Jolly', sps: sps({ atk: 32, spe: 32, hp: 2 }) };
  const bulky = { nature: 'Careful', sps: sps({ hp: 32, spd: 32, def: 2 }) };

  it('resume el daño sobre los repartos posibles del defensor', () => {
    const frail = { ...incineroar, sps: offensive.sps, nature: offensive.nature };
    const fragile = calcDamage(garchomp, frail, 'Earthquake')!;
    const sturdy = calcDamage(garchomp, { ...incineroar, ...bulky }, 'Earthquake')!;
    const odds = damageOverSpreads(garchomp, incineroar, 'Earthquake', 'defender', [
      { ...bulky, probability: 0.8 },
      { ...offensive, probability: 0.2 },
    ])!;
    expect(odds.likely).toEqual(sturdy);
    expect(odds.percentRange[0]).toBe(sturdy.minPercent);
    expect(odds.percentRange[1]).toBe(fragile.maxPercent);
    expect(odds.twoHkoChance).toBeGreaterThan(0);
    expect(odds.twoHkoChance).toBeLessThanOrEqual(1);
  });

  it('cuando el rival ataca, varía los SP del atacante', () => {
    const odds = damageOverSpreads(garchomp, incineroar, 'Earthquake', 'attacker', [
      { nature: 'Adamant', sps: sps({ atk: 32 }), probability: 0.5 },
      { nature: 'Modest', sps: sps({ spa: 32 }), probability: 0.5 },
    ])!;
    expect(odds.percentRange[1]).toBeGreaterThan(odds.percentRange[0]);
  });

  it('devuelve null con movimientos de estado', () => {
    expect(
      damageOverSpreads(garchomp, incineroar, 'Protect', 'defender', [
        { ...bulky, probability: 1 },
      ]),
    ).toBeNull();
  });
});

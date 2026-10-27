import { describe, expect, it } from 'vitest';

import { emptyStats } from './champions';
import { comboOdds } from './combined';
import { type Combatant, damageRolls, maxHp } from './damage';

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
  ability: 'Intimidate',
  nature: 'Careful',
  sps: sps({ hp: 32, spd: 32, def: 2 }),
};
const dragonite: Combatant = {
  species: 'Dragonite',
  ability: 'Multiscale',
  nature: 'Adamant',
  sps: sps({ hp: 32, atk: 32 }),
};

/** Probabilidad de que la suma de dos golpes de un solo impacto llegue a `hp`, tirada a tirada. */
function bruteForce(a: number[], b: number[], hp: number): number {
  let ko = 0;
  for (const x of a) for (const y of b) if (x + y >= hp) ko++;
  return ko / (a.length * b.length);
}

const rolls = (attacker: Combatant, defender: Combatant, move: string) =>
  damageRolls(attacker, defender, move)![0];

describe('comboOdds', () => {
  it('dos golpes que por separado no debilitan, juntos sí', () => {
    const hp = maxHp(incineroar);
    expect(Math.max(...rolls(garchomp, incineroar, 'Earthquake'))).toBeLessThan(hp);
    expect(Math.max(...rolls(garchomp, incineroar, 'Stone Edge'))).toBeLessThan(hp);
    const odds = comboOdds(
      { attacker: garchomp, move: 'Earthquake' },
      { attacker: garchomp, move: 'Stone Edge' },
      incineroar,
    )!;
    expect(odds.koChance).toBe(1);
    expect(odds.likely.minPercent).toBeGreaterThan(100);
  });

  it('combina las 16 tiradas de cada golpe', () => {
    const odds = comboOdds(
      { attacker: garchomp, move: 'Earthquake' },
      { attacker: garchomp, move: 'Poison Jab' },
      incineroar,
    )!;
    const expected = bruteForce(
      rolls(garchomp, incineroar, 'Earthquake'),
      rolls(garchomp, incineroar, 'Poison Jab'),
      maxHp(incineroar),
    );
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(1);
    expect(odds.koChance).toBeCloseTo(expected, 10);
  });

  it('cuenta los PS que le quedan', () => {
    const full = comboOdds(
      { attacker: garchomp, move: 'Dragon Claw' },
      { attacker: garchomp, move: 'Poison Jab' },
      incineroar,
    )!;
    const hurt = comboOdds(
      { attacker: garchomp, move: 'Dragon Claw' },
      { attacker: garchomp, move: 'Poison Jab' },
      { ...incineroar, hpPercent: 60 },
    )!;
    expect(full.koChance).toBe(0);
    expect(hurt.koChance).toBe(1);
  });

  it('la Sitrus Berry se come tras el primer golpe si lo deja a la mitad', () => {
    const sitrus = { ...incineroar, item: 'Sitrus Berry' };
    const eq = rolls(garchomp, sitrus, 'Earthquake');
    const jab = rolls(garchomp, sitrus, 'Poison Jab');
    const hp = maxHp(sitrus);
    // Earthquake primero lo deja por debajo de la mitad: se cura y Poison Jab no llega.
    // Poison Jab primero no baja de la mitad: sin curación, Earthquake puede rematar.
    expect(Math.min(...eq)).toBeGreaterThanOrEqual(hp / 2);
    expect(Math.max(...jab)).toBeLessThan(hp / 2);
    const odds = comboOdds(
      { attacker: garchomp, move: 'Earthquake' },
      { attacker: garchomp, move: 'Poison Jab' },
      sitrus,
    )!;
    expect(odds.koChance).toBeCloseTo(bruteForce(jab, eq, hp) / 2, 10);

    const eaten = comboOdds(
      { attacker: garchomp, move: 'Earthquake' },
      { attacker: garchomp, move: 'Poison Jab' },
      { ...sitrus, itemConsumed: true },
    )!;
    expect(eaten.koChance).toBeCloseTo(bruteForce(eq, jab, hp), 10);
  });

  it('Multiscale solo reduce el primer golpe', () => {
    const shielded = rolls(garchomp, dragonite, 'Stone Edge');
    const unshielded = rolls(garchomp, { ...dragonite, hpPercent: 99 }, 'Stone Edge');
    const hp = maxHp(dragonite);
    expect(Math.max(...shielded) * 2).toBeLessThan(hp);
    const odds = comboOdds(
      { attacker: garchomp, move: 'Stone Edge' },
      { attacker: garchomp, move: 'Stone Edge' },
      dragonite,
    )!;
    expect(odds.koChance).toBeGreaterThan(0);
    expect(odds.koChance).toBeCloseTo(bruteForce(shielded, unshielded, hp), 10);
  });

  it('suma los golpes de los movimientos de varios impactos', () => {
    const darts = damageRolls(garchomp, incineroar, 'Dragon Darts')!;
    const jab = rolls(garchomp, incineroar, 'Poison Jab');
    expect(darts.length).toBe(2);
    const odds = comboOdds(
      { attacker: garchomp, move: 'Dragon Darts' },
      { attacker: garchomp, move: 'Poison Jab' },
      incineroar,
    )!;
    const min = darts[0][0] + darts[1][0] + jab[0];
    expect(odds.likely.minPercent).toBeCloseTo((min / maxHp(incineroar)) * 100, 1);
  });

  it('con los SP del atacante desconocidos, pondera cada reparto', () => {
    const strong = { nature: 'Adamant', sps: sps({ atk: 32 }) };
    const weak = { nature: 'Modest', sps: sps({ spa: 32 }) };
    const withSpread = (spread: typeof strong) =>
      comboOdds(
        { attacker: { ...garchomp, ...spread }, move: 'Earthquake' },
        { attacker: garchomp, move: 'Poison Jab' },
        incineroar,
      )!.koChance;
    const odds = comboOdds(
      {
        attacker: garchomp,
        move: 'Earthquake',
        spreads: [
          { ...strong, probability: 0.75 },
          { ...weak, probability: 0.25 },
        ],
      },
      { attacker: garchomp, move: 'Poison Jab' },
      incineroar,
    )!;
    expect(withSpread(strong)).not.toBe(withSpread(weak));
    expect(odds.koChance).toBeCloseTo(0.75 * withSpread(strong) + 0.25 * withSpread(weak), 10);
  });

  it('con los SP del defensor desconocidos, el daño probable es el del reparto más probable', () => {
    const bulky = { nature: 'Careful', sps: sps({ hp: 32, spd: 32, def: 2 }) };
    const frail = { nature: 'Jolly', sps: sps({ atk: 32, spe: 32 }) };
    const known = comboOdds(
      { attacker: garchomp, move: 'Earthquake' },
      { attacker: garchomp, move: 'Poison Jab' },
      { ...incineroar, ...bulky },
    )!;
    const odds = comboOdds(
      { attacker: garchomp, move: 'Earthquake' },
      { attacker: garchomp, move: 'Poison Jab' },
      incineroar,
      {},
      [
        { ...bulky, probability: 0.6 },
        { ...frail, probability: 0.4 },
      ],
    )!;
    expect(odds.likely).toEqual(known.likely);
    expect(odds.percentRange[1]).toBeGreaterThan(known.likely.maxPercent);
    expect(odds.koChance).toBeGreaterThan(known.koChance);
  });

  it('devuelve null si uno de los dos no hace daño', () => {
    expect(
      comboOdds(
        { attacker: garchomp, move: 'Earthquake' },
        { attacker: garchomp, move: 'Protect' },
        incineroar,
      ),
    ).toBeNull();
  });
});

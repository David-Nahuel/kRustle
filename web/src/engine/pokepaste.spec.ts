import { describe, expect, it } from 'vitest';

import { addMember, formatMember, parsePokepaste, updateMember } from './pokepaste';

describe('parsePokepaste', () => {
  it('lee un set completo con mote, género y Stat Points', () => {
    const { members, warnings } = parsePokepaste(`
Gato (Incineroar) (M) @ Sitrus Berry
Ability: Intimidate
Level: 50
EVs: 32 HP / 2 Def / 32 SpD
Careful Nature
- Fake Out
- Flare Blitz
- Darkest Lariat
- Parting Shot
`);
    expect(warnings).toEqual([]);
    expect(members).toEqual([
      {
        nickname: 'Gato',
        species: 'Incineroar',
        item: 'Sitrus Berry',
        ability: 'Intimidate',
        nature: 'Careful',
        sps: { hp: 32, atk: 0, def: 2, spa: 0, spd: 32, spe: 0 },
        moves: ['Fake Out', 'Flare Blitz', 'Darkest Lariat', 'Parting Shot'],
      },
    ]);
  });

  it('convierte EVs clásicos a Stat Points', () => {
    const { members, warnings } = parsePokepaste(`Garchomp @ Choice Scarf
EVs: 4 HP / 252 Atk / 252 Spe
Jolly Nature
- Earthquake`);
    expect(members[0].sps).toEqual({ hp: 1, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 });
    expect(warnings).toHaveLength(1);
  });

  it('acepta la etiqueta SPs y recorta si se pasa de 66', () => {
    const { members, warnings } = parsePokepaste(`Sneasler
SPs: 32 Atk / 32 Spe / 10 HP`);
    expect(members[0].sps).toEqual({ hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 });
    expect(warnings[0]).toEqual({ code: 'spOverflow', species: 'Sneasler', max: 66 });
  });

  it('guarda las megas como su especie base, que es lo que se ve en team preview', () => {
    const { members } = parsePokepaste('Garchomp-Mega-Z @ Garchompite Z');
    expect(members[0].species).toBe('Garchomp');
    expect(members[0].item).toBe('Garchompite Z');
    expect(parsePokepaste('Meowstic-F-Mega').members[0].species).toBe('Meowstic-F');
  });

  it('explica lo que no entiende sin romper el resto del equipo', () => {
    const { members, warnings } = parsePokepaste(`Pikachu @ Light Ball
- Thunderbolt
- Movimiento Inventado

Fakemon @ Leftovers

Pikachu
- Volt Tackle`);
    expect(members.map((m) => m.species)).toEqual(['Pikachu']);
    expect(members[0].moves).toEqual(['Thunderbolt']);
    expect(warnings.filter((w) => w.code !== 'noSpread')).toEqual([
      { code: 'unknownMove', species: 'Pikachu', value: 'Movimiento Inventado' },
      { code: 'unknownSpecies', value: 'Fakemon' },
      { code: 'duplicate', species: 'Pikachu' },
    ]);
  });

  it('avisa si faltan los Stat Points (Showdown no exporta los que están a 0)', () => {
    const { warnings } = parsePokepaste(`Charizard @ Charizardite Y
Ability: Blaze
Level: 50
Tera Type: None
- Heat Wave

Garchomp @ Garchompite Z
Jolly Nature
- Earthquake`);
    expect(warnings).toEqual([
      { code: 'noSpread', species: ['Charizard'], noNature: true },
      { code: 'noSpread', species: ['Garchomp'], noNature: false },
    ]);
  });
});

describe('editar el paste desde la interfaz', () => {
  const TEAM = `Charizard @ Charizardite Y
Ability: Blaze
Level: 50
Tera Type: None
EVs: 2 HP / 32 SpA / 32 Spe
Timid Nature
- Heat Wave
- Weather Ball

Pikachu (M) @ Light Ball
Ability: Static
- Movimiento Inventado
- Thunderbolt`;

  it('escribir y volver a leer da el mismo Pokémon', () => {
    for (const member of parsePokepaste(TEAM).members) {
      expect(parsePokepaste(formatMember(member)).members[0]).toEqual(member);
    }
  });

  it('cambia solo el bloque del Pokémon editado; el resto queda como estaba', () => {
    const [zard] = parsePokepaste(TEAM).members;
    const text = updateMember(TEAM, 0, { ...zard, nature: 'Modest' });
    expect(parsePokepaste(text).members[0].nature).toBe('Modest');
    // Pikachu no se ha tocado: conserva lo que no se entiende (y su aviso).
    expect(text).toContain('Pikachu (M) @ Light Ball');
    expect(text).toContain('- Movimiento Inventado');
    // Charizard se reescribe en limpio: sin Level ni Tera Type.
    expect(text).not.toContain('Tera Type');
  });

  it('quita y añade Pokémon', () => {
    const [, pikachu] = parsePokepaste(TEAM).members;
    const without = updateMember(TEAM, 0, null);
    expect(parsePokepaste(without).members.map((m) => m.species)).toEqual(['Pikachu']);
    const added = addMember(without, { ...pikachu, species: 'Raichu', moves: [] });
    expect(parsePokepaste(added).members.map((m) => m.species)).toEqual(['Pikachu', 'Raichu']);
    expect(addMember('', pikachu)).toBe(`${formatMember(pikachu)}\n`);
  });

  it('salta los bloques que no son Pokémon al buscar cuál editar', () => {
    const text = `Fakemon @ Leftovers\n\n${TEAM}`;
    const [zard] = parsePokepaste(text).members;
    const edited = updateMember(text, 0, { ...zard, item: 'Life Orb' });
    expect(edited.startsWith('Fakemon @ Leftovers')).toBe(true);
    expect(parsePokepaste(edited).members[0].item).toBe('Life Orb');
  });
});

import { describe, expect, it } from 'vitest';

import { decodeTeam, encodeTeam } from './share';

const PASTE = `Incineroar @ Sitrus Berry
Ability: Intimidate
EVs: 32 HP / 2 Def / 32 SpD
Careful Nature
- Fake Out
- Flare Blitz
- Darkest Lariat
- Parting Shot

Flutter Mane @ Choice Specs
Ability: Protosynthesis
EVs: 2 HP / 32 SpA / 32 Spe
Timid Nature
- Moonblast
- Shadow Ball
- Dazzling Gleam
- Thunderbolt`;

describe('encodeTeam / decodeTeam', () => {
  it('el equipo vuelve igual, con nombre y caracteres no ASCII', async () => {
    const team = { name: 'Lluvia — versión ñ 🌧️', paste: PASTE };
    const fragment = await encodeTeam(team);
    expect(await decodeTeam(fragment)).toEqual(team);
  });

  it('cabe en una URL: solo caracteres seguros y corto', async () => {
    const fragment = await encodeTeam({ name: 'Rain', paste: PASTE });
    expect(fragment).toMatch(/^t1\.[A-Za-z0-9_-]+$/);
    // Un equipo de 6 queda en ~1 KB; aquí son 2 Pokémon.
    expect(fragment.length).toBeLessThan(400);
  });

  it('lo que no es un enlace de equipo da null', async () => {
    expect(await decodeTeam(null)).toBeNull();
    expect(await decodeTeam('')).toBeNull();
    expect(await decodeTeam('seccion')).toBeNull();
    expect(await decodeTeam('t1.esto-no-es-deflate')).toBeNull();
    expect(await decodeTeam('t1.@@@')).toBeNull();
  });

  it('un equipo sin paste no vale', async () => {
    expect(await decodeTeam(await encodeTeam({ name: 'Vacío', paste: '  ' }))).toBeNull();
  });

  it('no descomprime sin límite', async () => {
    const huge = await encodeTeam({ name: 'x', paste: 'a'.repeat(200_000) });
    expect(huge.length).toBeLessThan(2_000);
    expect(await decodeTeam(huge)).toBeNull();
  });
});

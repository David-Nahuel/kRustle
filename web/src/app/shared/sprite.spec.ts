import { describe, expect, it } from 'vitest';

import { spriteId } from './sprite';

describe('spriteId', () => {
  it('usa el id de Showdown de la especie o forma', () => {
    expect(spriteId('Rotom-Wash')).toBe('rotom-wash');
    expect(spriteId('Kommo-o')).toBe('kommoo');
  });

  it('Aegislash usa su sprite de team preview, no el de la forma con la que se calcula', () => {
    expect(spriteId('Aegislash')).toBe('aegislash');
  });
});

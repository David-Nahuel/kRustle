import { describe, expect, it } from 'vitest';

import { winRateTone } from './format';

describe('winRateTone', () => {
  it('destaca lo que se aleja del 50% más de lo que daría el azar', () => {
    // Weavile contra Rillaboom: 76% en 43 partidas.
    expect(winRateTone(0.756, 43)).toBe('good');
    expect(winRateTone(0.383, 363)).toBe('bad');
  });

  it('con pocas partidas, ni un winrate alto se destaca', () => {
    expect(winRateTone(0.65, 20)).toBe('neutral');
  });

  it('con muchas partidas, tiene que alejarse al menos 3 puntos', () => {
    expect(winRateTone(0.514, 5000)).toBe('neutral');
    expect(winRateTone(0.535, 5000)).toBe('good');
  });

  it('sin datos, neutro', () => {
    expect(winRateTone(null, 100)).toBe('neutral');
    expect(winRateTone(0.9, 0)).toBe('neutral');
  });
});

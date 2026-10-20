import { describe, expect, it } from 'vitest';

import { MESSAGES } from './messages';

const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('MESSAGES', () => {
  it('cada texto tiene los mismos parámetros en todos los idiomas', () => {
    const mismatched = Object.entries(MESSAGES.en)
      .filter(([key, text]) =>
        Object.values(MESSAGES).some(
          (messages) =>
            JSON.stringify(params(messages[key as keyof typeof messages])) !==
            JSON.stringify(params(text)),
        ),
      )
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it('no hay textos vacíos', () => {
    for (const messages of Object.values(MESSAGES)) {
      expect(Object.entries(messages).filter(([, text]) => !text.trim())).toEqual([]);
    }
  });
});

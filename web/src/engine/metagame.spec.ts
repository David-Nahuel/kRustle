import { describe, expect, it } from 'vitest';

import shared from '../../../pipeline/team-weight-cases.json';
import { teamWeight } from './metagame';

describe('teamWeight', () => {
  it('coincide con el pipeline (pipeline/team-weight-cases.json)', () => {
    for (const c of shared.cases) {
      expect(teamWeight(c.ageDays, c.halfLifeDays, c.wins, c.losses)).toBeCloseTo(c.weight, 6);
    }
  });
});

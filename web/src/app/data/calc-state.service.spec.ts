import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { CalcState } from './calc-state.service';

describe('CalcState: partidas de una serie', () => {
  let state: CalcState;

  beforeEach(() => {
    localStorage.clear();
    state = TestBed.inject(CalcState);
    state.useRivalTeam(['Kingambit', 'Incineroar']);
  });

  it('la siguiente partida reinicia la vida pero recuerda lo que ha enseñado el rival', () => {
    state.updateRevealed('Kingambit', { item: 'Black Glasses', moves: ['Sucker Punch'] });
    state.updateRivalStatus('Kingambit', { hp: 20, boosts: { atk: 2 } });
    state.field.set({ trickRoom: true });

    state.newGame();

    expect(state.game()).toBe(2);
    expect(state.revealedOf('Kingambit')).toEqual({
      item: 'Black Glasses',
      moves: ['Sucker Punch'],
    });
    expect(state.earlier()).toEqual({ item: 'Black Glasses', moves: ['Sucker Punch'] });
    expect(state.rivalStatusOf('Kingambit').hp).toBe(100);
    expect(state.rivalStatusOf('Kingambit').boosts).toEqual({});
    expect(state.field().trickRoom).toBe(false);
  });

  it('lo que se ve en la partida nueva se suma, sin marcarse como de antes', () => {
    state.updateRevealed('Kingambit', { item: 'Black Glasses' });
    state.newGame();
    state.updateRevealed('Kingambit', {
      ...state.revealedOf('Kingambit'),
      moves: ['Kowtow Cleave'],
    });

    expect(state.revealedOf('Kingambit')).toEqual({
      item: 'Black Glasses',
      moves: ['Kowtow Cleave'],
    });
    expect(state.earlier()).toEqual({ item: 'Black Glasses' });
  });

  it('otro rival lo olvida todo y vuelve a la partida 1', () => {
    state.updateRevealed('Kingambit', { item: 'Black Glasses' });
    state.newGame();

    state.clearRivals();
    state.useRivalTeam(['Kingambit']);

    expect(state.game()).toBe(1);
    expect(state.revealedOf('Kingambit')).toEqual({});
    expect(state.earlier()).toEqual({});
  });
});

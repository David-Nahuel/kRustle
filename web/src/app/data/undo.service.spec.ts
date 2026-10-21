import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UndoService } from './undo.service';

describe('UndoService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('deshace lo último y deja de ofrecerlo', () => {
    const undo = new UndoService();
    const restore = vi.fn();
    undo.offer('Incineroar quitado', restore);
    expect(undo.pending()?.message).toBe('Incineroar quitado');
    undo.undo();
    expect(restore).toHaveBeenCalledOnce();
    expect(undo.pending()).toBeNull();
  });

  it('pasados unos segundos ya no se puede deshacer', () => {
    const undo = new UndoService();
    const restore = vi.fn();
    undo.offer('Equipo borrado', restore);
    vi.advanceTimersByTime(10_000);
    expect(undo.pending()).toBeNull();
    undo.undo();
    expect(restore).not.toHaveBeenCalled();
  });

  it('solo se recuerda lo último', () => {
    const undo = new UndoService();
    const first = vi.fn();
    const second = vi.fn();
    undo.offer('A', first);
    undo.offer('B', second);
    undo.undo();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});

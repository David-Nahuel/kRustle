import { Injectable, signal } from '@angular/core';

/** Cuánto dura la opción de deshacer: lo justo para darse cuenta de un toque sin querer. */
const UNDO_MS = 6000;

export interface Undoable {
  message: string;
  undo: () => void;
}

/**
 * "Deshacer" en vez de "¿Seguro?": quitar algo es inmediato y, durante unos segundos, se recupera
 * con un toque. No interrumpe a quien sí quería quitarlo. Solo se recuerda lo último.
 */
@Injectable({ providedIn: 'root' })
export class UndoService {
  readonly pending = signal<Undoable | null>(null);
  private timer?: ReturnType<typeof setTimeout>;

  offer(message: string, undo: () => void): void {
    clearTimeout(this.timer);
    this.pending.set({ message, undo });
    this.timer = setTimeout(() => this.pending.set(null), UNDO_MS);
  }

  undo(): void {
    const pending = this.pending();
    this.dismiss();
    pending?.undo();
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.pending.set(null);
  }
}

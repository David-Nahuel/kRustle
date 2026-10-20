import { Injectable, computed, signal } from '@angular/core';

import type { CalculatorSession } from '../../core/models/team-import.models';

@Injectable({
  providedIn: 'root',
})
export class CalculatorSessionService {
  private readonly sessionSignal = signal<CalculatorSession | null>(null);

  readonly session = this.sessionSignal.asReadonly();

  readonly hasSession = computed(() => this.sessionSignal() !== null);

  setSession(session: CalculatorSession): void {
    this.sessionSignal.set(session);
  }

  clearSession(): void {
    this.sessionSignal.set(null);
  }

  getSession(): CalculatorSession | null {
    return this.sessionSignal();
  }
}
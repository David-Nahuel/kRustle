import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';

import { MetagameService } from './data/metagame.service';
import { I18n, LANGS } from './i18n/i18n.service';
import type { MessageKey } from './i18n/messages';

/** En el orden en que se usan: el equipo, la selección contra el rival y la partida. */
const LINKS: { path: string; label: MessageKey }[] = [
  { path: '/equipo', label: 'nav.team' },
  { path: '/seleccion', label: 'nav.pick' },
  { path: '/calculadora', label: 'nav.calc' },
];

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
})
export class App {
  private readonly data = inject(MetagameService);
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly links = LINKS;
  protected readonly langs = LANGS;
  private readonly updates = inject(SwUpdate);
  /** El service worker ya tiene la versión nueva (o la actual no tiene arreglo): toca recargar. */
  protected readonly updateReady = signal(false);

  constructor() {
    if (!this.updates.isEnabled) return;
    this.updates.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY') this.updateReady.set(true);
    });
    this.updates.unrecoverable.subscribe(() => this.updateReady.set(true));
    // Instalada, la app puede pasar días abierta en segundo plano y el service worker solo
    // busca versiones nuevas al arrancar: se mira también cada vez que vuelve a primer plano.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.updates.checkForUpdate().catch(() => {});
    });
  }

  /** Equipos, rival, PS y lo revelado están en localStorage: recargar no los pierde. */
  protected reload(): void {
    document.location.reload();
  }

  protected readonly dataInfo = computed(() => {
    const meta = this.data.metagame()?.meta;
    if (!meta) return undefined;
    return this.t('footer.data', {
      format: meta.format,
      teams: this.i18n.number(meta.teams),
      tournaments: meta.tournaments,
      date: this.i18n.shortDate(meta.generatedAt),
    });
  });
}

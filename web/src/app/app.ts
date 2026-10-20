import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

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

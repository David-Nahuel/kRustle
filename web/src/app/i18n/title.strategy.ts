import { Injectable, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { type RouterStateSnapshot, TitleStrategy } from '@angular/router';

import { I18n } from './i18n.service';
import type { MessageKey } from './messages';

/**
 * El `title` de cada ruta es una clave de traducción: el título de la pestaña se escribe en el
 * idioma elegido y cambia con él sin navegar.
 */
@Injectable({ providedIn: 'root' })
export class I18nTitleStrategy extends TitleStrategy {
  private readonly i18n = inject(I18n);
  private readonly title = inject(Title);
  private readonly key = signal<MessageKey | undefined>(undefined);

  constructor() {
    super();
    effect(() => {
      const key = this.key();
      this.title.setTitle(key ? `${this.i18n.t(key)} · kRustle` : 'kRustle');
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.key.set(this.buildTitle(snapshot) as MessageKey | undefined);
  }
}

import { Component, computed, inject, input } from '@angular/core';

import { MetagameService } from '../data/metagame.service';

/** Iconos de 24 px en una hoja de 16 por fila (la genera el pipeline en `sprites/items.webp`). */
const ICON = 24;
const PER_ROW = 16;

/**
 * Icono de un objeto. Es decorativo (el nombre siempre va al lado): si el objeto no tiene icono,
 * no se pinta nada.
 */
@Component({
  selector: 'app-item-icon',
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  template: `
    @if (position(); as pos) {
      <span
        class="inline-block bg-no-repeat [image-rendering:pixelated]"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [style.background-image]="'url(sprites/items.webp)'"
        [style.background-size]="sheetWidth() + 'px auto'"
        [style.background-position]="pos"
      ></span>
    }
  `,
})
export class ItemIcon {
  readonly item = input<string | undefined>();
  /** Tamaño en px; 24 es el original, 48 lo duplica sin emborronar (pixel art). */
  readonly size = input(24);

  private readonly metagame = inject(MetagameService).metagame;
  private readonly icons = computed(() => this.metagame()?.itemIcons);

  protected readonly sheetWidth = computed(() => (PER_ROW * ICON * this.size()) / ICON);
  protected readonly position = computed(() => {
    const item = this.item();
    const index = item === undefined ? undefined : this.icons()?.get(item);
    if (index === undefined) return undefined;
    const scale = this.size() / ICON;
    const x = (index % PER_ROW) * ICON * scale;
    const y = Math.floor(index / PER_ROW) * ICON * scale;
    return `-${x}px -${y}px`;
  });
}

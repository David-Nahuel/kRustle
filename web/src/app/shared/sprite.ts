import { Component, computed, input, linkedSignal } from '@angular/core';
import { toID } from '@smogon/calc';

import { GEN } from '../../engine/champions';

/**
 * Primero los sprites propios (los genera el pipeline en `public/sprites`); Showdown solo se usa
 * para las pocas especies que nadie lleva y por eso no están generadas.
 */
const SOURCES = [
  (id: string) => `sprites/${id}.webp`,
  (id: string) => `https://play.pokemonshowdown.com/sprites/home-centered/${id}.png`,
  (id: string) => `https://play.pokemonshowdown.com/sprites/gen5/${id}.png`,
];

/** Id de sprite de Showdown: "Rotom-Wash" → "rotom-wash", "Kommo-o" → "kommoo". */
export function spriteId(name: string): string {
  const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Por su nombre tal cual, sin `getSpecies`: el sprite de Aegislash es el de team preview, no
  // el de la forma con la que lo calcula la calculadora.
  const species = GEN.species.get(toID(name));
  if (!species?.baseSpecies || species.baseSpecies === species.name)
    return toId(species?.name ?? name);
  return `${toId(species.baseSpecies)}-${toId(species.name.slice(species.baseSpecies.length + 1))}`;
}

/** Sprite con respaldo: si no hay imagen en ninguna fuente, muestra las iniciales. */
@Component({
  selector: 'app-sprite',
  host: { class: 'inline-flex shrink-0 items-center justify-center' },
  template: `
    @if (src(); as src) {
      <img
        [src]="src"
        [alt]="species()"
        [width]="size()"
        [height]="size()"
        loading="lazy"
        class="object-contain"
        [style.width.px]="size()"
        [style.height.px]="size()"
        (error)="source.set(source() + 1)"
      />
    } @else {
      <span
        class="flex items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-200"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [attr.aria-label]="species()"
        >{{ species().slice(0, 2) }}</span
      >
    }
  `,
})
export class Sprite {
  readonly species = input.required<string>();
  readonly size = input(48);

  protected readonly source = linkedSignal({ source: this.species, computation: () => 0 });
  protected readonly src = computed(() => SOURCES[this.source()]?.(spriteId(this.species())));
}

import {
  Component,
  type ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { I18n } from '../i18n/i18n.service';
import { Sprite } from './sprite';

const MAX_RESULTS = 8;
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Buscador de Pokémon (combobox accesible). Las opciones llegan ordenadas por uso,
 * así que con 2–3 letras el Pokémon buscado suele salir el primero.
 */
@Component({
  selector: 'app-species-search',
  imports: [Sprite],
  host: { class: 'relative block' },
  template: `
    <input
      #box
      type="text"
      role="combobox"
      autocomplete="off"
      spellcheck="false"
      [attr.aria-expanded]="open()"
      aria-autocomplete="list"
      [attr.aria-activedescendant]="open() ? 'species-option-' + active() : null"
      [placeholder]="placeholder() ?? t('search.default')"
      [value]="query()"
      (input)="query.set(box.value); active.set(0); open.set(true)"
      (focus)="open.set(true)"
      (blur)="open.set(false)"
      (keydown)="onKey($event)"
      class="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
    />
    @if (open() && results().length) {
      <ul
        role="listbox"
        class="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl"
      >
        @for (name of results(); track name; let i = $index) {
          <li
            role="option"
            [id]="'species-option-' + i"
            [attr.aria-selected]="i === active()"
            (mousedown)="$event.preventDefault(); pick(name)"
            (mouseenter)="active.set(i)"
            class="flex cursor-pointer items-center gap-2 px-2 py-1"
            [class.bg-slate-800]="i === active()"
          >
            <app-sprite [species]="name" [size]="32" />
            <span>{{ name }}</span>
          </li>
        }
      </ul>
    }
  `,
})
export class SpeciesSearch {
  readonly options = input.required<readonly string[]>();
  readonly exclude = input<readonly string[]>([]);
  readonly placeholder = input<string>();
  protected readonly t = inject(I18n).t;
  readonly picked = output<string>();

  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');

  /** Para llevar al buscador desde fuera (p. ej. al tocar un hueco vacío del equipo). */
  focus(): void {
    this.box().nativeElement.focus();
  }

  protected readonly results = computed(() => {
    const q = normalize(this.query());
    const excluded = new Set(this.exclude());
    const available = this.options().filter((o) => !excluded.has(o));
    if (!q) return available.slice(0, MAX_RESULTS);
    // Primero los que empiezan por lo escrito, luego los que lo contienen.
    const starts = available.filter((o) => normalize(o).startsWith(q));
    const contains = available.filter(
      (o) => !normalize(o).startsWith(q) && normalize(o).includes(q),
    );
    return [...starts, ...contains].slice(0, MAX_RESULTS);
  });

  protected onKey(event: KeyboardEvent): void {
    const count = this.results().length;
    if (event.key === 'ArrowDown') {
      this.open.set(true);
      this.active.update((i) => (i + 1) % Math.max(count, 1));
    } else if (event.key === 'ArrowUp') {
      this.active.update((i) => (i - 1 + count) % Math.max(count, 1));
    } else if (event.key === 'Enter' && this.open() && count) {
      this.pick(this.results()[this.active()]);
    } else if (event.key === 'Escape') {
      this.open.set(false);
      return;
    } else {
      return;
    }
    event.preventDefault();
  }

  protected pick(name: string): void {
    this.picked.emit(name);
    this.query.set('');
    this.active.set(0);
  }
}

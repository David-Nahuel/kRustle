import { Component, computed, inject, input, output, signal } from '@angular/core';

import { getMove } from '../../engine/champions';
import { MetagameService } from '../data/metagame.service';
import { I18n } from '../i18n/i18n.service';
import { TYPE_CLASSES } from './format';
import { ItemIcon } from './item-icon';

const MAX_RESULTS = 8;
/** Sin mayúsculas, tildes ni signos: "Baya Zídra" encuentra "baya zidra". */
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '');
let nextId = 0;

/**
 * Campo de objeto o movimiento con buscador (combobox accesible), como el de Pokémon: al entrar
 * enseña los que más lleva la especie y, al escribir, los que coinciden, en el idioma de la
 * interfaz o en inglés. Delante va el icono del objeto o el color del tipo del movimiento, dentro
 * del campo y solo si lo hay (si no, el texto no se descentra).
 */
@Component({
  selector: 'app-name-search',
  imports: [ItemIcon],
  host: { class: 'relative block' },
  template: `
    <div class="relative">
      @if (value(); as current) {
        @if (kind() === 'items') {
          @if (hasIcon(current)) {
            <app-item-icon
              class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2"
              [item]="current"
            />
          }
        } @else {
          <span
            class="pointer-events-none absolute top-1/2 left-2.5 h-2.5 w-2.5 -translate-y-1/2 rounded-full ring-1 ring-white/25 {{
              typeClass(current)
            }}"
          ></span>
        }
      }
      <input
        #box
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        aria-autocomplete="list"
        [attr.aria-label]="label()"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="listId"
        [attr.aria-activedescendant]="open() && results().length ? listId + '-' + active() : null"
        [placeholder]="placeholder()"
        [value]="open() ? query() : current()"
        (focus)="start(box)"
        (input)="query.set(box.value); active.set(0); open.set(true)"
        (blur)="commit()"
        (keydown)="onKey($event)"
        class="h-9 w-full min-w-0 rounded-lg bg-slate-950 pr-2 text-sm ring-1 ring-slate-700 focus:ring-amber-400 focus:outline-none"
        [class]="padding()"
      />
    </div>
    @if (open() && results().length) {
      <ul
        role="listbox"
        [id]="listId"
        class="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl"
      >
        @for (option of results(); track option; let i = $index) {
          <li
            role="option"
            [id]="listId + '-' + i"
            [attr.aria-selected]="i === active()"
            (mousedown)="$event.preventDefault(); pick(option)"
            (mouseenter)="active.set(i)"
            class="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm"
            [class.bg-slate-800]="i === active()"
          >
            <!-- Mismo hueco con o sin icono: los nombres quedan alineados. -->
            <span class="flex w-6 shrink-0 justify-center">
              @if (kind() === 'items') {
                <app-item-icon [item]="option" />
              } @else {
                <span
                  class="h-2.5 w-2.5 rounded-full ring-1 ring-white/25 {{ typeClass(option) }}"
                ></span>
              }
            </span>
            <span class="truncate">{{ display(option) }}</span>
          </li>
        }
      </ul>
    }
  `,
})
export class NameSearch {
  readonly kind = input.required<'items' | 'moves'>();
  /** Posibles (en inglés), ya ordenados: lo que más lleva la especie primero. */
  readonly options = input.required<readonly string[]>();
  /** Los que no se ofrecen (p. ej. los movimientos que ya están en otro hueco). */
  readonly exclude = input<readonly string[]>([]);
  readonly value = input<string | undefined>();
  readonly label = input<string>();
  readonly placeholder = input('');
  /** Lo elegido (en inglés), o `null` si se deja vacío. */
  readonly picked = output<string | null>();

  private readonly i18n = inject(I18n);
  private readonly data = inject(MetagameService);
  protected readonly listId = `name-search-${nextId++}`;

  protected readonly query = signal('');
  protected readonly open = signal(false);
  protected readonly active = signal(0);

  protected readonly current = computed(() => {
    const value = this.value();
    return value ? this.display(value) : '';
  });

  /** Sitio para el icono solo si lo hay: el del objeto es más ancho que el punto del tipo. */
  protected readonly padding = computed(() => {
    const value = this.value();
    if (!value) return 'pl-2';
    if (this.kind() === 'moves') return 'pl-7';
    return this.hasIcon(value) ? 'pl-9' : 'pl-2';
  });

  protected readonly results = computed(() => {
    const excluded = new Set(this.exclude());
    const options = this.options().filter((o) => !excluded.has(o));
    const q = normalize(this.query());
    // Recién entrado, o sin cambiar lo que había: los más llevados.
    if (!q || this.query() === this.current()) return options.slice(0, MAX_RESULTS);
    const matches = (o: string, test: (name: string) => boolean) =>
      test(normalize(this.display(o))) || test(normalize(o));
    const starts = options.filter((o) => matches(o, (name) => name.startsWith(q)));
    const contains = options.filter(
      (o) => !starts.includes(o) && matches(o, (name) => name.includes(q)),
    );
    return [...starts, ...contains].slice(0, MAX_RESULTS);
  });

  protected display(name: string): string {
    return this.kind() === 'items' ? this.i18n.item(name) : this.i18n.move(name);
  }

  protected hasIcon(item: string): boolean {
    return !!this.data.metagame()?.itemIcons.has(item);
  }

  /** El mismo color que en las fichas del equipo (con borde: el de Siniestro casi no se ve). */
  protected typeClass(move: string): string {
    return TYPE_CLASSES[getMove(move)?.type ?? 'Normal'] ?? 'bg-slate-500';
  }

  /** Al entrar se selecciona lo escrito: se puede sustituir directamente o elegir de la lista. */
  protected start(box: HTMLInputElement): void {
    this.query.set(this.current());
    this.active.set(0);
    this.open.set(true);
    box.select();
  }

  /** Al salir: vacío es quitarlo; un nombre exacto, ese; otra cosa, se queda lo que había. */
  protected commit(): void {
    if (!this.open()) return;
    this.open.set(false);
    const text = normalize(this.query());
    if (!text) {
      if (this.value()) this.picked.emit(null);
      return;
    }
    const excluded = new Set(this.exclude());
    const exact = this.options().find(
      (o) => !excluded.has(o) && (normalize(this.display(o)) === text || normalize(o) === text),
    );
    if (exact && exact !== this.value()) this.picked.emit(exact);
  }

  protected pick(option: string): void {
    this.open.set(false);
    if (option !== this.value()) this.picked.emit(option);
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.results().length;
    if (event.key === 'ArrowDown') {
      this.open.set(true);
      this.active.update((i) => (i + 1) % Math.max(count, 1));
    } else if (event.key === 'ArrowUp') {
      this.active.update((i) => (i - 1 + count) % Math.max(count, 1));
    } else if (event.key === 'Enter' && !normalize(this.query()) && this.value()) {
      // Ha borrado lo que había: quitarlo (aunque la lista siga sugiriendo los más llevados).
      // En un hueco que ya estaba vacío, Intro elige el resaltado, como en cualquier lista.
      this.commit();
    } else if (event.key === 'Enter' && this.open() && count) {
      this.pick(this.results()[this.active()]);
    } else if (event.key === 'Escape') {
      // Deja lo que había.
      this.query.set(this.current());
      this.open.set(false);
    } else {
      return;
    }
    event.preventDefault();
  }
}

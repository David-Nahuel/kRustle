import { Injectable, computed, effect, resource } from '@angular/core';

import type { StatId } from '../../engine/champions';
import type { Priority } from '../../engine/moves';
import { persistedSignal } from '../data/storage';
import { MESSAGES, type MessageKey } from './messages';

export type Lang = keyof typeof MESSAGES;
export const LANGS: Lang[] = ['en', 'es'];

/** Datos con nombre propio en cada idioma (los Pokémon se llaman igual en inglés y español). */
export type DataKind = 'moves' | 'items' | 'abilities' | 'natures' | 'types';
type DataNames = Record<DataKind, Record<string, string>>;

const LOCALES: Record<Lang, string> = { en: 'en-US', es: 'es-ES' };

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '');

/**
 * Idioma de la interfaz y de los datos. Inglés por defecto; la elección se recuerda.
 * Los textos salen de `messages.ts`; los nombres de movimientos, objetos, habilidades,
 * naturalezas y tipos, de `data/i18n/<idioma>.json` (lo genera el pipeline con los nombres
 * oficiales). Lo que no esté traducido se enseña en inglés.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  readonly lang = persistedSignal<Lang>('krustle.lang', 'en');
  readonly locale = computed(() => LOCALES[this.lang()]);

  private readonly names = resource({
    params: () => this.lang(),
    loader: async ({ params, abortSignal }): Promise<DataNames | undefined> => {
      if (params === 'en') return undefined;
      const response = await fetch(`data/i18n/${params}.json`, { signal: abortSignal });
      return response.ok ? (response.json() as Promise<DataNames>) : undefined;
    },
  });
  private readonly table = computed(() => (this.names.hasValue() ? this.names.value() : undefined));

  /** Lo escrito en el idioma elegido → nombre en inglés, por tipo de dato. */
  private readonly reverse = computed(() => {
    const table = this.table();
    const maps = new Map<DataKind, Map<string, string>>();
    for (const [kind, names] of Object.entries(table ?? {}) as [
      DataKind,
      Record<string, string>,
    ][]) {
      maps.set(kind, new Map(Object.entries(names).map(([en, local]) => [normalize(local), en])));
    }
    return maps;
  });

  constructor() {
    effect(() => {
      document.documentElement.lang = this.lang();
    });
  }

  /** Texto de la interfaz, con `{parámetros}`. */
  readonly t = (key: MessageKey, params?: Record<string, string | number>): string => {
    const text = MESSAGES[this.lang()][key];
    return params
      ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
      : text;
  };

  readonly name = (kind: DataKind, english: string): string =>
    this.table()?.[kind][english] ?? english;
  readonly move = (name: string) => this.name('moves', name);
  readonly item = (name: string) => this.name('items', name);
  readonly ability = (name: string) => this.name('abilities', name);
  readonly nature = (name: string) => this.name('natures', name);
  readonly type = (name: string) => this.name('types', name);
  readonly stat = (stat: StatId) => this.t(`stat.${stat}`);

  /** Un nombre del que no se sabe el tipo (las etiquetas de los sets mezclan objeto y movimientos). */
  readonly any = (name: string): string => {
    const table = this.table();
    if (!table) return name;
    return (
      table.items[name] ?? table.moves[name] ?? table.abilities[name] ?? table.natures[name] ?? name
    );
  };

  /**
   * Lo que alguien escribe en un formulario, en el idioma elegido o en inglés, como nombre en
   * inglés (el que entienden el motor y el paste). Si no lo reconoce, lo devuelve tal cual.
   */
  readonly english = (kind: DataKind, text: string): string =>
    this.reverse().get(kind)?.get(normalize(text)) ?? text;

  /** "+1 · Prankster": la fuente de la prioridad es una habilidad o Grassy Terrain. */
  readonly priority = (priority: Priority | undefined): string | undefined => {
    if (!priority?.value) return undefined;
    const value = priority.value > 0 ? `+${priority.value}` : `−${-priority.value}`;
    if (!priority.source) return value;
    const source =
      priority.source === 'Grassy Terrain'
        ? this.t('priority.grassy')
        : this.ability(priority.source);
    return `${value} · ${source}`;
  };

  /** "A, B y C". */
  readonly list = (items: string[]): string =>
    items.length < 2
      ? (items[0] ?? '')
      : `${items.slice(0, -1).join(', ')} ${this.t('common.and')} ${items[items.length - 1]}`;

  readonly number = (n: number): string => n.toLocaleString(this.locale());
  /** Porcentaje con un decimal como mucho ("25.1%", "25,1 %"). */
  readonly percent = (x: number): string =>
    x.toLocaleString(this.locale(), { style: 'percent', maximumFractionDigits: 1 });
  readonly shortDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(this.locale(), { day: 'numeric', month: 'short' });
  readonly month = (yearMonth: string): string =>
    new Date(`${yearMonth}-01T12:00:00`).toLocaleDateString(this.locale(), {
      month: 'short',
      year: 'numeric',
    });
}

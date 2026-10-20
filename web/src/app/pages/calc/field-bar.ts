import { Component, computed, inject, model, output, signal } from '@angular/core';

import type { FieldConditions, SideConditions } from '../../../engine/matchup';
import { I18n } from '../../i18n/i18n.service';

const WEATHERS: FieldConditions['weather'][] = [undefined, 'Sun', 'Rain', 'Sand', 'Snow'];
const TERRAINS: FieldConditions['terrain'][] = [
  undefined,
  'Electric',
  'Grassy',
  'Psychic',
  'Misty',
];

/**
 * Lo de cada lado que se usa menos que Tailwind: va en "Más". Son movimientos (y Friend Guard,
 * una habilidad): se enseñan con su nombre en el idioma elegido.
 */
const EXTRA_TOGGLES: {
  key: Exclude<keyof SideConditions, 'tailwind'>;
  name: string;
  kind: 'moves' | 'abilities';
}[] = [
  { key: 'helpingHand', name: 'Helping Hand', kind: 'moves' },
  { key: 'reflect', name: 'Reflect', kind: 'moves' },
  { key: 'lightScreen', name: 'Light Screen', kind: 'moves' },
  { key: 'auroraVeil', name: 'Aurora Veil', kind: 'moves' },
  { key: 'friendGuard', name: 'Friend Guard', kind: 'abilities' },
];

/**
 * El campo en una línea, encima del enfrentamiento: clima, terreno, Trick Room y el Tailwind de
 * cada lado, que son lo que más cambia en una partida. Pantallas, Helping Hand y Friend Guard,
 * en "Más".
 */
@Component({
  selector: 'app-field-bar',
  template: `
    <div
      class="flex flex-wrap items-center gap-1.5"
      role="group"
      [attr.aria-label]="i18n.t('field.aria')"
    >
      <label class="sr-only" for="field-weather">{{ i18n.t('field.weather') }}</label>
      <select
        id="field-weather"
        [class]="select(!!field().weather)"
        (change)="setWeather($any($event.target).value)"
      >
        @for (w of weathers; track $index) {
          <option [value]="w ?? ''" [selected]="field().weather === w">
            {{ weatherLabel(w) }}
          </option>
        }
      </select>
      <label class="sr-only" for="field-terrain">{{ i18n.t('field.terrain') }}</label>
      <select
        id="field-terrain"
        [class]="select(!!field().terrain)"
        (change)="setTerrain($any($event.target).value)"
      >
        @for (terrain of terrains; track $index) {
          <option [value]="terrain ?? ''" [selected]="field().terrain === terrain">
            {{ terrainLabel(terrain) }}
          </option>
        }
      </select>
      <button
        type="button"
        [class]="chip(field().trickRoom, 'violet')"
        [attr.aria-pressed]="field().trickRoom"
        (click)="field.set({ ...field(), trickRoom: !field().trickRoom })"
      >
        {{ i18n.move('Trick Room') }}
      </button>
      <button
        type="button"
        [class]="chip(mySide().tailwind, 'sky')"
        [attr.aria-pressed]="mySide().tailwind"
        (click)="toggle(mySide, 'tailwind')"
      >
        {{ i18n.t('view.myTailwind', { move: i18n.move('Tailwind') }) }}
      </button>
      <button
        type="button"
        [class]="chip(theirSide().tailwind, 'sky')"
        [attr.aria-pressed]="theirSide().tailwind"
        (click)="toggle(theirSide, 'tailwind')"
      >
        {{ i18n.t('view.theirTailwind', { move: i18n.move('Tailwind') }) }}
      </button>
      <button
        type="button"
        class="h-9 rounded-lg px-3 text-sm text-slate-300 ring-1 ring-slate-700 hover:text-slate-100"
        [attr.aria-expanded]="expanded()"
        aria-controls="field-more"
        (click)="expanded.set(!expanded())"
      >
        {{ i18n.t(expanded() ? 'common.less' : 'common.more') }}
        @if (!expanded() && extraActive()) {
          <span class="ml-0.5 rounded bg-amber-400/20 px-1 text-xs text-amber-200">{{
            extraActive()
          }}</span>
        }
      </button>
      @if (active()) {
        <button
          type="button"
          class="h-9 px-1.5 text-sm text-slate-400 hover:text-slate-200"
          (click)="reset.emit()"
        >
          {{ i18n.t('common.reset') }}
        </button>
      }
    </div>

    @if (expanded()) {
      <div id="field-more" class="mt-2 grid gap-2 sm:grid-cols-2">
        @for (side of sides; track side.label) {
          <fieldset class="flex flex-col gap-1.5 rounded-lg border border-slate-800 p-2.5">
            <legend class="px-1 text-sm text-slate-400">{{ i18n.t(side.label) }}</legend>
            <div class="flex flex-wrap gap-1.5">
              @for (t of extraToggles; track t.key) {
                <button
                  type="button"
                  [class]="chip(side.model()[t.key], 'amber')"
                  [attr.aria-pressed]="side.model()[t.key]"
                  (click)="toggle(side.model, t.key)"
                >
                  {{ i18n.name(t.kind, t.name) }}
                </button>
              }
            </div>
          </fieldset>
        }
      </div>
    }
  `,
})
export class FieldBar {
  readonly field = model.required<FieldConditions>();
  readonly mySide = model.required<SideConditions>();
  readonly theirSide = model.required<SideConditions>();
  /** Vuelve todo el campo a como empieza la partida. */
  readonly reset = output();

  protected readonly expanded = signal(false);
  protected readonly weathers = WEATHERS;
  protected readonly terrains = TERRAINS;
  protected readonly extraToggles = EXTRA_TOGGLES;
  protected readonly i18n = inject(I18n);
  protected readonly sides = [
    { label: 'field.mySide' as const, model: this.mySide },
    { label: 'field.theirSide' as const, model: this.theirSide },
  ];

  /** Cuántos de los de "Más" están activos: se ve aunque esté cerrado. */
  protected readonly extraActive = computed(
    () =>
      EXTRA_TOGGLES.filter((t) => this.mySide()[t.key]).length +
      EXTRA_TOGGLES.filter((t) => this.theirSide()[t.key]).length,
  );
  protected readonly active = computed(() => {
    const f = this.field();
    return (
      !!(f.weather || f.terrain || f.trickRoom) ||
      Object.values(this.mySide()).some(Boolean) ||
      Object.values(this.theirSide()).some(Boolean)
    );
  });

  protected weatherLabel(weather: FieldConditions['weather']): string {
    return this.i18n.t(weather ? `weather.${weather}` : 'weather.none');
  }

  protected terrainLabel(terrain: FieldConditions['terrain']): string {
    return this.i18n.t(terrain ? `terrain.${terrain}` : 'terrain.none');
  }

  protected setWeather(value: string): void {
    this.field.set({
      ...this.field(),
      weather: (value || undefined) as FieldConditions['weather'],
    });
  }

  protected setTerrain(value: string): void {
    this.field.set({
      ...this.field(),
      terrain: (value || undefined) as FieldConditions['terrain'],
    });
  }

  protected toggle(side: typeof this.mySide, key: keyof SideConditions): void {
    side.update((s) => ({ ...s, [key]: !s[key] }));
  }

  protected select(active: boolean): string {
    return `h-9 rounded-lg bg-slate-900 px-2 text-sm ring-1 ${
      active ? 'text-amber-200 ring-amber-400/60' : 'text-slate-300 ring-slate-700'
    }`;
  }

  protected chip(active: boolean, tone: 'violet' | 'sky' | 'amber'): string {
    const on = {
      violet: 'bg-violet-400/15 text-violet-200 ring-violet-400/60',
      sky: 'bg-sky-400/15 text-sky-200 ring-sky-400/60',
      amber: 'bg-amber-400/15 text-amber-200 ring-amber-400/60',
    }[tone];
    return `h-9 rounded-lg px-3 text-sm ring-1 ${
      active ? on : 'text-slate-300 ring-slate-700 hover:text-slate-100'
    }`;
  }
}

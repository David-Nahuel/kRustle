import { Component, computed, inject, input } from '@angular/core';

import { CalcState } from '../data/calc-state.service';
import { MetagameService } from '../data/metagame.service';
import { I18n } from '../i18n/i18n.service';
import { SpeciesSearch } from './species-search';
import { Sprite } from './sprite';

/**
 * Los 6 del rival, tal y como se ven en team preview. Es el mismo equipo en Selección y en
 * Calculadora. Con `selectable`, tocar un Pokémon lo elige como rival en la calculadora.
 */
@Component({
  selector: 'app-rival-team-picker',
  imports: [SpeciesSearch, Sprite],
  host: { class: 'flex flex-col gap-1.5' },
  template: `
    <div class="flex items-center justify-between">
      <h2 class="text-xs font-semibold tracking-wide text-slate-400 uppercase">
        {{ t('rival.title') }}
      </h2>
      @if (state.rivals().length) {
        <button
          type="button"
          class="text-xs text-slate-400 hover:text-rose-300"
          (click)="state.clearRivals()"
        >
          {{ t('rival.clear') }}
        </button>
      }
    </div>
    <div
      class="grid grid-cols-6 gap-1.5"
      [attr.role]="selectable() ? 'radiogroup' : 'list'"
      [attr.aria-label]="t('rival.aria')"
    >
      @for (species of state.rivals(); track species; let i = $index) {
        <div class="group relative" [attr.role]="selectable() ? null : 'listitem'">
          @if (selectable()) {
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="species === state.rival()"
              [title]="species"
              (click)="state.rivalIndex.set(i)"
              class="flex h-12 w-full items-center justify-center rounded-lg ring-1 sm:h-14"
              [class]="
                species === state.rival()
                  ? 'bg-rose-400/15 ring-rose-400/70'
                  : 'bg-slate-900 ring-slate-800 hover:ring-slate-600'
              "
            >
              <app-sprite
                [species]="species"
                [size]="40"
                [class.opacity-40]="fainted(species)"
                [class.grayscale]="fainted(species)"
              />
            </button>
          } @else {
            <div
              class="flex h-12 w-full items-center justify-center rounded-lg bg-slate-900 ring-1 ring-slate-800 sm:h-14"
              [title]="species"
            >
              <app-sprite
                [species]="species"
                [size]="40"
                [class.opacity-40]="fainted(species)"
                [class.grayscale]="fainted(species)"
              />
            </div>
          }
          @if (state.rivalStatusOf(species).mega) {
            <span
              class="pointer-events-none absolute top-0.5 right-0.5 rounded bg-fuchsia-500/80 px-1 text-[9px] leading-tight font-bold text-white"
              [title]="t('calc.megaBadge')"
              >M</span
            >
          }
          @if (state.rivalStatusOf(species).hp < 100) {
            <div
              class="absolute inset-x-1.5 bottom-1 h-1 rounded-full bg-slate-800"
              aria-hidden="true"
            >
              <div
                class="h-full rounded-full bg-rose-400"
                [style.width.%]="state.rivalStatusOf(species).hp"
              ></div>
            </div>
          }
          <button
            type="button"
            class="absolute -top-1.5 -right-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-xs text-slate-200 group-focus-within:flex group-hover:flex hover:bg-rose-500"
            [attr.aria-label]="t('rival.remove', { name: species })"
            (click)="remove(species)"
          >
            ×
          </button>
        </div>
      }
      @for (slot of emptySlots(); track $index) {
        <div class="h-12 rounded-lg border border-dashed border-slate-800 sm:h-14"></div>
      }
    </div>
    @if (state.rivals().length < 6) {
      <app-species-search
        [options]="data.speciesOptions()"
        [exclude]="state.rivals()"
        [placeholder]="t('rival.add')"
        (picked)="add($event)"
      />
    }
  `,
})
export class RivalTeamPicker {
  readonly selectable = input(false);

  protected readonly t = inject(I18n).t;
  protected readonly state = inject(CalcState);
  protected readonly data = inject(MetagameService);
  protected readonly emptySlots = computed(() => Array(6 - this.state.rivals().length).fill(0));

  protected fainted(species: string): boolean {
    return this.state.rivalStatusOf(species).hp === 0;
  }

  protected add(species: string): void {
    const slot = this.state.rivalTeam().indexOf(null);
    if (slot >= 0) this.state.setRival(slot, species);
  }

  protected remove(species: string): void {
    this.state.setRival(this.state.rivalTeam().indexOf(species), null);
  }
}

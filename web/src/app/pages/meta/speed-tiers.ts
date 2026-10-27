import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { type SpeedEntry, type SpeedTierOptions, speedTiers } from '../../../engine/speed-tiers';
import { CalcState } from '../../data/calc-state.service';
import { MetagameService } from '../../data/metagame.service';
import { TeamStore } from '../../data/team-store.service';
import { I18n } from '../../i18n/i18n.service';
import { ItemIcon } from '../../shared/item-icon';
import { Sprite } from '../../shared/sprite';

/** Objetos que cambian la velocidad: se enseñan junto al rival que los lleva. */
const SPEED_ITEMS = new Set(['Choice Scarf', 'Iron Ball']);

/**
 * Pestaña de velocidades en Meta: tus Pokémon entre los más usados del formato, con Tailwind de
 * cada lado y Trick Room. Desde cada rival se abre la calculadora contra tu Pokémon elegido.
 */
@Component({
  selector: 'app-speed-tiers',
  imports: [ItemIcon, RouterLink, Sprite],
  template: `
    <section class="flex flex-col gap-3" role="tabpanel">
      <p class="text-sm text-slate-400">{{ i18n.t('speed.tiersIntro') }}</p>

      <div class="flex flex-wrap gap-1.5" role="group" [attr.aria-label]="i18n.t('field.aria')">
        @for (toggle of toggles; track toggle.key) {
          <button
            type="button"
            class="h-9 rounded-lg px-3 text-sm ring-1"
            [class]="
              options()[toggle.key]
                ? toggle.on
                : 'text-slate-300 ring-slate-700 hover:text-slate-100'
            "
            [attr.aria-pressed]="!!options()[toggle.key]"
            (click)="flip(toggle.key)"
          >
            {{ toggle.label() }}
          </button>
        }
      </div>

      @if (!myTeam().length) {
        <p class="rounded-lg border border-dashed border-slate-700 p-3 text-sm text-slate-400">
          {{ i18n.t('speed.tiersNoTeam') }}
          <a routerLink="/equipo" class="text-amber-300 hover:underline">{{
            i18n.t('pick.addTeam')
          }}</a>
        </p>
      }

      <ol class="flex flex-col gap-1">
        @for (entry of tiers(); track entry.member ?? entry.species) {
          <li
            class="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 ring-1"
            [class]="
              entry.member !== undefined
                ? 'bg-emerald-400/10 ring-emerald-400/50'
                : 'bg-slate-900 ring-slate-800'
            "
          >
            <span
              class="w-10 shrink-0 text-right font-mono text-base font-semibold tabular-nums"
              [class]="entry.member !== undefined ? 'text-emerald-200' : 'text-slate-100'"
              >{{ entry.speed }}</span
            >
            <app-sprite class="shrink-0" [species]="entry.species" [size]="32" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span
                  class="truncate font-medium"
                  [class]="entry.member !== undefined ? 'text-emerald-200' : 'text-slate-200'"
                  >{{ entry.species }}</span
                >
                @if (entry.item && speedItems.has(entry.item)) {
                  <span class="flex shrink-0 items-center gap-1 text-xs text-amber-200">
                    <app-item-icon [item]="entry.item" />{{ i18n.item(entry.item) }}
                  </span>
                }
              </div>
              <p class="text-xs text-slate-400">
                @if (entry.versus; as v) {
                  {{ i18n.t('speed.tiersVersus', { first: v.first, second: v.second }) }}
                  @if (v.depends) {
                    · {{ i18n.t('speed.tiersDepends', { n: v.depends }) }}
                  }
                } @else {
                  @if (entry.range[0] !== entry.range[1]) {
                    {{ i18n.t('speed.tiersRange', { from: entry.range[0], to: entry.range[1] }) }}
                    ·
                  }
                  {{ i18n.t('speed.tiersUsage', { pct: i18n.percent(entry.usage ?? 0) }) }}
                }
              </p>
            </div>
            @if (entry.member === undefined && myTeam().length) {
              <button
                type="button"
                class="h-8 shrink-0 rounded-lg px-2.5 text-xs text-slate-300 ring-1 ring-slate-700 hover:text-amber-200 hover:ring-amber-400/60 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-300 disabled:hover:ring-slate-700"
                [disabled]="!canOpen(entry)"
                [title]="
                  i18n.t(canOpen(entry) ? 'speed.tiersCalcTitle' : 'speed.tiersFull', {
                    name: entry.species,
                  })
                "
                (click)="openInCalc(entry)"
              >
                {{ i18n.t('speed.tiersCalc') }}
              </button>
            }
          </li>
        }
      </ol>
    </section>
  `,
})
export class SpeedTiers {
  protected readonly i18n = inject(I18n);
  private readonly data = inject(MetagameService);
  private readonly state = inject(CalcState);
  private readonly router = inject(Router);
  protected readonly myTeam = inject(TeamStore).activeMembers;
  protected readonly speedItems = SPEED_ITEMS;

  protected readonly options = signal<SpeedTierOptions>({});
  protected readonly toggles: {
    key: keyof SpeedTierOptions;
    label: () => string;
    on: string;
  }[] = [
    {
      key: 'myTailwind',
      label: () => this.i18n.t('view.myTailwind', { move: this.i18n.move('Tailwind') }),
      on: 'bg-sky-400/15 text-sky-200 ring-sky-400/60',
    },
    {
      key: 'theirTailwind',
      label: () => this.i18n.t('view.theirTailwind', { move: this.i18n.move('Tailwind') }),
      on: 'bg-sky-400/15 text-sky-200 ring-sky-400/60',
    },
    {
      key: 'trickRoom',
      label: () => this.i18n.move('Trick Room'),
      on: 'bg-violet-400/15 text-violet-200 ring-violet-400/60',
    },
  ];

  protected readonly tiers = computed(() => {
    const metagame = this.data.metagame();
    return metagame ? speedTiers(metagame, this.myTeam(), this.options()) : [];
  });

  /** Está en el equipo rival o cabe en él. */
  protected canOpen(entry: SpeedEntry): boolean {
    const team = this.state.rivalTeam();
    return team.includes(entry.species) || team.includes(null);
  }

  protected flip(key: keyof SpeedTierOptions): void {
    this.options.update((o) => ({ ...o, [key]: !o[key] }));
  }

  /**
   * La calculadora contra este rival, con tu Pokémon elegido allí y el mismo Tailwind y Trick
   * Room que aquí. Si no está en el equipo rival y cabe, se añade.
   */
  protected openInCalc(entry: SpeedEntry): void {
    const state = this.state;
    if (!state.rivalTeam().includes(entry.species)) {
      const slot = state.rivalTeam().indexOf(null);
      if (slot < 0) return;
      state.setRival(slot, entry.species);
    }
    state.rivalIndex.set(state.rivals().indexOf(entry.species));
    const { myTailwind, theirTailwind, trickRoom } = this.options();
    state.field.update((f) => ({ ...f, trickRoom: !!trickRoom }));
    state.mySide.update((s) => ({ ...s, tailwind: !!myTailwind }));
    state.theirSide.update((s) => ({ ...s, tailwind: !!theirTailwind }));
    void this.router.navigate(['/calculadora']);
  }
}

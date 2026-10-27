import { Component, computed, inject, input, output, signal } from '@angular/core';

import {
  GOAL_CONFIDENCE,
  type Goal,
  type Plan,
  checkGoals,
  goalMoves,
  planSps,
} from '../../../engine/benchmarks';
import { STAT_IDS, type StatId, type Stats } from '../../../engine/champions';
import type { TeamMember } from '../../../engine/pokepaste';
import { MetagameService } from '../../data/metagame.service';
import { persistedSignal } from '../../data/storage';
import { I18n } from '../../i18n/i18n.service';
import type { MessageKey } from '../../i18n/messages';
import { pct } from '../../shared/format';
import { SpeciesSearch } from '../../shared/species-search';
import { Sprite } from '../../shared/sprite';

const KINDS: Goal['kind'][] = ['survive', 'outspeed', 'ko'];

/** Lo que se puede añadir a cada objetivo, según su tipo. */
const OPTIONS: Record<Goal['kind'], { key: string; name: string; kind: 'moves' | 'abilities' }[]> =
  {
    survive: [
      { key: 'helpingHand', name: 'Helping Hand', kind: 'moves' },
      { key: 'intimidate', name: 'Intimidate', kind: 'abilities' },
    ],
    ko: [{ key: 'helpingHand', name: 'Helping Hand', kind: 'moves' }],
    outspeed: [{ key: 'tailwind', name: 'Tailwind', kind: 'moves' }],
  };

/**
 * Objetivos de Stat Points de un Pokémon (aguantar un ataque, ser más rápido, debilitar) y el
 * reparto mínimo que los cumple. Se guardan por especie en el navegador, como los equipos.
 */
@Component({
  selector: 'app-sp-goals',
  imports: [SpeciesSearch, Sprite],
  template: `
    <section class="flex flex-col gap-2 rounded-lg border border-slate-800 p-2.5">
      <button
        type="button"
        class="flex items-center gap-1.5 text-left text-xs text-slate-400 hover:text-slate-200"
        [attr.aria-expanded]="open()"
        (click)="open.set(!open())"
      >
        <span class="transition-transform" [class.rotate-90]="open()" aria-hidden="true">▸</span>
        {{ i18n.t('goals.title') }}
        @if (goals().length) {
          <span class="rounded bg-amber-400/20 px-1 text-amber-200">{{ goals().length }}</span>
        }
      </button>

      @if (open()) {
        <p class="text-xs text-slate-400">
          {{ i18n.t('goals.intro', { pct: format(confidence) }) }}
        </p>

        @if (goals().length) {
          <ul class="flex flex-col gap-1.5">
            @for (goal of goals(); track $index; let i = $index) {
              <li
                class="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-950 p-2 text-xs ring-1 ring-slate-800"
              >
                <span class="font-semibold text-slate-200">{{ kindLabel(goal.kind) }}</span>
                <app-sprite [species]="goal.rival" [size]="24" />
                <span class="text-slate-300">{{ goal.rival }}</span>
                @if (goal.kind !== 'outspeed') {
                  <label class="sr-only" [for]="'goal-move-' + i">{{ i18n.t('goals.move') }}</label>
                  <select
                    [id]="'goal-move-' + i"
                    class="h-7 rounded-md bg-slate-900 px-1.5 ring-1 ring-slate-700 focus:ring-amber-400 focus:outline-none"
                    (change)="update(i, { move: $any($event.target).value })"
                  >
                    @for (move of movesFor(goal); track move) {
                      <option [value]="move" [selected]="move === goal.move">
                        {{ i18n.move(move) }}
                      </option>
                    }
                  </select>
                }
                @for (option of options(goal); track option.key) {
                  <button
                    type="button"
                    class="h-7 rounded-md px-1.5 ring-1"
                    [class]="
                      flag(goal, option.key)
                        ? 'bg-amber-400/15 text-amber-200 ring-amber-400/60'
                        : 'text-slate-400 ring-slate-700 hover:text-slate-200'
                    "
                    [attr.aria-pressed]="flag(goal, option.key)"
                    (click)="toggleFlag(i, option.key)"
                  >
                    {{ i18n.name(option.kind, option.name) }}
                  </button>
                }
                <!-- Juntos, para que la × no se quede sola en otra línea en el móvil. -->
                <span class="ml-auto flex items-center gap-1">
                  <span
                    class="font-mono tabular-nums"
                    [class]="current()[i] >= confidence ? 'text-emerald-300' : 'text-orange-300'"
                    [title]="i18n.t('goals.currentTitle')"
                    >{{ format(current()[i]) }}</span
                  >
                  <button
                    type="button"
                    class="px-1 text-base leading-none text-slate-500 hover:text-rose-300"
                    [attr.aria-label]="i18n.t('goals.remove')"
                    (click)="remove(i)"
                  >
                    ×
                  </button>
                </span>
              </li>
            }
          </ul>
        }

        <div class="flex flex-wrap items-center gap-1.5">
          <label class="sr-only" for="goal-kind">{{ i18n.t('goals.kind') }}</label>
          <select
            id="goal-kind"
            class="h-9 rounded-lg bg-slate-950 px-2 text-sm ring-1 ring-slate-700 focus:ring-amber-400 focus:outline-none"
            (change)="kind.set($any($event.target).value)"
          >
            @for (k of kinds; track k) {
              <option [value]="k" [selected]="k === kind()">{{ kindLabel(k) }}</option>
            }
          </select>
          <app-species-search
            class="min-w-40 flex-1"
            [options]="data.speciesOptions()"
            [placeholder]="i18n.t('goals.rival')"
            (picked)="add($event)"
          />
        </div>
        @if (noMoves(); as rival) {
          <p class="text-xs text-orange-300" role="status">
            {{ i18n.t('goals.noMoves', { name: rival }) }}
          </p>
        }

        @if (plan(); as p) {
          <div class="flex flex-col gap-1.5 border-t border-slate-800 pt-2 text-xs" role="status">
            @if (p.ok) {
              @if (allMet()) {
                <p class="text-emerald-300">{{ i18n.t('goals.allMet') }}</p>
              }
              @if (changes().length) {
                <p class="text-slate-300">
                  {{ i18n.t('goals.proposal') }}
                  @for (c of changes(); track c.stat; let last = $last) {
                    <span class="font-mono whitespace-nowrap text-slate-100"
                      >{{ i18n.stat(c.stat) }} {{ c.from }}→{{ c.to }}</span
                    >{{ last ? '' : ' · ' }}
                  }
                </p>
                @if (p.leftover) {
                  <p class="text-slate-400">
                    {{ i18n.t('goals.leftover', { n: p.leftover }) }}
                  </p>
                }
                <button
                  type="button"
                  class="self-start rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-semibold text-slate-950 hover:bg-amber-300"
                  (click)="apply.emit(p.sps)"
                >
                  {{ i18n.t('goals.apply') }}
                </button>
              }
            } @else if (p.reason === 'unreachable') {
              <p class="text-orange-300">
                {{
                  i18n.t('goals.unreachable', {
                    goal: describe(goals()[p.goal]),
                    pct: format(p.best),
                  })
                }}
              </p>
            } @else {
              <p class="text-orange-300">
                {{
                  i18n.t('goals.tooMany', {
                    needed: p.needed,
                    stats: statList(p.stats),
                    available: p.available,
                  })
                }}
              </p>
            }
          </div>
        }
      }
    </section>
  `,
})
export class SpGoals {
  readonly member = input.required<TeamMember>();
  /** Aplicar el reparto propuesto. */
  readonly apply = output<Stats>();

  protected readonly i18n = inject(I18n);
  protected readonly data = inject(MetagameService);
  protected readonly kinds = KINDS;
  protected readonly confidence = GOAL_CONFIDENCE;
  protected readonly format = pct;

  private readonly saved = persistedSignal<Record<string, Goal[]>>('krustle.spGoals', {});
  protected readonly open = signal(false);
  protected readonly kind = signal<Goal['kind']>('survive');
  /** Rival recién elegido del que no hay ataques conocidos (no se puede aguantar nada). */
  protected readonly noMoves = signal<string | null>(null);

  protected readonly goals = computed(() => this.saved()[this.member().species] ?? []);

  protected readonly current = computed(() => {
    const metagame = this.data.metagame();
    return metagame ? checkGoals(metagame, this.member(), this.goals()) : [];
  });
  protected readonly allMet = computed(() => this.current().every((p) => p >= this.confidence));

  protected readonly plan = computed((): Plan | undefined => {
    const metagame = this.data.metagame();
    if (!metagame || !this.goals().length) return undefined;
    return planSps(metagame, this.member(), this.goals());
  });

  /** Los stats que cambia el reparto propuesto. */
  protected readonly changes = computed(() => {
    const plan = this.plan();
    if (!plan?.ok) return [];
    const sps = this.member().sps;
    return STAT_IDS.filter((s) => plan.sps[s] !== sps[s]).map((stat) => ({
      stat,
      from: sps[stat],
      to: plan.sps[stat],
    }));
  });

  protected kindLabel(kind: Goal['kind']): string {
    return this.i18n.t(`goals.${kind}` as MessageKey);
  }

  protected describe(goal: Goal | undefined): string {
    if (!goal) return '';
    const move = 'move' in goal ? ` (${this.i18n.move(goal.move)})` : '';
    return `${this.kindLabel(goal.kind)} ${goal.rival}${move}`;
  }

  protected statList(stats: StatId[]): string {
    return this.i18n.list(stats.map((s) => this.i18n.stat(s)));
  }

  protected movesFor(goal: Goal): string[] {
    const metagame = this.data.metagame();
    if (!metagame) return [];
    const moves = goalMoves(metagame, this.member(), goal.kind, goal.rival);
    return 'move' in goal && !moves.includes(goal.move) ? [goal.move, ...moves] : moves;
  }

  protected options(goal: Goal) {
    return OPTIONS[goal.kind];
  }

  protected flag(goal: Goal, key: string): boolean {
    return !!(goal as unknown as Record<string, unknown>)[key];
  }

  protected add(rival: string): void {
    const metagame = this.data.metagame();
    if (!metagame) return;
    const kind = this.kind();
    this.noMoves.set(null);
    if (kind === 'outspeed') {
      this.setGoals([...this.goals(), { kind, rival }]);
      return;
    }
    const [move] = goalMoves(metagame, this.member(), kind, rival);
    if (!move) {
      this.noMoves.set(rival);
      return;
    }
    this.setGoals([...this.goals(), { kind, rival, move }]);
  }

  protected update(index: number, change: Partial<Record<string, unknown>>): void {
    this.setGoals(this.goals().map((g, i) => (i === index ? ({ ...g, ...change } as Goal) : g)));
  }

  protected toggleFlag(index: number, key: string): void {
    this.update(index, { [key]: !this.flag(this.goals()[index], key) });
  }

  protected remove(index: number): void {
    this.setGoals(this.goals().filter((_, i) => i !== index));
  }

  private setGoals(goals: Goal[]): void {
    const species = this.member().species;
    this.saved.update((all) => ({ ...all, [species]: goals }));
  }
}

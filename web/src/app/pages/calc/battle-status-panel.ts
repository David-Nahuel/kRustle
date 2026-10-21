import { Component, computed, inject, input, output, signal } from '@angular/core';

import { type StatId, battleAbility, battleForme } from '../../../engine/champions';
import { currentHp } from '../../../engine/damage';
import type { BattleStatus } from '../../../engine/matchup';
import { type Actor, addBoosts, intimidateEffect } from '../../../engine/moves';
import { I18n } from '../../i18n/i18n.service';
import { Sprite } from '../../shared/sprite';

const STATUSES: BattleStatus['status'][] = [undefined, 'brn', 'par', 'psn', 'tox', 'slp', 'frz'];

const HP_SHORTCUTS = [100, 75, 50, 25];
const BOOSTABLE: StatId[] = ['atk', 'def', 'spa', 'spd', 'spe'];

/**
 * PS, megaevolución, estado alterado y cambios de stat de un Pokémon en la partida en curso.
 * Compacto para usarlo en el móvil durante el combate: a la vista solo lo que cambia cada turno
 * (PS, mega, objeto); estados, cambios de stat y atajos de PS, en "Más".
 */
@Component({
  selector: 'app-battle-status-panel',
  imports: [Sprite],
  template: `
    <section
      class="flex h-full flex-col gap-2 rounded-xl border bg-slate-900 p-2.5"
      [class]="mine() ? 'border-emerald-500/30' : 'border-rose-500/30'"
      [attr.aria-label]="i18n.t('panel.state', { name: species() })"
    >
      <header class="flex items-center gap-2.5">
        <app-sprite
          [species]="species()"
          [size]="40"
          [class.grayscale]="fainted()"
          [class.opacity-40]="fainted()"
        />
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline justify-between gap-2">
            <h3
              class="truncate font-semibold"
              [class]="mine() ? 'text-emerald-300' : 'text-rose-300'"
            >
              {{ forme() }}
            </h3>
            @if (fainted()) {
              <span class="shrink-0 font-mono text-sm tabular-nums">KO</span>
            } @else if (maxHp(); as max) {
              <!-- Los tuyos, en PS (los ves exactos en el juego); el rival, en porcentaje. -->
              <span class="flex shrink-0 items-baseline gap-1 font-mono text-sm tabular-nums">
                <label class="sr-only" [for]="id() + '-hp-points'">{{
                  i18n.t('panel.hpPoints', { name: species() })
                }}</label>
                <input
                  [id]="id() + '-hp-points'"
                  type="number"
                  inputmode="numeric"
                  min="0"
                  [max]="max"
                  [value]="points()"
                  (change)="setPoints($any($event.target))"
                  class="h-7 w-14 rounded-md bg-slate-950 px-1 text-right ring-1 ring-slate-700 [appearance:textfield] focus:ring-amber-400 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span class="text-slate-400">/ {{ max }} {{ i18n.t('panel.hpUnit') }}</span>
              </span>
            } @else {
              <span class="shrink-0 font-mono text-sm tabular-nums">{{ status().hp }}%</span>
            }
          </div>
          <!-- La barra de PS es el propio control: se arrastra o se toca donde se quiera. -->
          <div
            class="relative flex h-7 items-center rounded-full has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-amber-400"
          >
            <div class="h-2.5 w-full overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
              <div class="h-full rounded-full {{ hpColor() }}" [style.width.%]="status().hp"></div>
            </div>
            <label class="sr-only" [for]="id() + '-hp'">{{
              i18n.t(maxHp() ? 'panel.hpPoints' : 'panel.hpLabel', { name: species() })
            }}</label>
            <input
              [id]="id() + '-hp'"
              type="range"
              min="0"
              [max]="maxHp() ?? 100"
              step="1"
              [value]="points() ?? status().hp"
              (input)="setFromBar(+$any($event.target).value)"
              class="absolute inset-0 w-full cursor-pointer opacity-0"
            />
          </div>
        </div>
      </header>

      <div class="flex flex-wrap items-center gap-1.5">
        @for (stone of shownStones(); track stone) {
          <button
            type="button"
            [attr.aria-pressed]="megaStone() === stone"
            [class]="megaChip(megaStone() === stone)"
            [title]="megaTitle(stone)"
            (click)="megaEvolve.emit(megaStone() === stone ? null : stone)"
          >
            @if (megaStone() === stone) {
              {{ i18n.t('panel.megaDone', { suffix: megaSuffix(stone) }) }}
              @if (megaAbility(); as ability) {
                <span class="text-fuchsia-300/80">· {{ i18n.ability(ability) }}</span>
              }
            } @else {
              {{ i18n.t('panel.megaEvolve', { suffix: megaSuffix(stone) }) }}
              @if (otherMega(); as other) {
                <span class="text-slate-400">{{ i18n.t('panel.instead', { name: other }) }}</span>
              }
            }
          </button>
        }
        <button
          type="button"
          [attr.aria-pressed]="!!status().itemConsumed"
          [class]="chip(!!status().itemConsumed)"
          (click)="set({ itemConsumed: !status().itemConsumed })"
        >
          {{ i18n.t('panel.itemUsed') }}
          @if (unburden()) {
            <span class="text-emerald-300">· ×2 {{ i18n.stat('spe') }}</span>
          }
        </button>
        @if (intimidate(); as effect) {
          <button
            type="button"
            class="h-8 rounded-lg bg-rose-500/10 px-2.5 text-xs text-rose-200 ring-1 ring-rose-400/40 hover:bg-rose-500/20"
            [title]="
              i18n.t('panel.intimidateTitle', {
                ability: i18n.ability('Intimidate'),
                name: species(),
              })
            "
            (click)="applyIntimidate()"
          >
            {{ i18n.ability('Intimidate') }}: {{ effect.label }}
          </button>
        }
        <!-- Lo que está activo aunque "Más" esté cerrado. -->
        @for (tag of summary(); track tag) {
          <span class="rounded-md bg-slate-800 px-1.5 py-0.5 text-xs text-slate-200">{{
            tag
          }}</span>
        }
        <button
          type="button"
          class="ml-auto h-8 rounded-lg px-2.5 text-xs text-slate-300 ring-1 ring-slate-700 hover:text-slate-100"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="id() + '-more'"
          (click)="expanded.set(!expanded())"
        >
          {{ i18n.t(expanded() ? 'common.less' : 'common.more') }}
        </button>
      </div>

      @if (expanded()) {
        <div [id]="id() + '-more'" class="flex flex-col gap-2.5 border-t border-slate-800 pt-2.5">
          <div
            class="flex gap-1.5"
            role="group"
            [attr.aria-label]="i18n.t('panel.hpGroup', { name: species() })"
          >
            @for (hp of hpShortcuts; track hp) {
              <button
                type="button"
                class="flex-1"
                [class]="bigChip(status().hp === hp)"
                [title]="hp + '%'"
                (click)="set({ hp })"
              >
                {{ shortcutLabel(hp) }}
              </button>
            }
            <button
              type="button"
              class="flex-1"
              [class]="bigChip(fainted())"
              (click)="set({ hp: 0 })"
            >
              KO
            </button>
          </div>

          <div
            class="flex flex-wrap gap-1.5"
            role="radiogroup"
            [attr.aria-label]="i18n.t('panel.state', { name: species() })"
          >
            @for (s of statuses; track $index) {
              <button
                type="button"
                role="radio"
                [attr.aria-checked]="status().status === s"
                [class]="bigChip(status().status === s)"
                (click)="set({ status: s })"
              >
                {{ statusLabel(s) }}
              </button>
            }
          </div>

          <div class="grid grid-cols-5 gap-1 text-center">
            @for (stat of boostable; track stat) {
              <div class="flex flex-col items-center gap-1">
                <span class="text-xs text-slate-400">{{ i18n.stat(stat) }}</span>
                <button
                  type="button"
                  class="h-9 w-full max-w-14 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
                  [attr.aria-label]="i18n.t('panel.raise', { stat: i18n.stat(stat) })"
                  (click)="boost(stat, 1)"
                >
                  +
                </button>
                <span
                  class="font-mono text-sm tabular-nums"
                  [class]="
                    stage(stat) > 0
                      ? 'text-emerald-300'
                      : stage(stat) < 0
                        ? 'text-rose-300'
                        : 'text-slate-400'
                  "
                >
                  {{ stage(stat) > 0 ? '+' : '' }}{{ stage(stat) }}
                </span>
                <button
                  type="button"
                  class="h-9 w-full max-w-14 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700"
                  [attr.aria-label]="i18n.t('panel.lower', { stat: i18n.stat(stat) })"
                  (click)="boost(stat, -1)"
                >
                  −
                </button>
              </div>
            }
          </div>
        </div>
      }
    </section>
  `,
})
export class BattleStatusPanel {
  readonly species = input.required<string>();
  readonly status = input.required<BattleStatus>();
  /** Mi Pokémon (verde) o el rival (rojo). */
  readonly mine = input(false);
  /**
   * PS máximos, si se saben (los de tu equipo): entonces la vida se ve y se edita en PS. Se sigue
   * guardando en porcentaje, que es lo que usan los cálculos y lo único que se ve del rival.
   */
  readonly maxHp = input<number>();
  /** Objeto y habilidad de este Pokémon (para Unburden e Intimidate). */
  readonly self = input<Actor>();
  /** Habilidad del Pokémon de enfrente: si es Intimidate, se ofrece aplicarlo. */
  readonly opponentAbility = input<string>();
  /** Piedras con las que puede megaevolucionar (vacío si no puede). */
  readonly stones = input<string[]>([]);
  /** Quién de su equipo ha megaevolucionado ya, si alguien lo ha hecho. */
  readonly megaUsedBy = input<string>();
  readonly changed = output<BattleStatus>();
  /** Megaevoluciona con esa piedra, o lo deshace con `null`. */
  readonly megaEvolve = output<string | null>();

  protected readonly i18n = inject(I18n);

  /** Estados, cambios de stat y atajos de PS desplegados. */
  protected readonly expanded = signal(false);

  /** Este Pokémon tal y como está ahora (con la mega si ya la ha hecho). */
  private readonly actor = computed<Actor | undefined>(() => {
    const self = this.self();
    return self && { ...self, mega: !!this.status().mega };
  });

  protected readonly forme = computed(() => {
    const self = this.actor();
    return self?.mega ? battleForme(self.species, self.item) : this.species();
  });
  protected readonly megaStone = computed(() =>
    this.status().mega ? this.self()?.item : undefined,
  );
  /** Ya megaevolucionado, solo la piedra con la que lo hizo (para deshacerlo). */
  protected readonly shownStones = computed(() => {
    const stone = this.megaStone();
    return stone ? [stone] : this.stones();
  });
  protected readonly megaAbility = computed(() => {
    const self = this.actor();
    return self?.mega ? battleAbility(self.species, self.item, self.ability) : undefined;
  });
  protected readonly otherMega = computed(() => {
    const other = this.megaUsedBy();
    return other && other !== this.species() ? other : undefined;
  });

  protected readonly unburden = computed(() => {
    const self = this.actor();
    return (
      !!this.status().itemConsumed &&
      !!self &&
      battleAbility(self.species, self.item, self.ability, self.mega) === 'Unburden'
    );
  });

  protected readonly intimidate = computed(() => {
    const self = this.actor();
    if (this.opponentAbility() !== 'Intimidate' || !self) return undefined;
    const delta = intimidateEffect(self);
    const parts = Object.entries(delta).map(
      ([stat, v]) => `${v > 0 ? '+' : '−'}${Math.abs(v)} ${this.i18n.stat(stat as StatId)}`,
    );
    const label = parts.length ? parts.join(', ') : this.i18n.t('panel.noEffect');
    const ability = self.mega ? this.megaAbility() : self.ability;
    // Si no es el −1 Atq de siempre, es por la habilidad: se dice cuál.
    const usual = delta.atk === -1 && Object.keys(delta).length === 1;
    return {
      delta,
      label: ability && !usual ? `${label} (${this.i18n.ability(ability)})` : label,
    };
  });

  /** Estado alterado y cambios de stat activos, para verlos con "Más" cerrado. */
  protected readonly summary = computed(() => {
    if (this.expanded()) return [];
    const { status, boosts } = this.status();
    const tags = status ? [this.statusLabel(status)] : [];
    for (const stat of BOOSTABLE) {
      const stage = boosts[stat] ?? 0;
      if (stage) tags.push(`${stage > 0 ? '+' : '−'}${Math.abs(stage)} ${this.i18n.stat(stat)}`);
    }
    return tags;
  });

  protected applyIntimidate(): void {
    const effect = this.intimidate();
    if (effect) this.set({ boosts: addBoosts(this.status().boosts, effect.delta) });
  }

  protected readonly statuses = STATUSES;
  protected readonly hpShortcuts = HP_SHORTCUTS;
  protected readonly boostable = BOOSTABLE;

  protected readonly id = computed(() => `${this.mine() ? 'mine' : 'rival'}-${this.species()}`);
  protected readonly fainted = computed(() => this.status().hp === 0);
  protected readonly hpColor = computed(() => {
    const hp = this.status().hp;
    return hp > 50 ? 'bg-emerald-400' : hp > 20 ? 'bg-amber-400' : 'bg-rose-500';
  });

  protected stage(stat: StatId): number {
    return this.status().boosts[stat] ?? 0;
  }

  /** PS actuales (solo si se saben los máximos). */
  protected readonly points = computed(() => {
    const max = this.maxHp();
    return max ? currentHp(max, this.status().hp) : undefined;
  });

  /** La barra va en PS si se saben los máximos y, si no, en porcentaje. */
  protected setFromBar(value: number): void {
    const max = this.maxHp();
    this.set({ hp: max ? (value / max) * 100 : value });
  }

  /** PS escritos a mano: entre 0 y los máximos. */
  protected setPoints(field: HTMLInputElement): void {
    const max = this.maxHp();
    if (!max) return;
    const points = Math.max(0, Math.min(max, Math.round(Number(field.value) || 0)));
    field.value = String(points);
    this.set({ hp: (points / max) * 100 });
  }

  /** Atajos de "Más": en PS para los tuyos (con el porcentaje en el título), en % para el rival. */
  protected shortcutLabel(percent: number): string {
    const max = this.maxHp();
    return max ? String(currentHp(max, percent)) : `${percent}%`;
  }

  protected set(patch: Partial<BattleStatus>): void {
    this.changed.emit({ ...this.status(), ...patch });
  }

  protected boost(stat: StatId, delta: number): void {
    const value = Math.max(-6, Math.min(6, this.stage(stat) + delta));
    this.set({ boosts: { ...this.status().boosts, [stat]: value } });
  }

  /** "X"/"Y" si la especie tiene varias megas (Charizard); si no, nada. */
  protected megaSuffix(stone: string): string {
    if (this.stones().length < 2) return '';
    const suffix = battleForme(this.species(), stone).split('-Mega-')[1];
    return suffix ? ` ${suffix}` : ` (${stone})`;
  }

  protected megaTitle(stone: string): string {
    const t = this.i18n.t;
    if (this.megaStone() === stone) return t('panel.megaUndo');
    const other = this.otherMega();
    return other
      ? t('panel.megaOnlyOne', { name: other })
      : t('panel.megaWith', { stone: this.i18n.item(stone) });
  }

  protected statusLabel(status: BattleStatus['status']): string {
    return this.i18n.t(`status.${status ?? 'none'}`);
  }

  protected megaChip(active: boolean): string {
    return `h-8 rounded-lg px-2.5 text-xs ring-1 ${
      active
        ? 'bg-fuchsia-500/15 text-fuchsia-200 ring-fuchsia-400/60'
        : 'text-fuchsia-300 ring-fuchsia-500/40 hover:bg-fuchsia-500/10'
    }`;
  }

  protected chip(active: boolean): string {
    return `h-8 rounded-lg px-2.5 text-xs ring-1 ${
      active
        ? 'bg-amber-400/15 text-amber-200 ring-amber-400/60'
        : 'text-slate-300 ring-slate-700 hover:text-slate-100'
    }`;
  }

  /** Botones de "Más": más grandes, para acertar con el dedo durante la partida. */
  protected bigChip(active: boolean): string {
    return `h-9 rounded-lg px-3 text-sm ring-1 ${
      active
        ? 'bg-amber-400/15 text-amber-200 ring-amber-400/60'
        : 'text-slate-300 ring-slate-700 hover:text-slate-100'
    }`;
  }
}

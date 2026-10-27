import { Component, computed, inject, input, signal } from '@angular/core';

import { getMove } from '../../../engine/champions';
import { comboFromMatchups } from '../../../engine/combined';
import type { DamageOdds } from '../../../engine/damage';
import type { Matchup, MoveRow } from '../../../engine/matchup';
import { CalcState } from '../../data/calc-state.service';
import { TeamStore } from '../../data/team-store.service';
import { I18n } from '../../i18n/i18n.service';
import { TONE_CLASSES, TYPE_CLASSES, comboSummary } from '../../shared/format';
import { Sprite } from '../../shared/sprite';

interface Attacker {
  species: string;
  rows: (MoveRow & { odds: DamageOdds })[];
  /** El elegido, o el que más daño hace si no se ha elegido ninguno (o ya no está). */
  move: string | undefined;
}

/**
 * Golpe doble: el Pokémon elegido y un compañero de su lado atacan al mismo objetivo en el
 * mismo turno. `mine`: los míos contra el rival elegido; `theirs`: los suyos contra el mío.
 */
@Component({
  selector: 'app-combo-card',
  imports: [Sprite],
  template: `
    <div class="mt-1 flex flex-col gap-2 border-t border-slate-800 pt-2.5">
      <div class="flex items-center gap-2">
        <h4 class="shrink-0 text-xs font-semibold tracking-wide text-slate-400 uppercase">
          {{ i18n.t('combo.title') }}
        </h4>
        <div
          class="flex flex-wrap gap-1"
          role="radiogroup"
          [attr.aria-label]="i18n.t('combo.partnerAria')"
        >
          @for (species of candidates(); track species) {
            <button
              type="button"
              role="radio"
              [attr.aria-checked]="species === partner()"
              [title]="species"
              (click)="choosePartner(species)"
              class="flex h-9 w-9 items-center justify-center rounded-lg ring-1"
              [class]="
                species === partner() ? activeClass() : 'ring-slate-800 hover:ring-slate-600'
              "
            >
              <app-sprite
                [species]="species"
                [size]="28"
                [class.opacity-40]="fainted(species)"
                [class.grayscale]="fainted(species)"
              />
            </button>
          }
        </div>
      </div>

      @if (attackers(); as both) {
        @for (attacker of both; track $index; let i = $index) {
          <div class="flex items-start gap-2">
            <app-sprite class="shrink-0" [species]="attacker.species" [size]="24" />
            <div
              class="flex flex-wrap gap-1"
              role="radiogroup"
              [attr.aria-label]="i18n.t('combo.moveAria', { name: attacker.species })"
            >
              @for (row of attacker.rows; track row.move) {
                <button
                  type="button"
                  role="radio"
                  [attr.aria-checked]="row.move === attacker.move"
                  (click)="chooseMove(i, row.move)"
                  class="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ring-1"
                  [class]="
                    row.move === attacker.move
                      ? activeClass() + ' text-slate-100'
                      : 'text-slate-300 ring-slate-700 hover:ring-slate-500'
                  "
                >
                  <span
                    class="h-2 w-2 shrink-0 rounded-full {{ typeClass(row.move) }}"
                    aria-hidden="true"
                  ></span>
                  {{ i18n.move(row.move) }}
                </button>
              } @empty {
                <p class="py-1 text-xs text-slate-400">
                  {{ i18n.t('combo.noMoves', { name: attacker.species }) }}
                </p>
              }
            </div>
          </div>
        }

        @if (odds(); as o) {
          <div class="flex flex-col gap-1.5 pt-1">
            <div class="flex items-center justify-end">
              <span
                class="rounded-md px-2 py-0.5 text-xs font-semibold ring-1 {{ summary().tone }}"
              >
                {{ summary().label }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <div
                class="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-800"
                aria-hidden="true"
              >
                <div
                  class="absolute inset-y-0 rounded-full {{ barClass() }} opacity-30"
                  [style.left.%]="bar().rangeStart"
                  [style.width.%]="bar().rangeWidth"
                ></div>
                <div
                  class="absolute inset-y-0 rounded-full {{ barClass() }}"
                  [style.left.%]="bar().likelyStart"
                  [style.width.%]="bar().likelyWidth"
                ></div>
                <!-- Los PS que le quedan: si el daño pasa de aquí, lo debilita. -->
                @if (bar().hp < 100) {
                  <div
                    class="absolute inset-y-0 w-0.5 bg-slate-100"
                    [style.left.%]="bar().hp"
                  ></div>
                }
              </div>
              <span class="w-28 text-right font-mono text-sm text-slate-200 tabular-nums">
                {{ o.likely.minPercent }}–{{ o.likely.maxPercent }}%
              </span>
            </div>
            @if (hasRange()) {
              <p class="text-right text-xs text-slate-400">
                {{ i18n.t('damage.range', { from: o.percentRange[0], to: o.percentRange[1] }) }}
              </p>
            }
            <p class="text-xs text-slate-400">
              {{
                i18n.t('combo.note', {
                  item: i18n.item('Sitrus Berry'),
                  ability: i18n.ability('Multiscale'),
                })
              }}
            </p>
          </div>
        }
      } @else if (candidates().length) {
        <p class="text-xs text-slate-400">
          {{ i18n.t(side() === 'mine' ? 'combo.hintMine' : 'combo.hintTheirs') }}
        </p>
      }
    </div>
  `,
})
export class ComboCard {
  readonly side = input.required<'mine' | 'theirs'>();

  protected readonly i18n = inject(I18n);
  private readonly state = inject(CalcState);
  private readonly myTeam = inject(TeamStore).activeMembers;

  /** Movimiento elegido para cada uno: el Pokémon elegido y su compañero. */
  private readonly chosen = signal<[string | null, string | null]>([null, null]);

  private readonly mine = computed(() => this.side() === 'mine');

  protected readonly candidates = computed(() =>
    this.mine()
      ? this.myTeam()
          .map((m) => m.species)
          .filter((s) => s !== this.state.me()?.species)
      : this.state.rivals().filter((s) => s !== this.state.rival()),
  );

  protected readonly partner = computed(() =>
    this.mine() ? this.state.myPartner()?.species : this.state.rivalPartner(),
  );

  private readonly matchups = computed((): [Matchup, Matchup] | undefined => {
    const main = this.state.matchup();
    const partner = this.mine() ? this.state.myPartnerMatchup() : this.state.rivalPartnerMatchup();
    return main && partner ? [main, partner] : undefined;
  });

  protected readonly attackers = computed((): [Attacker, Attacker] | undefined => {
    const matchups = this.matchups();
    const partner = this.partner();
    if (!matchups || !partner) return undefined;
    const main = this.mine() ? this.state.me()?.species : this.state.rival();
    const attacker = (species: string, m: Matchup, chosen: string | null): Attacker => {
      const rows = (this.mine() ? m.myMoves : m.theirMoves).filter(
        (r): r is MoveRow & { odds: DamageOdds } => !!r.odds,
      );
      const best = rows.reduce<(typeof rows)[number] | undefined>(
        (top, r) => (!top || r.odds.likely.maxPercent > top.odds.likely.maxPercent ? r : top),
        undefined,
      );
      const move = rows.some((r) => r.move === chosen) ? chosen! : best?.move;
      return { species, rows, move };
    };
    const [first, second] = this.chosen();
    return [attacker(main ?? '', matchups[0], first), attacker(partner, matchups[1], second)];
  });

  protected readonly odds = computed(() => {
    const matchups = this.matchups();
    const [first, second] = this.attackers() ?? [];
    if (!matchups || !first?.move || !second?.move) return null;
    return comboFromMatchups(this.side(), matchups[0], matchups[1], [first.move, second.move]);
  });

  protected readonly summary = computed(() => {
    const { label, tone } = comboSummary(this.odds()!, this.mine(), this.i18n.t);
    return { label, tone: TONE_CLASSES[tone] };
  });

  /** PS que le quedan a quien recibe los golpes, en %. */
  protected readonly targetHp = computed(() =>
    this.mine() ? this.state.rivalStatus().hp : this.state.myStatus().hp,
  );

  protected readonly activeClass = computed(() =>
    this.mine() ? 'bg-emerald-400/15 ring-emerald-400/70' : 'bg-rose-400/15 ring-rose-400/70',
  );
  protected readonly barClass = computed(() => (this.mine() ? 'bg-emerald-400' : 'bg-rose-400'));

  protected readonly hasRange = computed(() => {
    const odds = this.odds();
    if (!odds) return false;
    const { likely, percentRange } = odds;
    return percentRange[0] !== likely.minPercent || percentRange[1] !== likely.maxPercent;
  });

  /**
   * Entre los dos suelen pasar del 100%: la barra se alarga hasta el daño máximo (en vez de
   * recortarlo) y una línea marca los PS que le quedan.
   */
  protected readonly bar = computed(() => {
    const odds = this.odds();
    if (!odds) return { rangeStart: 0, rangeWidth: 0, likelyStart: 0, likelyWidth: 0, hp: 100 };
    const { likely, percentRange } = odds;
    const scale = Math.max(100, percentRange[1], likely.maxPercent) / 100;
    const at = (x: number) => Math.max(0, x) / scale;
    return {
      rangeStart: at(percentRange[0]),
      rangeWidth: at(percentRange[1]) - at(percentRange[0]),
      likelyStart: at(likely.minPercent),
      likelyWidth: Math.max(1, at(likely.maxPercent) - at(likely.minPercent)),
      hp: at(this.targetHp()),
    };
  });

  protected fainted(species: string): boolean {
    const status = this.mine() ? this.state.myStatusOf(species) : this.state.rivalStatusOf(species);
    return status.hp === 0;
  }

  protected typeClass(move: string): string {
    return TYPE_CLASSES[getMove(move)?.type ?? 'Normal'] ?? 'bg-slate-500';
  }

  /** Tocar el compañero elegido lo quita. */
  protected choosePartner(species: string): void {
    const choice = this.mine() ? this.state.myPartnerChoice : this.state.rivalPartnerChoice;
    choice.set(choice() === species ? null : species);
    this.chosen.update(([first]) => [first, null]);
  }

  protected chooseMove(index: number, move: string): void {
    this.chosen.update((c) => (index === 0 ? [move, c[1]] : [c[0], move]));
  }
}

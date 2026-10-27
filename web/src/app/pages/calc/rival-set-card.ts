import { Component, computed, inject, input, output } from '@angular/core';

import { STAT_IDS, battleAbility, battleForme } from '../../../engine/champions';
import { type Revealed, candidateLabels } from '../../../engine/inference';
import type { Matchup } from '../../../engine/matchup';
import type { Meta } from '../../../engine/metagame';
import { I18n } from '../../i18n/i18n.service';
import { pct } from '../../shared/format';
import { ItemIcon } from '../../shared/item-icon';
import { RevealedEditor } from './revealed-editor';

/** El set que suponemos que lleva el rival, sus alternativas y de dónde sale. */
@Component({
  selector: 'app-rival-set-card',
  imports: [ItemIcon, RevealedEditor],
  template: `
    <section class="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
      <header class="flex items-baseline justify-between gap-2">
        <h3 class="font-semibold text-slate-100">{{ i18n.t('set.title') }}</h3>
        @if (matchup().inference; as inf) {
          <span class="text-xs text-slate-400">
            @if (inf.fromPlayer && playerName()) {
              <span class="text-rose-300">
                {{
                  i18n.t('set.fromPlayer', {
                    count: inf.fromPlayer,
                    sets: i18n.t(inf.fromPlayer === 1 ? 'set.set' : 'set.sets'),
                    name: playerName()!,
                  })
                }}
              </span>
            }
            {{ i18n.t('set.teams', { n: i18n.number(inf.sampleSize) }) }}
            @if (inf.similarTeams) {
              {{ i18n.t('set.similar', { n: inf.similarTeams }) }}
            }
          </span>
        }
      </header>

      @if (matchup().inference; as inf) {
        @if (inf.candidates.length > 1) {
          <div
            class="flex flex-wrap gap-1.5"
            role="tablist"
            [attr.aria-label]="i18n.t('set.candidates')"
          >
            @for (c of inf.candidates; track $index; let i = $index) {
              <button
                type="button"
                role="tab"
                [attr.aria-selected]="$index === selected()"
                (click)="choose.emit($index)"
                class="rounded-lg px-2 py-1 text-left text-xs ring-1"
                [class]="
                  $index === selected()
                    ? 'bg-amber-400/15 text-amber-200 ring-amber-400/60'
                    : 'text-slate-400 ring-slate-700 hover:text-slate-200'
                "
              >
                <app-item-icon [item]="c.item" class="-my-1 align-middle" />
                {{ candidateLabels()[i] }}
                <span class="ml-1 text-slate-400">{{ pct(c.probability) }}</span>
              </button>
            }
          </div>
        }
      } @else {
        <p class="text-sm text-amber-200">
          {{ i18n.t('set.notInTournaments', { species: matchup().rivalSet.species }) }}
        </p>
      }

      <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt class="text-slate-400">{{ i18n.t('set.item') }}</dt>
        <dd class="flex items-center gap-1 text-slate-200">
          <app-item-icon [item]="matchup().rivalSet.item" class="-my-1" />
          {{ matchup().rivalSet.item ? i18n.item(matchup().rivalSet.item!) : '?' }}
        </dd>
        <dt class="text-slate-400">{{ i18n.t('set.ability') }}</dt>
        <dd class="text-slate-200">
          {{ matchup().rivalSet.ability ? i18n.ability(matchup().rivalSet.ability!) : '?' }}
          @if (megaForme(); as forme) {
            <span class="text-fuchsia-300">→ {{ forme.ability }} ({{ forme.name }})</span>
          }
        </dd>
        <dt class="text-slate-400">{{ i18n.t('set.moves') }}</dt>
        <dd class="text-slate-200">{{ moves() || '?' }}</dd>
        @if (topSpread(); as spread) {
          <dt class="text-slate-400">{{ i18n.t('set.sp') }}</dt>
          <dd class="text-slate-200">
            {{ spread.nature }}
            <span class="font-mono">{{ spread.text }}</span>
            <span class="ml-1 text-slate-400">{{ pct(spread.probability) }}</span>
          </dd>
        }
      </dl>

      <div class="border-t border-slate-800 pt-3">
        <app-revealed-editor
          [inference]="matchup().inference"
          [rivalSet]="matchup().rivalSet"
          [revealed]="revealed()"
          [earlier]="earlier()"
          (changed)="reveal.emit($event)"
        />
      </div>

      @if (otherItems().length) {
        <p class="text-xs text-slate-400">
          {{ i18n.t('set.otherItems') }}
          @for (item of otherItems(); track item[0]; let last = $last) {
            {{ i18n.item(item[0]) }} {{ pct(item[1]) }}{{ last ? '' : ' · ' }}
          }
        </p>
      }
      <p class="text-xs text-slate-400">{{ spreadSource() }}</p>
    </section>
  `,
})
export class RivalSetCard {
  readonly matchup = input.required<Matchup>();
  readonly selected = input(0);
  readonly meta = input<Meta>();
  readonly revealed = input<Revealed>({});
  readonly earlier = input<Revealed>({});
  /** Ya ha megaevolucionado: su habilidad pasa a ser la de la mega. */
  readonly mega = input(false);
  /** Nombre del rival, si se sabe quién es. */
  readonly playerName = input<string>();
  readonly choose = output<number>();
  readonly reveal = output<Revealed>();

  protected readonly i18n = inject(I18n);
  protected readonly pct = pct;

  protected readonly megaForme = computed(() => {
    const { species, item, ability } = this.matchup().rivalSet;
    const name = battleForme(species, item);
    if (!this.mega() || name === battleForme(species)) return undefined;
    const megaAbility = battleAbility(species, item, ability);
    return { name, ability: megaAbility && this.i18n.ability(megaAbility) };
  });

  protected readonly moves = computed(() =>
    this.matchup().rivalSet.moves.map(this.i18n.move).join(' · '),
  );

  protected readonly candidateLabels = computed(() =>
    candidateLabels(
      this.matchup().inference?.candidates ?? [],
      this.i18n.any,
      this.i18n.t('common.noItem'),
    ),
  );

  protected readonly topSpread = computed(() => {
    const top = this.matchup().spreads.spreads[0];
    if (!top) return undefined;
    const text = STAT_IDS.filter((s) => top.sps[s] > 0)
      .map((s) => `${top.sps[s]} ${this.i18n.stat(s)}`)
      .join(' / ');
    return { nature: this.i18n.nature(top.nature), text, probability: top.probability };
  });

  protected readonly otherItems = computed(() => {
    const current = this.matchup().rivalSet.item;
    return (this.matchup().inference?.items ?? []).filter(([name]) => name !== current).slice(0, 3);
  });

  protected readonly spreadSource = computed(() => {
    if (this.matchup().spreads.source === 'estimated') return this.i18n.t('set.sourceEstimated');
    const month = this.meta()?.spreadsMonth;
    return this.i18n.t('set.source', { month: month ? ` (${this.i18n.month(month)})` : '' });
  });
}

import { Component, computed, inject, input } from '@angular/core';

import { getMove } from '../../../engine/champions';
import type { DamageOdds } from '../../../engine/damage';
import type { Priority } from '../../../engine/moves';
import { I18n } from '../../i18n/i18n.service';
import { TONE_CLASSES, TYPE_CLASSES, koSummary } from '../../shared/format';

/**
 * Una fila por movimiento: barra con el daño más probable (sólido) y el rango según los
 * repartos posibles del rival (claro), y el resumen de KO.
 */
@Component({
  selector: 'app-damage-row',
  template: `
    <div class="flex flex-col gap-1.5 py-2" [title]="odds().likely.description">
      <div class="flex items-center gap-2">
        <span class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase {{ typeClass() }}">{{
          i18n.type(type())
        }}</span>
        <span class="min-w-0 flex-1 truncate font-medium text-slate-100">
          {{ i18n.move(move()) }}
          @if (priorityText(); as label) {
            <span class="ml-1 rounded bg-sky-500/15 px-1 text-xs font-semibold text-sky-300">{{
              label
            }}</span>
          }
        </span>
        <span class="rounded-md px-2 py-0.5 text-xs font-semibold ring-1 {{ toneClass() }}">{{
          ko().label
        }}</span>
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
        </div>
        <span class="w-28 text-right font-mono text-sm text-slate-200 tabular-nums">
          {{ odds().likely.minPercent }}–{{ odds().likely.maxPercent }}%
        </span>
      </div>
      @if (hasRange()) {
        <p class="text-right text-xs text-slate-400">
          {{ i18n.t('damage.range', { from: odds().percentRange[0], to: odds().percentRange[1] }) }}
        </p>
      }
    </div>
  `,
})
export class DamageRow {
  readonly move = input.required<string>();
  readonly odds = input.required<DamageOdds>();
  /** `true` si golpeo yo (KO = bueno), `false` si golpea el rival. */
  readonly attacking = input.required<boolean>();
  readonly priority = input<Priority>();

  protected readonly i18n = inject(I18n);
  protected readonly priorityText = computed(() => this.i18n.priority(this.priority()));

  protected readonly type = computed(() => getMove(this.move())?.type ?? 'Normal');
  protected readonly typeClass = computed(() => TYPE_CLASSES[this.type()] ?? 'bg-slate-500');
  protected readonly ko = computed(() => koSummary(this.odds(), this.attacking(), this.i18n.t));
  protected readonly toneClass = computed(() => TONE_CLASSES[this.ko().tone]);
  protected readonly barClass = computed(() =>
    this.attacking() ? 'bg-emerald-400' : 'bg-rose-400',
  );

  protected readonly hasRange = computed(() => {
    const { likely, percentRange } = this.odds();
    return percentRange[0] !== likely.minPercent || percentRange[1] !== likely.maxPercent;
  });

  protected readonly bar = computed(() => {
    const clamp = (x: number) => Math.min(100, Math.max(0, x));
    const { likely, percentRange } = this.odds();
    return {
      rangeStart: clamp(percentRange[0]),
      rangeWidth: clamp(percentRange[1]) - clamp(percentRange[0]),
      likelyStart: clamp(likely.minPercent),
      likelyWidth: Math.max(1, clamp(likely.maxPercent) - clamp(likely.minPercent)),
    };
  });
}

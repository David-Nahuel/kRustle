import { Component, computed, inject, input } from '@angular/core';

import type { SpeedComparison } from '../../../engine/speed';
import { I18n } from '../../i18n/i18n.service';
import { TONE_CLASSES, type Tone, pct } from '../../shared/format';

/**
 * Quién se mueve antes, con la probabilidad según los repartos posibles del rival. Una sola
 * línea entre los dos Pokémon y sus ataques.
 */
@Component({
  selector: 'app-speed-card',
  template: `
    <p class="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm" aria-live="polite">
      <span class="rounded-md px-2 py-0.5 font-semibold ring-1 {{ toneClass() }}">{{
        verdict().label
      }}</span>
      <span class="font-mono text-slate-300 tabular-nums">
        <span class="text-slate-400">{{ i18n.stat('spe') }}</span> {{ speed().mySpeed }}
        <span class="text-slate-400">{{ i18n.t('common.vs') }}</span>
        {{ speed().theirLikely }}
        @if (speed().theirRange[0] !== speed().theirRange[1]) {
          <span class="text-slate-400"
            >({{ speed().theirRange[0] }}–{{ speed().theirRange[1] }})</span
          >
        }
      </span>
      @if (trickRoom()) {
        <span class="text-xs text-violet-300">{{
          i18n.t('speed.trickRoom', { move: i18n.move('Trick Room') })
        }}</span>
      }
    </p>
  `,
})
export class SpeedCard {
  readonly speed = input.required<SpeedComparison>();
  readonly trickRoom = input(false);

  protected readonly i18n = inject(I18n);

  protected readonly verdict = computed((): { label: string; tone: Tone } => {
    const t = this.i18n.t;
    const { first, tie, second } = this.speed();
    if (first >= 0.95) return { label: t('speed.first'), tone: 'good' };
    if (second >= 0.95) return { label: t('speed.second'), tone: 'bad' };
    if (tie >= 0.95) return { label: t('speed.tie'), tone: 'warn' };
    const tieText = tie >= 0.01 ? t('speed.tieShort', { pct: pct(tie) }) : '';
    if (first >= 0.6) {
      return { label: t('speed.probFirst', { pct: pct(first), tie: tieText }), tone: 'good' };
    }
    if (second >= 0.6) {
      return { label: t('speed.probSecond', { pct: pct(second), tie: tieText }), tone: 'bad' };
    }
    return { label: t('speed.depends', { pct: pct(first), tie: tieText }), tone: 'warn' };
  });
  protected readonly toneClass = computed(() => TONE_CLASSES[this.verdict().tone]);
}

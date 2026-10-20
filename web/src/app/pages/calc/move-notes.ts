import { Component, inject, input } from '@angular/core';

import type { MoveRow } from '../../../engine/matchup';
import type { BlockReason } from '../../../engine/moves';
import { I18n } from '../../i18n/i18n.service';
import { TYPE_CLASSES } from '../../shared/format';

/**
 * Movimientos que no hacen daño (de estado) o que no afectan al rival (bloqueados o inmunes):
 * su prioridad importa tanto como el daño, y si fallan hay que saberlo.
 */
@Component({
  selector: 'app-move-notes',
  template: `
    @if (rows().length) {
      <ul class="flex flex-wrap gap-1.5 border-t border-slate-800 pt-2.5 mt-1">
        @for (row of rows(); track row.move) {
          <li
            class="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ring-1"
            [class]="row.blocked ? 'bg-slate-950 ring-slate-800' : 'bg-slate-800/60 ring-slate-700'"
            [title]="reason(row.blocked)"
          >
            <span
              class="h-2 w-2 shrink-0 rounded-full {{ typeClass(row) }}"
              aria-hidden="true"
            ></span>
            <span [class]="row.blocked ? 'text-slate-400 line-through' : 'text-slate-200'">{{
              i18n.move(row.move)
            }}</span>
            @if (i18n.priority(row.priority); as label) {
              <span class="rounded bg-sky-500/15 px-1 font-semibold text-sky-300">{{ label }}</span>
            }
            @if (row.blocked) {
              <span class="text-amber-300">{{ reason(row.blocked) }}</span>
            }
          </li>
        }
      </ul>
    }
  `,
})
export class MoveNotes {
  readonly rows = input.required<MoveRow[]>();

  protected readonly i18n = inject(I18n);

  protected typeClass(row: MoveRow): string {
    return TYPE_CLASSES[row.info?.type ?? 'Normal'] ?? 'bg-slate-500';
  }

  /** Por qué no le afecta, en el idioma elegido y con los nombres traducidos. */
  protected reason(blocked: BlockReason | undefined): string {
    if (!blocked) return '';
    const { t, ability, item, type } = this.i18n;
    switch (blocked.code) {
      case 'blockedByAbility':
      case 'immuneByAbility':
        return t(`block.${blocked.code}`, { ability: ability(blocked.ability) });
      case 'pranksterDark':
        return t('block.pranksterDark', { ability: ability('Prankster'), type: type('Dark') });
      case 'magicBounce':
        return t('block.magicBounce', { ability: ability('Magic Bounce') });
      case 'airBalloon':
        return t('block.airBalloon', { item: item('Air Balloon') });
      case 'statusType':
        return t('block.statusType', { type: type(blocked.type) });
      default:
        return t(`block.${blocked.code}`);
    }
  }
}

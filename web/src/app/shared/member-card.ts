import { Component, computed, inject, input } from '@angular/core';

import { SP_PER_STAT, STAT_IDS, getMove } from '../../engine/champions';
import type { TeamMember } from '../../engine/pokepaste';
import { I18n } from '../i18n/i18n.service';
import { TYPE_CLASSES } from './format';
import { ItemIcon } from './item-icon';
import { Sprite } from './sprite';

/** Ficha de un Pokémon de tu equipo tal y como se ha interpretado el Pokepaste. */
@Component({
  selector: 'app-member-card',
  imports: [ItemIcon, Sprite],
  template: `
    <article class="flex h-full flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
      <header class="flex items-center gap-3">
        <app-sprite [species]="member().species" [size]="56" />
        <div class="min-w-0">
          <h3 class="truncate font-semibold text-slate-100">
            {{ member().nickname ?? member().species }}
            @if (member().nickname) {
              <span class="font-normal text-slate-400">({{ member().species }})</span>
            }
          </h3>
          <p class="flex items-center gap-1 text-sm text-slate-300">
            <app-item-icon [item]="member().item" />
            <span class="truncate">{{
              member().item ? i18n.item(member().item!) : i18n.t('common.noItem')
            }}</span>
          </p>
          <p class="truncate text-sm text-slate-400">
            {{ member().ability ? i18n.ability(member().ability!) : i18n.t('card.defaultAbility') }}
            ·
            {{ member().nature ? i18n.nature(member().nature!) : i18n.t('card.noNature') }}
          </p>
        </div>
      </header>

      <dl class="grid grid-cols-6 gap-1 text-center text-xs">
        @for (stat of stats; track stat) {
          <div>
            <dt class="text-slate-400">{{ i18n.stat(stat) }}</dt>
            <dd class="font-mono text-slate-200">{{ member().sps[stat] }}</dd>
            <div class="mt-1 h-1 rounded bg-slate-800">
              <div
                class="h-1 rounded bg-emerald-400/80"
                [style.width.%]="(member().sps[stat] / maxSp) * 100"
              ></div>
            </div>
          </div>
        }
      </dl>

      <ul class="grid grid-cols-2 gap-1 text-sm">
        @for (move of moves(); track move.name) {
          <li class="flex items-center gap-1.5 truncate">
            <span
              class="h-2 w-2 shrink-0 rounded-full ring-1 ring-white/25 {{ typeClass(move.type) }}"
            ></span>
            <span class="truncate text-slate-200">{{ i18n.move(move.name) }}</span>
          </li>
        }
      </ul>
    </article>
  `,
})
export class MemberCard {
  readonly member = input.required<TeamMember>();

  protected readonly stats = STAT_IDS;
  protected readonly i18n = inject(I18n);
  protected readonly maxSp = SP_PER_STAT;
  protected readonly moves = computed(() =>
    this.member().moves.map((name) => ({ name, type: getMove(name)?.type ?? 'Normal' })),
  );

  protected typeClass(type: string): string {
    return TYPE_CLASSES[type] ?? 'bg-slate-500';
  }
}

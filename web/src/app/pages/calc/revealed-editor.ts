import { Component, computed, inject, input, output } from '@angular/core';

import { GEN } from '../../../engine/champions';
import type { Revealed, SetInference } from '../../../engine/inference';
import type { DecodedSet } from '../../../engine/metagame';
import { type DataKind, I18n } from '../../i18n/i18n.service';
import type { MessageKey } from '../../i18n/messages';
import { pct } from '../../shared/format';
import { ItemIcon } from '../../shared/item-icon';

const ALL_MOVES: string[] = [...GEN.moves].map((m) => m.name).sort();
const ALL_ITEMS: string[] = [...GEN.items].map((i) => i.name).sort();

interface Option {
  name: string;
  /** Probabilidad según la inferencia (si la hay). */
  share?: number;
  seen: boolean;
}

/**
 * "Lo que has visto": tocar un movimiento, objeto o habilidad lo marca como revelado y la
 * inferencia se queda solo con los sets que encajan.
 */
@Component({
  selector: 'app-revealed-editor',
  imports: [ItemIcon],
  template: `
    <div class="flex flex-col gap-2.5">
      <h4 class="text-sm font-semibold text-slate-200">
        {{ i18n.t('rev.title') }}
        @if (hasRevealed()) {
          <button
            type="button"
            class="ml-2 text-xs font-normal text-slate-400 hover:text-rose-300"
            (click)="changed.emit({})"
          >
            {{ i18n.t('rev.clear') }}
          </button>
        }
      </h4>
      @for (group of groups(); track group.kind) {
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="w-20 text-xs text-slate-400">{{ i18n.t(group.label) }}</span>
          @for (o of group.options; track o.name) {
            <button
              type="button"
              [attr.aria-pressed]="o.seen"
              (click)="group.toggle(o.name)"
              class="rounded-lg px-2 py-0.5 text-xs ring-1"
              [class]="
                o.seen
                  ? 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/60'
                  : 'text-slate-400 ring-slate-700 hover:text-slate-200'
              "
            >
              @if (group.kind === 'items') {
                <app-item-icon [item]="o.name" class="-my-1 align-middle" />
              }
              {{ o.seen ? '✓ ' : '' }}{{ i18n.name(group.kind, o.name) }}
              @if (o.share !== undefined && !o.seen) {
                <span class="ml-0.5 text-slate-400">{{ pct(o.share) }}</span>
              }
            </button>
          }
        </div>
      }
      <label class="flex items-center gap-2">
        <span class="w-20 text-xs text-slate-400">{{ i18n.t('rev.other') }}</span>
        <input
          #other
          type="text"
          list="revealed-options"
          [placeholder]="i18n.t('rev.otherPlaceholder')"
          (change)="addOther(other.value); other.value = ''"
          class="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs focus:border-amber-400 focus:outline-none"
        />
      </label>
      <datalist id="revealed-options">
        @for (name of otherOptions(); track name) {
          <option [value]="name"></option>
        }
      </datalist>
      @if (mismatch()) {
        <p class="text-xs text-amber-300">{{ i18n.t('rev.mismatch') }}</p>
      }
    </div>
  `,
})
export class RevealedEditor {
  readonly inference = input<SetInference | null>(null);
  readonly rivalSet = input.required<DecodedSet>();
  readonly revealed = input.required<Revealed>();
  readonly changed = output<Revealed>();

  protected readonly i18n = inject(I18n);
  protected readonly pct = pct;
  /** Sugerencias para "Otro", en el idioma elegido. */
  protected readonly otherOptions = computed(() => [
    ...ALL_MOVES.map(this.i18n.move),
    ...ALL_ITEMS.map(this.i18n.item),
  ]);

  protected readonly hasRevealed = computed(() => {
    const r = this.revealed();
    return !!(r.item || r.ability || r.moves?.length);
  });
  protected readonly mismatch = computed(() => !!this.inference()?.revealedMismatch);

  protected readonly groups = computed(() => {
    const inf = this.inference();
    const set = this.rivalSet();
    const r = this.revealed();
    const seenMoves = r.moves ?? [];
    const groups: {
      kind: DataKind;
      label: MessageKey;
      options: Option[];
      toggle: (name: string) => void;
    }[] = [
      {
        kind: 'moves',
        label: 'set.moves',
        options: options([...seenMoves, ...set.moves], inf?.moves.slice(0, 10), (m) =>
          seenMoves.includes(m),
        ),
        toggle: (move) =>
          this.changed.emit({
            ...r,
            moves: seenMoves.includes(move)
              ? seenMoves.filter((m) => m !== move)
              : [...seenMoves, move],
          }),
      },
      {
        kind: 'items',
        label: 'set.item',
        options: options([r.item, set.item], inf?.items.slice(0, 5), (i) => i === r.item),
        toggle: (item) => this.changed.emit({ ...r, item: r.item === item ? undefined : item }),
      },
      {
        kind: 'abilities',
        label: 'set.ability',
        options: options([r.ability, set.ability], inf?.abilities, (a) => a === r.ability),
        toggle: (ability) =>
          this.changed.emit({ ...r, ability: r.ability === ability ? undefined : ability }),
      },
    ];
    return groups.filter((g) => g.options.length);
  });

  /** Lo escrito en "Otro", en el idioma elegido o en inglés. */
  protected addOther(text: string): void {
    const r = this.revealed();
    const moves = r.moves ?? [];
    const move = this.i18n.english('moves', text);
    const item = this.i18n.english('items', text);
    if (ALL_MOVES.includes(move) && !moves.includes(move)) {
      this.changed.emit({ ...r, moves: [...moves, move] });
    } else if (ALL_ITEMS.includes(item)) {
      this.changed.emit({ ...r, item });
    }
  }
}

/** Opciones a mostrar: lo ya visto y lo del set actual primero, luego lo más probable. */
function options(
  first: (string | undefined)[],
  shares: [string, number][] | undefined,
  seen: (name: string) => boolean,
): Option[] {
  const shareOf = new Map(shares ?? []);
  const names = [...first, ...(shares ?? []).map(([n]) => n)].filter((n): n is string => !!n);
  return [...new Set(names)].map((name) => ({ name, share: shareOf.get(name), seen: seen(name) }));
}

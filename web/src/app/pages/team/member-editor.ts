import { Component, computed, inject, input, output } from '@angular/core';

import {
  GEN,
  SP_PER_STAT,
  SP_TOTAL,
  STAT_IDS,
  type StatId,
  getItem,
  getMove,
  statTotal,
} from '../../../engine/champions';
import type { TeamMember } from '../../../engine/pokepaste';
import { MetagameService } from '../../data/metagame.service';
import { I18n } from '../../i18n/i18n.service';
import { ItemIcon } from '../../shared/item-icon';
import { Sprite } from '../../shared/sprite';

const MOVE_SLOTS = [0, 1, 2, 3];

const NATURES = [...GEN.natures];

/**
 * Editor de un Pokémon del equipo: objeto, habilidad, naturaleza, Stat Points y movimientos.
 * Cada cambio se emite entero y la página lo escribe en el paste, que sigue siendo la fuente.
 * Objetos y movimientos sugieren primero lo que lleva esa especie en torneos.
 */
@Component({
  selector: 'app-member-editor',
  imports: [ItemIcon, Sprite],
  template: `
    <article
      class="flex h-full flex-col gap-3 rounded-xl border border-amber-400/50 bg-slate-900 p-3"
      [attr.aria-label]="i18n.t('team.editAria', { name: member().species })"
    >
      <header class="flex items-center gap-3">
        <app-sprite [species]="member().species" [size]="48" />
        <h3 class="min-w-0 flex-1 truncate font-semibold text-slate-100">
          {{ member().species }}
        </h3>
        <button
          type="button"
          class="h-8 rounded-lg px-2.5 text-xs text-slate-400 ring-1 ring-slate-700 hover:text-rose-300"
          (click)="removed.emit()"
        >
          {{ i18n.t('common.remove') }}
        </button>
        <button
          type="button"
          class="h-8 rounded-lg bg-amber-400 px-3 text-xs font-semibold text-slate-950 hover:bg-amber-300"
          (click)="done.emit()"
        >
          {{ i18n.t('edit.done') }}
        </button>
      </header>

      <div class="grid grid-cols-2 gap-2 text-sm">
        <label class="col-span-2 flex flex-col gap-1">
          <span class="text-xs text-slate-400">{{ i18n.t('edit.item') }}</span>
          <span class="flex items-center gap-1.5">
            <app-item-icon [item]="member().item" />
            <input
              type="text"
              autocomplete="off"
              spellcheck="false"
              [placeholder]="i18n.t('common.noItem')"
              [attr.list]="id() + '-items'"
              [value]="member().item ? i18n.item(member().item!) : ''"
              (change)="setItem($any($event.target))"
              class="h-9 min-w-0 flex-1 rounded-lg bg-slate-950 px-2 ring-1 ring-slate-700 focus:ring-amber-400 focus:outline-none"
            />
          </span>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-slate-400">{{ i18n.t('edit.ability') }}</span>
          <select
            class="h-9 rounded-lg bg-slate-950 px-2 ring-1 ring-slate-700 focus:ring-amber-400 focus:outline-none"
            (change)="patch({ ability: $any($event.target).value || undefined })"
          >
            @for (ability of abilities(); track ability) {
              <option [value]="ability" [selected]="ability === member().ability">
                {{ i18n.ability(ability) }}
              </option>
            }
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-xs text-slate-400">{{ i18n.t('edit.nature') }}</span>
          <select
            class="h-9 rounded-lg bg-slate-950 px-2 ring-1 ring-slate-700 focus:ring-amber-400 focus:outline-none"
            (change)="patch({ nature: $any($event.target).value || undefined })"
          >
            <option value="" [selected]="!member().nature">{{ i18n.t('card.noNature') }}</option>
            @for (nature of natures(); track nature.name) {
              <option [value]="nature.name" [selected]="nature.name === member().nature">
                {{ nature.label }}
              </option>
            }
          </select>
        </label>
      </div>

      <fieldset class="flex flex-col gap-1.5">
        <legend class="flex w-full justify-between text-xs text-slate-400">
          <span>{{ i18n.t('edit.sp') }}</span>
          <span [class]="total() === maxTotal ? 'text-emerald-300' : 'text-slate-300'"
            >{{ total() }} / {{ maxTotal }}</span
          >
        </legend>
        <div class="grid grid-cols-6 gap-1.5 text-center">
          @for (stat of stats; track stat) {
            <label class="flex flex-col gap-1">
              <span class="text-xs text-slate-400">{{ i18n.stat(stat) }}</span>
              <input
                type="number"
                inputmode="numeric"
                min="0"
                [max]="maxPerStat"
                [value]="member().sps[stat]"
                (change)="setSp(stat, $any($event.target))"
                class="h-9 w-full rounded-lg bg-slate-950 text-center font-mono ring-1 ring-slate-700 [appearance:textfield] focus:ring-amber-400 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </label>
          }
        </div>
      </fieldset>

      <fieldset class="grid grid-cols-2 gap-1.5">
        <legend class="mb-1 text-xs text-slate-400">{{ i18n.t('edit.moves') }}</legend>
        @for (slot of moveSlots; track slot) {
          <input
            type="text"
            autocomplete="off"
            spellcheck="false"
            [attr.aria-label]="i18n.t('edit.move', { n: slot + 1 })"
            placeholder="—"
            [attr.list]="id() + '-moves'"
            [value]="member().moves[slot] ? i18n.move(member().moves[slot]) : ''"
            (change)="setMove(slot, $any($event.target))"
            class="h-9 min-w-0 rounded-lg bg-slate-950 px-2 text-sm ring-1 ring-slate-700 focus:ring-amber-400 focus:outline-none"
          />
        }
      </fieldset>

      <datalist [id]="id() + '-items'">
        @for (item of itemOptions(); track item) {
          <option [value]="item"></option>
        }
      </datalist>
      <datalist [id]="id() + '-moves'">
        @for (move of moveOptions(); track move) {
          <option [value]="move"></option>
        }
      </datalist>
    </article>
  `,
})
export class MemberEditor {
  readonly member = input.required<TeamMember>();
  readonly changed = output<TeamMember>();
  readonly removed = output();
  readonly done = output();

  private readonly data = inject(MetagameService);
  protected readonly i18n = inject(I18n);

  protected readonly stats = STAT_IDS;
  /** Las 25 naturalezas con lo que suben y bajan ("Timid (+Spe −Atk)"), por orden alfabético. */
  protected readonly natures = computed(() =>
    NATURES.map((n) => {
      const name = this.i18n.nature(n.name);
      const changes =
        n.plus && n.minus && n.plus !== n.minus
          ? `+${this.i18n.stat(n.plus as StatId)} −${this.i18n.stat(n.minus as StatId)}`
          : this.i18n.t('edit.neutral');
      return { name: n.name, label: `${name} (${changes})` };
    }).sort((a, b) => a.label.localeCompare(b.label)),
  );
  protected readonly moveSlots = MOVE_SLOTS;
  protected readonly maxPerStat = SP_PER_STAT;
  protected readonly maxTotal = SP_TOTAL;

  protected readonly id = computed(() => `edit-${this.member().species.replace(/\W/g, '')}`);
  protected readonly total = computed(() => statTotal(this.member().sps));

  protected readonly abilities = computed(() => {
    const abilities = this.data.abilitiesFor(this.member().species);
    const current = this.member().ability;
    return current && !abilities.includes(current) ? [current, ...abilities] : abilities;
  });

  /** Lo que lleva esta especie en torneos primero; luego el resto de lo legal. */
  private usageFirst(shares: [string, number][] | undefined, all: string[]): string[] {
    const common = (shares ?? []).map(([name]) => name);
    return [...common, ...all.filter((name) => !common.includes(name))];
  }
  protected readonly itemOptions = computed(() =>
    this.usageFirst(
      this.data.metagame()?.usage.get(this.member().species)?.items,
      this.data.itemOptions(),
    ).map(this.i18n.item),
  );
  protected readonly moveOptions = computed(() =>
    this.usageFirst(
      this.data.metagame()?.usage.get(this.member().species)?.moves,
      this.data.moveOptions(),
    ).map(this.i18n.move),
  );

  protected patch(change: Partial<TeamMember>): void {
    this.changed.emit({ ...this.member(), ...change });
  }

  /** Un objeto que no existe no se guarda: el campo vuelve al que había. */
  protected setItem(field: HTMLInputElement): void {
    const text = field.value.trim();
    if (!text) return this.patch({ item: undefined });
    const item = getItem(this.i18n.english('items', text))?.name;
    if (item) this.patch({ item });
    else field.value = this.member().item ? this.i18n.item(this.member().item!) : '';
  }

  /** Entre 0 y 32, y sin pasarse de 66 en total: lo que sobre se recorta de este stat. */
  protected setSp(stat: StatId, field: HTMLInputElement): void {
    const sps = this.member().sps;
    const others = statTotal(sps) - sps[stat];
    const wanted = Math.round(Number(field.value) || 0);
    const value = Math.max(0, Math.min(SP_PER_STAT, SP_TOTAL - others, wanted));
    field.value = String(value);
    if (value !== sps[stat]) this.patch({ sps: { ...sps, [stat]: value } });
  }

  /** Vacío quita el movimiento; uno que no existe se descarta. */
  protected setMove(slot: number, field: HTMLInputElement): void {
    const text = field.value.trim();
    const moves = [...this.member().moves];
    if (!text) {
      moves.splice(slot, 1);
      return this.patch({ moves });
    }
    const move = getMove(this.i18n.english('moves', text))?.name;
    if (!move || (moves.includes(move) && moves[slot] !== move)) {
      field.value = moves[slot] ? this.i18n.move(moves[slot]) : '';
      return;
    }
    if (slot < moves.length) moves[slot] = move;
    else moves.push(move);
    this.patch({ moves });
  }
}

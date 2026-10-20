import {
  Component,
  type ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

import { groupTeams, playerTeams, searchPlayers } from '../../engine/players';
import { CalcState } from '../data/calc-state.service';
import { MetagameService } from '../data/metagame.service';
import { I18n } from '../i18n/i18n.service';
import { Sprite } from './sprite';

const SHOWN_TEAMS = 4;

/**
 * "¿Contra quién juegas?": busca al rival por su usuario de Limitless, enseña sus últimos
 * equipos y permite cargar uno como equipo rival. Mientras esté elegido, la inferencia da
 * prioridad a sus propios sets.
 */
@Component({
  selector: 'app-player-search',
  imports: [Sprite],
  host: { class: 'flex flex-col gap-2' },
  template: `
    @if (state.rivalPlayerName(); as name) {
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-sm font-semibold tracking-wide text-slate-400 uppercase">
          {{ i18n.t('player.rival') }} <span class="text-rose-300 normal-case">{{ name }}</span>
          <span class="ml-1 font-normal text-slate-400 normal-case"
            >&#64;{{ state.rivalPlayerId() }}</span
          >
        </h2>
        <button
          type="button"
          class="text-xs text-slate-400 hover:text-rose-300"
          (click)="state.rivalPlayerId.set(null)"
        >
          {{ i18n.t('common.remove') }}
        </button>
      </div>
      <ul class="flex flex-col gap-1.5">
        @for (t of visibleTeams(); track t.team) {
          <li
            class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-900 p-2 ring-1"
            [class]="isLoaded(t.species) ? 'ring-amber-400/60' : 'ring-slate-800'"
          >
            <div class="flex">
              @for (species of t.species; track species) {
                <app-sprite [species]="species" [size]="32" [title]="species" />
              }
            </div>
            <p class="min-w-0 flex-1 truncate text-xs text-slate-400">
              {{ t.date }} · {{ t.tournament }}
              <span class="text-slate-300">({{ t.record }})</span>
              @if (t.count > 1) {
                <span class="ml-1 text-slate-400">{{
                  i18n.t('player.tournaments', { count: t.count, total: t.total })
                }}</span>
              }
            </p>
            @if (isLoaded(t.species)) {
              <span class="text-xs text-amber-300">{{ i18n.t('player.inUse') }}</span>
            } @else {
              <button
                type="button"
                class="rounded-lg bg-amber-400/15 px-2.5 py-1 text-xs text-amber-200 ring-1 ring-amber-400/50 hover:bg-amber-400/25"
                (click)="state.useRivalTeam(t.species)"
              >
                {{ i18n.t('player.useTeam') }}
              </button>
            }
          </li>
        }
      </ul>
      @if (teams().length > shown) {
        <button
          type="button"
          class="self-start text-xs text-slate-400 hover:text-slate-300"
          (click)="showAll.set(!showAll())"
        >
          {{
            showAll() ? i18n.t('player.showLess') : i18n.t('player.showAll', { n: teams().length })
          }}
        </button>
      }
    } @else {
      <label class="flex flex-col gap-1">
        <span class="text-sm font-semibold tracking-wide text-slate-400 uppercase">
          {{ i18n.t('player.question') }}
        </span>
        <span class="relative block">
          <input
            #box
            type="search"
            autocomplete="off"
            spellcheck="false"
            [placeholder]="i18n.t('player.placeholder')"
            [value]="query()"
            (input)="query.set(box.value)"
            class="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
          />
          @if (results().length) {
            <ul
              class="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl"
            >
              @for (p of results(); track p.index) {
                <li>
                  <button
                    type="button"
                    class="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-slate-800"
                    (click)="choose(p.id)"
                  >
                    <span class="text-slate-100">{{ p.name }}</span>
                    <span class="text-xs text-slate-400">&#64;{{ p.id }}</span>
                    <span class="ml-auto text-xs text-slate-400">
                      {{ p.teams }} {{ i18n.t(p.teams === 1 ? 'player.team' : 'player.teams') }} ·
                      {{ i18n.shortDate(p.lastDate) }}
                    </span>
                  </button>
                </li>
              }
            </ul>
          } @else if (query().length >= 2) {
            <span class="mt-1 block text-xs text-slate-400">
              {{ i18n.t('player.noResults') }}
            </span>
          }
        </span>
      </label>
    }
  `,
})
export class PlayerSearch {
  /** Pone el cursor en el buscador al aparecer (cuando se abre a petición). */
  readonly autofocus = input(false);
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');

  constructor() {
    afterNextRender(() => {
      if (this.autofocus()) this.box()?.nativeElement.focus();
    });
  }

  protected readonly state = inject(CalcState);
  private readonly metagame = inject(MetagameService).metagame;

  protected readonly shown = SHOWN_TEAMS;
  protected readonly i18n = inject(I18n);
  protected readonly query = signal('');
  protected readonly showAll = signal(false);

  protected readonly results = computed(() => {
    const metagame = this.metagame();
    return metagame ? searchPlayers(metagame, this.query()) : [];
  });

  protected readonly teams = computed(() => {
    const metagame = this.metagame();
    const player = this.state.rivalPlayer();
    if (!metagame || player === undefined) return [];
    const record = (w: number, l: number, t: number) => `${w}-${l}${t ? `-${t}` : ''}`;
    return groupTeams(playerTeams(metagame, player)).map(
      ({ latest: t, count, wins, losses, ties }) => ({
        team: t.team,
        count,
        total: record(wins, losses, ties),
        species: t.sets.map((s) => s.species),
        tournament: t.tournament.name,
        date: this.i18n.shortDate(t.tournament.date),
        record: record(t.wins, t.losses, t.ties),
      }),
    );
  });

  protected readonly visibleTeams = computed(() =>
    this.showAll() ? this.teams() : this.teams().slice(0, SHOWN_TEAMS),
  );

  protected isLoaded(species: string[]): boolean {
    const rivals = this.state.rivals();
    return rivals.length === species.length && species.every((s) => rivals.includes(s));
  }

  protected choose(id: string): void {
    this.state.rivalPlayerId.set(id);
    this.query.set('');
    this.showAll.set(false);
  }
}

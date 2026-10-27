import { Component, computed, inject } from '@angular/core';

import { type VersusSpecies, teamRecord } from '../../../engine/team-record';
import { MetagameService } from '../../data/metagame.service';
import { TeamStore } from '../../data/team-store.service';
import { I18n } from '../../i18n/i18n.service';
import { Sprite } from '../../shared/sprite';

/**
 * "Equipos como el tuyo en torneos": su historial contra el meta, los rivales contra los que les
 * ha ido claramente peor o mejor y sus mejores resultados. Descriptivo, y se dice.
 */
@Component({
  selector: 'app-team-record-card',
  imports: [Sprite],
  template: `
    <section
      class="flex flex-col gap-2.5 rounded-xl border border-slate-800 bg-slate-900 p-3"
      aria-labelledby="team-record"
    >
      <h3 id="team-record" class="font-semibold text-slate-100">
        {{ i18n.t('record.title') }}
      </h3>
      @if (record(); as r) {
        <p class="text-sm text-slate-300">
          {{
            i18n.t('record.summary', {
              teams: i18n.number(r.teams),
              shared: r.shared,
              games: i18n.number(r.games),
              pct: i18n.percent(r.winRate),
              margin: i18n.percent(r.margin),
            })
          }}
        </p>

        @for (group of groups(); track group.label) {
          @if (group.rivals.length) {
            <div class="flex flex-col gap-1">
              <h4 class="text-xs font-semibold tracking-wide text-slate-400 uppercase">
                {{ group.label }}
              </h4>
              <ul class="flex flex-wrap gap-1.5">
                @for (v of group.rivals; track v.species) {
                  <li
                    class="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ring-1"
                    [class]="group.tone"
                    [title]="i18n.t('record.versusTitle', { n: i18n.number(v.games) })"
                  >
                    <app-sprite [species]="v.species" [size]="24" />
                    {{ v.species }}
                    <span class="font-mono tabular-nums">{{ i18n.percent(v.winRate) }}</span>
                  </li>
                }
              </ul>
            </div>
          }
        }
        @if (!r.worst.length && !r.best.length) {
          <p class="text-xs text-slate-400">{{ i18n.t('record.noVersus') }}</p>
        }

        @if (r.runs.length) {
          <div class="flex flex-col gap-1">
            <h4 class="text-xs font-semibold tracking-wide text-slate-400 uppercase">
              {{ i18n.t('record.runs') }}
            </h4>
            <ul class="flex flex-col gap-1">
              @for (run of r.runs; track $index) {
                <li class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span class="font-mono font-semibold text-emerald-300 tabular-nums"
                    >{{ run.wins }}-{{ run.losses }}{{ run.ties ? '-' + run.ties : '' }}</span
                  >
                  <span class="min-w-0 truncate text-slate-200">{{ run.tournament }}</span>
                  <span class="text-slate-400">
                    {{ i18n.t('record.players', { n: run.players }) }} ·
                    {{ i18n.shortDate(run.date) }}
                    @if (run.player) {
                      · {{ run.player }}
                    }
                  </span>
                  <span class="flex gap-0.5" [attr.aria-label]="run.species.join(', ')">
                    @for (s of run.species; track s) {
                      <app-sprite [species]="s" [size]="20" />
                    }
                  </span>
                </li>
              }
            </ul>
          </div>
        }

        <p class="text-xs text-slate-400">{{ i18n.t('record.caveat') }}</p>
      } @else {
        <p class="text-sm text-slate-400">{{ i18n.t('record.none') }}</p>
      }
    </section>
  `,
})
export class TeamRecordCard {
  protected readonly i18n = inject(I18n);
  private readonly data = inject(MetagameService);
  private readonly myTeam = inject(TeamStore).activeMembers;

  protected readonly record = computed(() => {
    const metagame = this.data.metagame();
    return (
      metagame &&
      teamRecord(
        metagame,
        this.myTeam().map((m) => m.species),
      )
    );
  });

  protected readonly groups = computed(
    (): { label: string; tone: string; rivals: VersusSpecies[] }[] => {
      const record = this.record();
      if (!record) return [];
      return [
        {
          label: this.i18n.t('record.worst'),
          tone: 'bg-orange-500/10 text-orange-200 ring-orange-500/40',
          rivals: record.worst,
        },
        {
          label: this.i18n.t('record.best'),
          tone: 'bg-emerald-500/10 text-emerald-200 ring-emerald-500/40',
          rivals: record.best,
        },
      ];
    },
  );
}

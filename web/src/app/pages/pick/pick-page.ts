import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import {
  type SpeedState,
  analyzePick,
  duelWin,
  planDuel,
  planWin,
  protectionFor,
  supportRoles,
} from '../../../engine/pick';
import { CalcState } from '../../data/calc-state.service';
import { MetagameService } from '../../data/metagame.service';
import { TeamStore } from '../../data/team-store.service';
import { I18n } from '../../i18n/i18n.service';
import { TONE_CLASSES, type Tone, pct } from '../../shared/format';
import { PlayerSearch } from '../../shared/player-search';
import { RivalTeamPicker } from '../../shared/rival-team-picker';
import { Sprite } from '../../shared/sprite';

type SpeedView = SpeedState | 'average';

@Component({
  selector: 'app-pick-page',
  imports: [PlayerSearch, RivalTeamPicker, RouterLink, Sprite],
  templateUrl: './pick-page.html',
})
export class PickPage {
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly state = inject(CalcState);
  protected readonly data = inject(MetagameService);
  protected readonly myTeam = inject(TeamStore).activeMembers;
  private readonly router = inject(Router);

  protected readonly pct = pct;

  protected readonly analysis = computed(() => {
    const metagame = this.data.metagame();
    const team = this.myTeam();
    const rivals = this.state.rivals();
    if (!metagame || !team.length || !rivals.length) return undefined;
    return analyzePick(metagame, team, rivals, { rivalPlayer: this.state.rivalPlayer() });
  });

  /** Opción elegida entre las recomendadas; vuelve a la mejor si cambian los equipos. */
  protected readonly planIndex = linkedSignal({ source: this.analysis, computation: () => 0 });
  protected readonly plan = computed(() => this.analysis()?.plans[this.planIndex()]);

  /** Cada rival con su mejor respuesta entre los 4 elegidos, los peor cubiertos primero. */
  protected readonly threats = computed(() => {
    const a = this.analysis();
    const plan = this.plan();
    if (!a || !plan) return [];
    return a.rivals
      .map((species, j) => {
        const win = (i: number) => planWin(a, plan, i, j);
        const answer = plan.bring.reduce((best, i) => (win(i) > win(best) ? i : best));
        return {
          species,
          rivalIndex: j,
          coverage: plan.coverage[j],
          answer,
          answerChance: win(answer),
          tone: this.coverageTone(plan.coverage[j]),
        };
      })
      .sort((x, y) => x.coverage - y.coverage);
  });

  /** Situaciones de velocidad que se pueden ver en la matriz: solo las que pueden darse. */
  protected readonly speedViews = computed(() => {
    const a = this.analysis();
    const plan = this.plan();
    if (!a || !plan) return [];
    const { t, move } = this.i18n;
    const views: { value: SpeedView; label: string }[] = [{ value: 'none', label: t('view.none') }];
    if (a.rivalTrickRoom > 0 || plan.trickRoom > 0) {
      views.push({ value: 'trickRoom', label: move('Trick Room') });
    }
    if (plan.tailwind > 0) {
      views.push({ value: 'myTailwind', label: t('view.myTailwind', { move: move('Tailwind') }) });
    }
    if (a.rivalTailwind > 0) {
      views.push({
        value: 'theirTailwind',
        label: t('view.theirTailwind', { move: move('Tailwind') }),
      });
    }
    return views.length > 1
      ? [{ value: 'average' as const, label: t('view.average') }, ...views]
      : [];
  });
  protected readonly speedView = signal<SpeedView>('average');

  /**
   * Los 4 elegidos, con la mega de la opción (quien lleva piedra y no megaevoluciona, en su forma
   * base); los que se quedan fuera, con la suya, para ver lo que aportarían. Por defecto, la media
   * de la partida según lo probable que sea cada situación de velocidad.
   */
  protected readonly matrix = computed(() => {
    const a = this.analysis();
    const plan = this.plan();
    if (!a || !plan) return undefined;
    const views = this.speedViews();
    const view = views.some((v) => v.value === this.speedView()) ? this.speedView() : 'average';
    return a.duels.map((row, i) =>
      row.map((_, j) => {
        const context = plan.bring.includes(i) ? plan : { ...plan, mega: undefined };
        const duel = planDuel(a, context, i, j);
        const winChance =
          view === 'average'
            ? planWin(a, context, i, j)
            : duelWin(duel, view, protectionFor(context, i));
        return { ...duel, winChance };
      }),
    );
  });

  /**
   * Lo que conviene saber de la opción, en una lista: quién megaevoluciona, el control de
   * velocidad y lo que frena los ataques de cada lado. Cada punto lleva el color de su tema.
   */
  protected readonly notes = computed(() => {
    const a = this.analysis();
    const plan = this.plan();
    if (!a || !plan) return [];
    const { t, move } = this.i18n;
    const name = (i: number) => this.myTeam()[i].species;
    const list = (carriers: [string, number][]) =>
      carriers.map(([species, share]) => `${species} ${pct(share)}`).join(', ');
    const notes: { dot: string; text: string }[] = [];

    if (plan.mega !== undefined) {
      const others = plan.bring.filter((i) => a.canMega[i] && i !== plan.mega).map(name);
      const key = !others.length
        ? 'note.mega'
        : others.length > 1
          ? 'note.megaOthers'
          : 'note.megaOther';
      notes.push({
        dot: 'bg-fuchsia-400',
        text: t(key, { name: name(plan.mega), others: this.i18n.list(others) }),
      });
    }

    const tailwind = [
      plan.tailwind > 0 && t('note.tailwindMine'),
      a.rivalTailwindSetters.length &&
        t('note.tailwindTheirs', { list: list(a.rivalTailwindSetters) }),
    ].filter(Boolean);
    if (tailwind.length) {
      // Contra Trick Room, mi Tailwind apenas sirve: conviene que se entienda por qué no abre.
      const againstTrickRoom =
        plan.tailwind > 0 && a.rivalTrickRoom >= 0.5
          ? t('note.tailwindVsTr', { tr: move('Trick Room') })
          : '';
      notes.push({
        dot: 'bg-sky-400',
        text:
          t('note.tailwind', { move: move('Tailwind'), who: tailwind.join('; ') }) +
          againstTrickRoom,
      });
    }

    // Por debajo de esto Trick Room no cambia ninguna decisión: mejor no distraer.
    if (plan.trickRoom >= 0.1) {
      const rival = a.rivalTrickRoom >= 0.5;
      const who =
        plan.setsTrickRoom && rival
          ? t('note.trBoth')
          : plan.setsTrickRoom
            ? t('note.trMine')
            : rival
              ? t('note.trRival')
              : t('note.trMaybe', { pct: pct(a.rivalTrickRoom) });
      notes.push({
        dot: 'bg-violet-400',
        text: t('note.trickRoom', { move: move('Trick Room'), pct: pct(plan.trickRoom), who }),
      });
    }

    // "Su Wide Guard (…) frena tus ataques en área; su redirección (…) desvía los de un objetivo."
    const protection = (side: 'their' | 'my', guard: string, redirect: string) => {
      const guardText =
        guard &&
        t(side === 'their' ? 'note.theirGuard' : 'note.myGuard', {
          move: move('Wide Guard'),
          list: guard,
        });
      const redirectKey = guard
        ? side === 'their'
          ? 'note.theirRedirectAlso'
          : 'note.myRedirectAlso'
        : side === 'their'
          ? 'note.theirRedirect'
          : 'note.myRedirect';
      const redirectText = redirect && t(redirectKey, { list: redirect });
      const parts = [guardText, redirectText].filter(Boolean);
      return parts.length ? parts.join('; ') + '.' : '';
    };
    const theirs = protection('their', list(a.rivalWideGuard), list(a.rivalRedirection));
    if (theirs) notes.push({ dot: 'bg-rose-400', text: theirs });

    const guards = plan.bring.filter((i) => this.myTeam()[i].moves.includes('Wide Guard'));
    const mine = protection(
      'my',
      guards.map(name).join(', '),
      plan.redirectors.map(([i, redirect]) => `${name(i)}, ${move(redirect)}`).join('; '),
    );
    if (mine) notes.push({ dot: 'bg-emerald-400', text: mine });

    // Lo que se da por hecho en todos los cálculos: tiene que verse, no ir en la letra pequeña.
    const field = [
      a.field.weather && t(`fieldNote.${a.field.weather}`),
      a.field.terrain && t(`fieldNote.${a.field.terrain}`),
    ].filter((part): part is string => !!part);
    if (field.length) {
      notes.push({ dot: 'bg-slate-400', text: t('note.field', { field: this.i18n.list(field) }) });
    }

    return notes;
  });

  /** Las claves, abiertas de entrada en escritorio; en el móvil, primero la respuesta. */
  protected readonly notesOpen = signal(
    typeof matchMedia === 'function' && matchMedia('(min-width: 768px)').matches,
  );

  /** Qué cambia cada opción respecto a la recomendada ("Venusaur por Grimmsnarl"). */
  protected readonly optionLabels = computed(() => {
    const plans = this.analysis()?.plans ?? [];
    const [best] = plans;
    const names = (indices: number[], sep = ', ') =>
      indices.map((i) => this.myTeam()[i].species).join(sep);
    const t = this.t;
    return plans.map((plan, i) => {
      if (i === 0) return t('pick.recommended');
      const added = plan.bring.filter((x) => !best.bring.includes(x));
      const removed = best.bring.filter((x) => !plan.bring.includes(x));
      if (added.length) return t('pick.swap', { added: names(added), removed: names(removed) });
      if (plan.leads.some((x) => !best.leads.includes(x))) {
        return t('pick.leadWith', { names: names(plan.leads, ' + ') });
      }
      if (plan.mega !== best.mega && plan.mega !== undefined) {
        return t('pick.megaOption', { name: names([plan.mega]) });
      }
      return t('pick.variant');
    });
  });

  /** El buscador de jugador, plegado hasta que se pide (es opcional). */
  protected readonly searchingPlayer = signal(false);

  /** Lo que aporta además de su daño ("Tailwind · Wide Guard"). */
  protected roles(i: number): string {
    return supportRoles(this.myTeam()[i]).map(this.i18n.any).join(' · ');
  }

  protected coverageTone(value: number): Tone {
    if (value >= 0.7) return 'good';
    if (value >= 0.45) return 'warn';
    return 'bad';
  }

  protected toneClass(value: number): string {
    return TONE_CLASSES[this.coverageTone(value)];
  }

  /**
   * Color de una casilla de la matriz según la probabilidad de ganar el 1 contra 1. El color va
   * sobre todo en el borde y el texto: un relleno naranja semitransparente sobre el fondo azul
   * oscuro se ve marrón.
   */
  protected cellClass(win: number): string {
    if (win >= 0.75)
      return 'bg-emerald-500/20 text-emerald-100 ring-1 ring-inset ring-emerald-400/70';
    if (win >= 0.55)
      return 'bg-emerald-500/5 text-emerald-300 ring-1 ring-inset ring-emerald-400/30';
    if (win > 0.45) return 'bg-slate-800/60 text-slate-300';
    if (win > 0.25) return 'bg-orange-500/5 text-orange-300 ring-1 ring-inset ring-orange-400/30';
    return 'bg-orange-500/10 text-orange-200 ring-1 ring-inset ring-orange-400/70';
  }

  protected openInCalculator(myIndex: number, rivalIndex: number): void {
    this.state.myIndex.set(myIndex);
    this.state.rivalIndex.set(rivalIndex);
    void this.router.navigate(['/calculadora']);
  }
}

import { Component, computed, effect, inject, linkedSignal, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { archetypePaste } from '../../../engine/archetypes';
import type { DamageOdds } from '../../../engine/damage';
import type {
  Archetype,
  ArchetypeSet,
  MetaAnalysisFile,
  Metagame,
  Shares,
  SpeciesMeta,
  SpeciesUsage,
} from '../../../engine/metagame';
import type { TeamMember } from '../../../engine/pokepaste';
import { type Threat, analyzeThreat, byDanger, metaThreats } from '../../../engine/threats';
import { CalcState } from '../../data/calc-state.service';
import { MetagameService } from '../../data/metagame.service';
import { TeamStore } from '../../data/team-store.service';
import { I18n } from '../../i18n/i18n.service';
import type { MessageKey } from '../../i18n/messages';
import { TONE_CLASSES, type Tone, koSummary, pct, winRateTone } from '../../shared/format';
import { Sprite } from '../../shared/sprite';

/** Con menos equipos en alguna de las dos ventanas, la tendencia es ruido y no se enseña. */
const MIN_TREND_TEAMS = 300;
/** Diferencia de uso (en tanto por uno) a partir de la cual se marca que sube o baja. */
const TREND_STEP = 0.01;
const PAGE_SIZE = 30;
/**
 * Al ordenar arquetipos por winrate o por % de top 8 se suman estas partidas o entradas a la
 * media, para que uno con poca muestra y suerte no se ponga el primero.
 */
const WIN_RATE_PRIOR_GAMES = 100;
const TOP_CUT_PRIOR_ENTRIES = 20;

/** Amenazas que se analizan: los más usados del formato que no llevo. */
const THREATS = 20;

type Tab = 'species' | 'cores' | 'teams' | 'team';
type TeamSort = 'usage' | 'winRate' | 'topCuts';

interface ArchetypeView extends Archetype {
  key: string;
  /** Los 6 y sus sets, del más usado del formato al menos usado. */
  ordered: string[];
  orderedSets: ArchetypeSet[];
}

interface Row {
  rank: number;
  usage: SpeciesUsage;
  meta?: SpeciesMeta;
  /** Diferencia de uso entre la última semana y las anteriores (sin datos suficientes, nada). */
  trend?: number;
}

/**
 * Sección Meta: qué se usa, qué sube y qué baja, con qué se lleva cada Pokémon y contra qué le
 * va bien o mal. `meta-analysis.json` solo se descarga al entrar aquí; sin él, se enseña lo que
 * hay en `usage.json` (uso, winrate y sets).
 */
@Component({
  selector: 'app-meta-page',
  imports: [RouterLink, Sprite],
  templateUrl: './meta-page.html',
})
export class MetaPage {
  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly data = inject(MetagameService);
  private readonly state = inject(CalcState);
  private readonly teams = inject(TeamStore);
  private readonly router = inject(Router);
  protected readonly myTeam = this.teams.activeMembers;

  private readonly file = resource({
    params: () => this.data.metagame()?.meta.format,
    loader: async ({ params, abortSignal }): Promise<MetaAnalysisFile> => {
      const response = await fetch(`data/${params}/meta-analysis.json`, { signal: abortSignal });
      if (!response.ok) throw new Error(`meta-analysis.json: HTTP ${response.status}`);
      return response.json() as Promise<MetaAnalysisFile>;
    },
  });
  protected readonly analysis = computed(() =>
    this.file.hasValue() ? this.file.value() : undefined,
  );
  protected readonly unavailable = computed(() => !!this.file.error());

  protected readonly tabs: { value: Tab; label: MessageKey }[] = [
    { value: 'species', label: 'meta.tabSpecies' },
    { value: 'cores', label: 'meta.tabCores' },
    { value: 'teams', label: 'meta.tabTeams' },
    { value: 'team', label: 'meta.tabYourTeam' },
  ];
  protected readonly tab = signal<Tab>('species');
  protected readonly query = signal('');
  /** Cuántas filas se ven; vuelve al principio al cambiar el filtro. */
  protected readonly visible = linkedSignal({ source: this.query, computation: () => PAGE_SIZE });
  protected readonly expanded = signal<string | null>(null);

  protected readonly intro = computed(() => {
    const meta = this.data.metagame()?.meta;
    if (!meta?.firstDate || !meta.lastDate) return undefined;
    return this.t('meta.intro', {
      teams: this.i18n.number(meta.teams),
      tournaments: meta.tournaments,
      from: this.i18n.shortDate(meta.firstDate),
      to: this.i18n.shortDate(meta.lastDate),
    });
  });

  /** Todas las especies, de más a menos usada (`usage.json` ya viene en ese orden). */
  private readonly rows = computed<Row[]>(() => {
    const usage = this.data.metagame()?.usage;
    if (!usage) return [];
    const analysis = this.analysis();
    const bySpecies = new Map(analysis?.species.map((s) => [s.species, s]));
    const withTrend =
      !!analysis &&
      analysis.recentTeams >= MIN_TREND_TEAMS &&
      analysis.baselineTeams >= MIN_TREND_TEAMS;
    return [...usage.values()].map((u, i) => {
      const meta = bySpecies.get(u.species);
      return {
        rank: i + 1,
        usage: u,
        meta,
        trend: withTrend && meta ? meta.recent - meta.baseline : undefined,
      };
    });
  });

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    return q ? this.rows().filter((r) => r.usage.species.toLowerCase().includes(q)) : this.rows();
  });
  protected readonly shown = computed(() => this.filtered().slice(0, this.visible()));

  protected readonly coreGroups = computed(() => {
    const analysis = this.analysis();
    if (!analysis) return [];
    return [
      { label: this.t('meta.pairs'), cores: analysis.pairs },
      { label: this.t('meta.trios'), cores: analysis.trios },
    ];
  });

  protected readonly teamSorts: { value: TeamSort; label: MessageKey }[] = [
    { value: 'usage', label: 'meta.sortUsage' },
    { value: 'winRate', label: 'meta.sortWinRate' },
    { value: 'topCuts', label: 'meta.sortTopCuts' },
  ];
  protected readonly teamSort = signal<TeamSort>('usage');
  protected readonly expandedTeam = signal<string | null>(null);
  /** Lo último que se ha hecho con un arquetipo, para confirmarlo junto a sus botones. */
  protected readonly done = signal<{
    key: string;
    action: 'saved' | 'rival';
    name?: string;
  } | null>(null);

  protected readonly archetypes = computed<ArchetypeView[]>(() => {
    const list = this.analysis()?.archetypes ?? [];
    const rank = new Map([...(this.data.metagame()?.usage.keys() ?? [])].map((s, i) => [s, i]));
    const byUsage = (a: string, b: string) => (rank.get(a) ?? 999) - (rank.get(b) ?? 999);
    const views = list.map((a) => ({
      ...a,
      key: a.species.join('/'),
      ordered: [...a.species].sort(byUsage),
      orderedSets: [...a.sets].sort((x, y) => byUsage(x.species, y.species)),
    }));
    switch (this.teamSort()) {
      case 'usage':
        return views; // `meta-analysis.json` ya los trae de más a menos llevados.
      case 'winRate': {
        const score = (a: Archetype) =>
          ((a.winRate ?? 0.5) * a.games + 0.5 * WIN_RATE_PRIOR_GAMES) /
          (a.games + WIN_RATE_PRIOR_GAMES);
        return views.sort((a, b) => score(b) - score(a));
      }
      case 'topCuts': {
        const entries = list.reduce((n, a) => n + a.largeEntries, 0);
        const base = entries ? list.reduce((n, a) => n + a.topCuts, 0) / entries : 0;
        const score = (a: Archetype) =>
          (a.topCuts + base * TOP_CUT_PRIOR_ENTRIES) / (a.largeEntries + TOP_CUT_PRIOR_ENTRIES);
        return views.sort((a, b) => score(b) - score(a));
      }
    }
  });

  /** Amenazas ya calculadas y cuántas hay en total (se calculan de una en una, ver abajo). */
  protected readonly threats = signal<Threat[]>([]);
  protected readonly threatsTotal = signal(0);
  protected readonly threatsReady = computed(
    () => this.threatsTotal() > 0 && this.threats().length === this.threatsTotal(),
  );
  protected readonly sortedThreats = computed(() => [...this.threats()].sort(byDanger));
  protected readonly expandedThreat = signal<string | null>(null);
  protected readonly threatCount = THREATS;
  /** Equipo y datos de los que salen las amenazas calculadas (para no repetir el cálculo). */
  private threatsFor?: { team: readonly TeamMember[]; data: Metagame };
  private threatsRun = 0;

  constructor() {
    // Solo al abrir la pestaña, y otra vez si cambia el equipo o los datos.
    effect(() => {
      const metagame = this.data.metagame();
      const team = this.myTeam();
      if (this.tab() !== 'team' || !metagame || !team.length) return;
      if (this.threatsFor?.team === team && this.threatsFor.data === metagame) return;
      this.threatsFor = { team, data: metagame };
      void this.computeThreats(metagame, team);
    });
  }

  /**
   * Unas 20 amenazas pueden tardar un par de segundos en un móvil: se calculan de una en una,
   * dejando respirar a la página entre medias. Si empieza otro cálculo, este se abandona.
   */
  private async computeThreats(metagame: Metagame, team: readonly TeamMember[]): Promise<void> {
    const run = ++this.threatsRun;
    const species = metaThreats(metagame, team, THREATS);
    this.threats.set([]);
    this.threatsTotal.set(species.length);
    for (const s of species) {
      await new Promise((resolve) => setTimeout(resolve));
      if (run !== this.threatsRun) return;
      const threat = analyzeThreat(metagame, team, s);
      this.threats.update((list) => [...list, threat]);
    }
  }

  protected toggleThreat(species: string): void {
    this.expandedThreat.update((current) => (current === species ? null : species));
  }

  /** "Garchomp · Terremoto 62–74%". */
  protected hitLabel(key: 'meta.answer' | 'meta.noAnswer', threat: Threat): string {
    const duel = threat.answer;
    if (!duel?.mine) return this.t('meta.noDamage');
    return this.t(key, {
      member: this.myTeam()[duel.member]?.species ?? '',
      move: this.i18n.move(duel.mine.move),
      range: this.range(duel.mine.odds),
    });
  }

  protected range(odds: DamageOdds): string {
    const { minPercent, maxPercent } = odds.likely;
    return `${Math.round(minPercent)}–${Math.round(maxPercent)}%`;
  }

  /** Cuántos golpes: el mismo resumen que en la calculadora. */
  protected ko(odds: DamageOdds, attacking: boolean): { label: string; tone: Tone } {
    return koSummary(odds, attacking, this.t);
  }

  protected toneClass(tone: Tone): string {
    return TONE_CLASSES[tone];
  }

  protected firstLabel(first: number): string {
    return this.t('meta.youFirst', { pct: pct(first) });
  }

  /** Abre el duelo en la calculadora; si la amenaza no está en el equipo rival, la añade. */
  protected openThreat(species: string, member: number): void {
    if (!this.state.rivalTeam().includes(species)) this.addRival(species);
    const rivalIndex = this.state.rivals().indexOf(species);
    if (rivalIndex < 0) return;
    this.state.myIndex.set(member);
    this.state.rivalIndex.set(rivalIndex);
    void this.router.navigate(['/calculadora']);
  }

  protected toggleTeam(key: string): void {
    this.expandedTeam.update((current) => (current === key ? null : key));
  }

  /** Guarda el arquetipo como un equipo nuevo en "Mi equipo" (y lo deja como activo). */
  protected useTeam(archetype: ArchetypeView): void {
    const metagame = this.data.metagame();
    if (!metagame) return;
    const name = archetype.ordered.slice(0, 3).join(' · ');
    this.teams.save(name, archetypePaste(metagame, archetype.orderedSets));
    this.done.set({ key: archetype.key, action: 'saved', name });
  }

  protected loadRival(archetype: ArchetypeView): void {
    this.state.useRivalTeam(archetype.ordered);
    this.done.set({ key: archetype.key, action: 'rival' });
  }

  /** "Intimidación · Cauta". */
  protected setDetails(set: ArchetypeSet): string {
    const parts = [
      set.ability && this.i18n.ability(set.ability),
      set.nature && this.i18n.nature(set.nature),
    ];
    return parts.filter((p) => !!p).join(' · ');
  }

  protected setMoves(set: ArchetypeSet): string {
    return set.moves.map(this.i18n.move).join(' / ');
  }

  protected toggle(species: string): void {
    this.expanded.update((current) => (current === species ? null : species));
  }

  protected showMore(): void {
    this.visible.update((n) => n + PAGE_SIZE);
  }

  /** Sets más comunes de la especie: lo más usado de cada cosa, ya traducido. */
  protected setGroups(usage: SpeciesUsage): { label: string; entries: [string, string][] }[] {
    return [
      { label: this.t('meta.items'), entries: this.top(usage.items, 5, this.i18n.item) },
      { label: this.t('meta.abilities'), entries: this.top(usage.abilities, 3, this.i18n.ability) },
      { label: this.t('meta.natures'), entries: this.top(usage.natures, 4, this.i18n.nature) },
      { label: this.t('meta.moves'), entries: this.top(usage.moves, 8, this.i18n.move) },
    ];
  }

  protected trendLabel(trend: number): string {
    const points = (trend * 100).toLocaleString(this.i18n.locale(), {
      maximumFractionDigits: 1,
      signDisplay: 'exceptZero',
    });
    return Math.abs(trend) < TREND_STEP ? '=' : `${trend > 0 ? '▲' : '▼'} ${points}`;
  }

  protected trendClass(trend: number): string {
    if (Math.abs(trend) < TREND_STEP) return 'text-slate-500';
    return trend > 0 ? 'text-emerald-300' : 'text-orange-300';
  }

  protected trendTitle(meta: SpeciesMeta): string {
    const analysis = this.analysis();
    return this.t('meta.trendTitle', {
      from: this.i18n.percent(meta.baseline),
      to: this.i18n.percent(meta.recent),
      days: analysis?.trendDays ?? 0,
      baseline: analysis?.baselineDays ?? 0,
    });
  }

  /** Verde o naranja solo si se aleja del 50% con claridad (ver `winRateTone`). */
  protected winRateClass(winRate: number | null, games: number): string {
    return TONE_CLASSES[winRateTone(winRate, games)];
  }

  protected gamesTitle(games: number): string {
    return this.t('meta.games', { n: this.i18n.number(games) });
  }

  /** Los `n` primeros de un reparto, con el nombre en el idioma de la interfaz. */
  protected top(shares: Shares, n: number, name: (s: string) => string): [string, string][] {
    return shares.slice(0, n).map(([s, share]) => [name(s), this.i18n.percent(share)]);
  }

  protected rivalStatus(species: string): 'in' | 'full' | 'free' {
    const team = this.state.rivalTeam();
    if (team.includes(species)) return 'in';
    return team.includes(null) ? 'free' : 'full';
  }

  protected addRival(species: string): void {
    const slot = this.state.rivalTeam().indexOf(null);
    if (slot >= 0) this.state.setRival(slot, species);
  }
}

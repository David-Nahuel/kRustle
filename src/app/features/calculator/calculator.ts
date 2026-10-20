import { CommonModule, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Field, Generations, Move, Pokemon, Side, calculate } from '@smogon/calc';

import type { SideKey, ScreenKey, StatsTable, StatPoints, SideScreens, ThreatLevel } from '../../core/models/calculator.types';
import type { PokemonSet, EditTarget, PokemonDexEntry, MoveDexEntry, ItemDexEntry, AbilityDexEntry } from '../../core/models/pokemon.models';
import type { DamageRow } from '../../core/models/damage.models';

import { CalculatorSessionService } from '../../core/services/calculator-session.service';

@Component({
  selector: 'app-calculator',
  standalone: true,
  imports: [CommonModule, NgTemplateOutlet],
  templateUrl: './calculator.html',
})
export class Calculator {
  private readonly calculatorSessionService = inject(CalculatorSessionService);

  gen = Generations.get(9);

  private readonly PERFECT_IVS = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
  private readonly SP_TO_EV = 8;
  readonly MAX_SP_PER_STAT = 32;
  readonly TOTAL_SP = 66;

  natures = [
    'Hardy','Lonely','Brave','Adamant','Naughty',
    'Bold','Docile','Relaxed','Impish','Lax',
    'Timid','Hasty','Serious','Jolly','Naive',
    'Modest','Mild','Quiet','Bashful','Rash',
    'Calm','Gentle','Sassy','Careful','Quirky',
  ];

  spStats: { key: keyof StatPoints; label: string }[] = [
    { key: 'hp',  label: 'HP'  },
    { key: 'atk', label: 'Atk' },
    { key: 'def', label: 'Def' },
    { key: 'spa', label: 'SpA' },
    { key: 'spd', label: 'SpD' },
    { key: 'spe', label: 'Spe' },
  ];

  // ─── Dex local ───────────────────────────────────────────────
  movesDex = signal<MoveDexEntry[]>([]);
  itemsDex = signal<ItemDexEntry[]>([]);
  abilitiesDex = signal<AbilityDexEntry[]>([]);
  pokemonDex = signal<PokemonDexEntry[]>([]);

  movesByName = computed(() => {
    const map = new Map<string, MoveDexEntry>();
    for (const move of this.movesDex()) map.set(move.name, move);
    return map;
  });

  pokemonByName = computed(() => {
    const map = new Map<string, PokemonDexEntry>();
    for (const p of this.pokemonDex()) map.set(p.name, p);
    return map;
  });

  // ─── Equipos ─────────────────────────────────────────────────
  myTeam = signal<PokemonSet[]>([]);
  enemyTeam = signal<PokemonSet[]>([]);

  // ─── Selección ───────────────────────────────────────────────
  selectedAttacker = signal<PokemonSet | null>(null);
  selectedDefender = signal<PokemonSet | null>(null);

  weather = signal<string | undefined>(undefined);
  terrain = signal<string | undefined>(undefined);

  // ─── Pantallas/screens por lado ──────────────────────────────
  readonly mySideScreens = signal<SideScreens>({
    auroraVeil: false,
    lightScreen: false,
    reflect: false,
  });

  readonly enemySideScreens = signal<SideScreens>({
    auroraVeil: false,
    lightScreen: false,
    reflect: false,
  });

  // ─── Modal ───────────────────────────────────────────────────
  editTarget = signal<EditTarget | null>(null);
  private editDraft = signal<PokemonSet | null>(null);

  // ─── Computed ────────────────────────────────────────────────
  attacker = computed(() => this.selectedAttacker());
  defender = computed(() => this.selectedDefender());

  damageRows = computed<DamageRow[]>(() => {
    const a = this.attacker(), d = this.defender();
    if (!a || !d) return [];
    return this.calcRows(a, d, 'attacker');
  });

  reverseDamageRows = computed<DamageRow[]>(() => {
    const a = this.defender(), d = this.attacker();
    if (!a || !d) return [];
    return this.calcRows(a, d, 'defender');
  });

  sortedDamageRows = computed(() =>
    [...this.damageRows()].sort((a, b) =>
      Math.max(...(b.damage.length ? b.damage : [0])) -
      Math.max(...(a.damage.length ? a.damage : [0]))
    )
  );

  sortedReverseDamageRows = computed(() =>
    [...this.reverseDamageRows()].sort((a, b) =>
      Math.max(...(b.damage.length ? b.damage : [0])) -
      Math.max(...(a.damage.length ? a.damage : [0]))
    )
  );

  constructor() {
    this.loadInitialTeams();
    this.loadDexData();
  }

  private loadInitialTeams(): void {
    const session = this.calculatorSessionService.getSession();

    if (session?.allyTeam?.length && session?.enemyTeam?.length) {
      this.myTeam.set(session.allyTeam);
      this.enemyTeam.set(session.enemyTeam);
    } else {
      this.myTeam.set(this.getDefaultMyTeam());
      this.enemyTeam.set(this.getDefaultEnemyTeam());
    }

    this.selectedAttacker.set(this.myTeam()[0] ?? null);
    this.selectedDefender.set(this.enemyTeam()[0] ?? null);
  }

  private getDefaultMyTeam(): PokemonSet[] {
    return [
      {
        name: 'Venusaur',
        level: 50,
        types: ['Grass', 'Poison'],
        ability: 'Overgrow',
        item: 'Life Orb',
        nature: 'Modest',
        sp: { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 },
        moves: ['Sludge Bomb', 'Giga Drain', 'Earth Power', 'Protect'],
      },
      // ...
    ];
  }

  private getDefaultEnemyTeam(): PokemonSet[] {
    return [
      {
        name: 'Charizard',
        level: 50,
        types: ['Fire', 'Flying'],
        ability: 'Blaze',
        item: 'Choice Specs',
        nature: 'Timid',
        sp: { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 },
        moves: ['Heat Wave', 'Air Slash', 'Solar Beam', 'Protect'],
      },
      // ...
    ];
  }

  // ─── Screens ─────────────────────────────────────────────────
  toggleScreen(side: SideKey, key: ScreenKey): void {
    const source = side === 'mine' ? this.mySideScreens : this.enemySideScreens;
    const current = source();

    if (key === 'auroraVeil') {
      const next = !current.auroraVeil;
      source.set({
        auroraVeil: next,
        lightScreen: next ? false : current.lightScreen,
        reflect: next ? false : current.reflect,
      });
      return;
    }

    source.set({
      ...current,
      auroraVeil: false,
      [key]: !current[key],
    });
  }

  isScreenActive(side: SideKey, key: ScreenKey): boolean {
    return (side === 'mine' ? this.mySideScreens() : this.enemySideScreens())[key];
  }

  getSideToggleClass(side: SideKey, active: boolean): string {
    if (active) {
      return side === 'mine'
        ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200'
        : 'border-rose-400/60 bg-rose-500/15 text-rose-200';
    }
    return 'border-white/10 bg-white/[0.04] text-neutral-300 hover:bg-white/[0.08]';
  }

  // ─── Utils template ──────────────────────────────────────────
  minVal(a: number, b: number): number { return Math.min(a, b); }

  setWeather(v: string) { this.weather.set(v || undefined); }
  setTerrain(v: string) { this.terrain.set(v || undefined); }

  selectAttacker(pokemon: PokemonSet) { this.selectedAttacker.set(pokemon); }
  selectDefender(pokemon: PokemonSet) { this.selectedDefender.set(pokemon); }
  isSelectedAttacker(p: PokemonSet) { return this.selectedAttacker()?.name === p.name; }
  isSelectedDefender(p: PokemonSet) { return this.selectedDefender()?.name === p.name; }

  // ─── Carga JSON local ────────────────────────────────────────
  private async loadDexData() {
    try {
      const [moves, items, abilities, pokemon] = await Promise.all([
        fetch('/assets/moves.json').then(r => r.json()),
        fetch('/assets/items.json').then(r => r.json()),
        fetch('/assets/abilities.json').then(r => r.json()),
        fetch('/assets/pokemon.json').then(r => r.json()),
      ]);
      this.movesDex.set(moves ?? []);
      this.itemsDex.set(items ?? []);
      this.abilitiesDex.set(abilities ?? []);
      this.pokemonDex.set(pokemon ?? []);
    } catch (error) {
      console.error('Error loading dex JSON files', error);
    }
  }

  // ─── Slugs e imágenes Showdown ───────────────────────────────
  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[''.]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  getPokemonImage(pokemon: PokemonSet): string {
    return `https://play.pokemonshowdown.com/sprites/home-centered/${this.slugify(pokemon.name)}.png`;
  }

  getItemImage(item?: string): string {
    if (!item) return '';
    return `https://play.pokemonshowdown.com/sprites/itemicons/${this.slugify(item)}.png`;
  }

  getTypeBadgeClass(type: string): string {
    switch (type?.toLowerCase()) {
      case 'normal':   return 'bg-zinc-500/20 text-zinc-200 border border-zinc-400/30';
      case 'fire':     return 'bg-orange-500/20 text-orange-200 border border-orange-400/30';
      case 'water':    return 'bg-blue-500/20 text-blue-200 border border-blue-400/30';
      case 'electric': return 'bg-yellow-500/20 text-yellow-200 border border-yellow-400/30';
      case 'grass':    return 'bg-green-500/20 text-green-200 border border-green-400/30';
      case 'ice':      return 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/30';
      case 'fighting': return 'bg-red-500/20 text-red-200 border border-red-400/30';
      case 'poison':   return 'bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-400/30';
      case 'ground':   return 'bg-amber-600/20 text-amber-200 border border-amber-500/30';
      case 'flying':   return 'bg-sky-500/20 text-sky-200 border border-sky-400/30';
      case 'psychic':  return 'bg-pink-500/20 text-pink-200 border border-pink-400/30';
      case 'bug':      return 'bg-lime-500/20 text-lime-200 border border-lime-400/30';
      case 'rock':     return 'bg-stone-500/20 text-stone-200 border border-stone-400/30';
      case 'ghost':    return 'bg-violet-500/20 text-violet-200 border border-violet-400/30';
      case 'dragon':   return 'bg-indigo-500/20 text-indigo-200 border border-indigo-400/30';
      case 'dark':     return 'bg-neutral-500/20 text-neutral-200 border border-neutral-400/30';
      case 'steel':    return 'bg-slate-500/20 text-slate-200 border border-slate-400/30';
      case 'fairy':    return 'bg-rose-500/20 text-rose-200 border border-rose-400/30';
      default:         return 'bg-white/10 text-neutral-200 border border-white/10';
    }
  }

  getMoveTypeIcon(moveName: string): string {
    const move = this.movesByName().get(moveName);
    return this.getTypeBadgeClass(move?.type ?? 'Normal');
  }

  // ─── Sugerencias/autocomplete ────────────────────────────────
  getAllowedMovesForPokemon(pokemon: PokemonSet): string[] {
    return this.pokemonByName().get(pokemon.name)?.moves ?? [];
  }

  getAllowedAbilitiesForPokemon(pokemon: PokemonSet): string[] {
    const abilities = this.pokemonByName().get(pokemon.name)?.abilities ?? {};
    return Object.values(abilities);
  }

  getAllItems(): string[] {
    return this.itemsDex().map(i => i.name);
  }

  // ─── SP helpers ──────────────────────────────────────────────
  private spToEvs(sp?: StatPoints): StatsTable {
    if (!sp) return {};
    const result: StatsTable = {};
    for (const key of Object.keys(sp) as (keyof StatPoints)[]) {
      result[key] = (sp[key] ?? 0) * this.SP_TO_EV;
    }
    return result;
  }

  getTotalSp(sp?: StatPoints): number {
    if (!sp) return 0;
    return Object.values(sp).reduce((acc, v) => acc + (v ?? 0), 0);
  }

  getRemainingsp(sp?: StatPoints): number {
    return this.TOTAL_SP - this.getTotalSp(sp);
  }

  // ─── HP helpers ──────────────────────────────────────────────
  getMaxHp(pokemon: PokemonSet): number {
    try { return this.buildPokemon(pokemon).rawStats.hp ?? 1; }
    catch { return 1; }
  }

  getHpPercent(pokemon: PokemonSet): number {
    const max = this.getMaxHp(pokemon);
    const cur = pokemon.currentHp ?? max;
    return Math.round((cur / max) * 100);
  }

  onHpSlider(rawValue: string, side: SideKey) {
    const target = this.editTarget();
    if (!target) return;
    const val = parseInt(rawValue, 10);
    if (isNaN(val)) return;
    const max = this.getMaxHp(target.pokemon);
    const newHp = side === 'mine'
      ? Math.max(1, Math.min(val, max))
      : Math.max(1, Math.round((Math.min(val, 100) / 100) * max));
    const updated = { ...target.pokemon, currentHp: newHp };
    this.editDraft.set(updated);
    this.editTarget.set({ ...target, pokemon: updated });
  }

  // ─── Modal ───────────────────────────────────────────────────
  openEdit(pokemon: PokemonSet, side: SideKey) {
    const team = side === 'mine' ? this.myTeam() : this.enemyTeam();
    const index = team.findIndex(p => p.name === pokemon.name);
    const draft = JSON.parse(JSON.stringify(pokemon)) as PokemonSet;
    this.editDraft.set(draft);
    this.editTarget.set({ pokemon: draft, side, index });
  }

  closeEdit() {
    this.editTarget.set(null);
    this.editDraft.set(null);
  }

  updatePokemonName(value: string) {
    const draft = this.editDraft();
    if (!draft) return;
    const dexEntry = this.pokemonByName().get(value);
    const updated: PokemonSet = {
      ...draft,
      name: value,
      types: dexEntry?.types ?? draft.types,
      ability: dexEntry ? Object.values(dexEntry.abilities)[0] ?? draft.ability : draft.ability,
      moves: dexEntry
        ? (dexEntry.moves.slice(0, 4).length ? dexEntry.moves.slice(0, 4) : draft.moves)
        : draft.moves,
    };
    while (updated.moves.length < 4) updated.moves.push('Protect');
    this.editDraft.set(updated);
    this.editTarget.set({ ...this.editTarget()!, pokemon: updated });
  }

  updateField(field: 'ability' | 'nature' | 'item', value: string) {
    const draft = this.editDraft();
    if (!draft) return;
    const updated = { ...draft, [field]: value };
    this.editDraft.set(updated);
    this.editTarget.set({ ...this.editTarget()!, pokemon: updated });
  }

  updateMove(index: number, value: string) {
    const draft = this.editDraft();
    if (!draft) return;
    const moves = [...draft.moves];
    moves[index] = value;
    const updated = { ...draft, moves };
    this.editDraft.set(updated);
    this.editTarget.set({ ...this.editTarget()!, pokemon: updated });
  }

  updateSp(stat: keyof StatPoints, value: number) {
    const draft = this.editDraft();
    if (!draft) return;
    const current = { ...(draft.sp ?? {}) };
    const clamped = Math.max(0, Math.min(value, this.MAX_SP_PER_STAT));
    const otherTotal = this.getTotalSp(current) - (current[stat] ?? 0);
    current[stat] = Math.min(clamped, this.TOTAL_SP - otherTotal);
    const updated = { ...draft, sp: current };
    this.editDraft.set(updated);
    this.editTarget.set({ ...this.editTarget()!, pokemon: updated });
  }

  saveEdit() {
    const target = this.editTarget();
    const draft = this.editDraft();
    if (!target || !draft) return;

    if (target.side === 'mine') {
      const team = [...this.myTeam()];
      team[target.index] = draft;
      this.myTeam.set(team);
      if (this.isSelectedAttacker(target.pokemon)) this.selectedAttacker.set(draft);
    } else {
      const team = [...this.enemyTeam()];
      team[target.index] = draft;
      this.enemyTeam.set(team);
      if (this.isSelectedDefender(target.pokemon)) this.selectedDefender.set(draft);
    }
    this.closeEdit();
  }

  // ─── Display helpers ─────────────────────────────────────────
  formatDamageRange(row: DamageRow): string {
    if (!row.damage.length) return '—';
    return `${Math.min(...row.damage)}–${Math.max(...row.damage)}`;
  }

  // ─── Cálculo con pantallas conectadas ────────────────────────
  /**
   * perspective: 'attacker' → el atacante es myTeam, defensor es enemyTeam
   *              'defender' → el atacante es enemyTeam, defensor es myTeam
   */
  private calcRows(
    attacker: PokemonSet,
    defender: PokemonSet,
    perspective: 'attacker' | 'defender'
  ): DamageRow[] {
    const atkPokemon = this.buildPokemon(attacker);
    const defPokemon = this.buildPokemon(defender);
    const field = this.buildField(perspective);

    return attacker.moves.map(moveName => {
      try {
        const move = new Move(this.gen, moveName);
        const result = calculate(this.gen, atkPokemon, defPokemon, move, field);
        const damage = this.normalizeDamage(result.damage as number | number[] | number[][]);
        const defHp = defPokemon.rawStats.hp || 1;
        const min = damage.length ? Math.min(...damage) : 0;
        const max = damage.length ? Math.max(...damage) : 0;
        const minPct = (min / defHp) * 100;
        const maxPct = (max / defHp) * 100;
        let threat: 'OHKO' | '2HKO' | 'Chip' = 'Chip';
        if (minPct >= 100) threat = 'OHKO';
        else if (minPct >= 50) threat = '2HKO';
        return {
          moveName,
          description: result.desc(),
          damage,
          minPercent: minPct.toFixed(1),
          maxPercent: maxPct.toFixed(1),
          koChance: this.formatKoChance(result.kochance()),
          threat,
        };
      } catch {
        return {
          moveName,
          description: '',
          damage: [],
          minPercent: '0.0',
          maxPercent: '0.0',
          koChance: '',
          threat: 'Chip',
        };
      }
    });
  }

  /**
   * Construye el Field con pantallas correctas.
   * - perspective 'attacker': atacante=myTeam → attacker side=mySideScreens, defender side=enemySideScreens
   * - perspective 'defender': atacante=enemyTeam → attacker side=enemySideScreens, defender side=mySideScreens
   */
  private buildField(perspective: 'attacker' | 'defender'): Field {
    const myScreens = this.mySideScreens();
    const enemyScreens = this.enemySideScreens();

    const atkScreens = perspective === 'attacker' ? myScreens : enemyScreens;
    const defScreens = perspective === 'attacker' ? enemyScreens : myScreens;

    return new Field({
      gameType: 'Doubles',
      weather: this.weather() as any,
      terrain: this.terrain() as any,
      attackerSide: new Side({
        isReflect: atkScreens.reflect,
        isLightScreen: atkScreens.lightScreen,
        isAuroraVeil: atkScreens.auroraVeil,
      }),
      defenderSide: new Side({
        isReflect: defScreens.reflect,
        isLightScreen: defScreens.lightScreen,
        isAuroraVeil: defScreens.auroraVeil,
      }),
    });
  }

  private buildPokemon(pokemon: PokemonSet) {
    return new Pokemon(this.gen, pokemon.name, {
      level: pokemon.level,
      ability: pokemon.ability,
      item: pokemon.item,
      nature: pokemon.nature,
      evs: this.spToEvs(pokemon.sp),
      ivs: this.PERFECT_IVS,
      boosts: pokemon.boosts,
      status: pokemon.status as any,
      curHP: pokemon.currentHp,
      teraType: pokemon.teraType as any,
    });
  }

  private normalizeDamage(damage: number | number[] | number[][]): number[] {
    if (typeof damage === 'number') return [damage];
    if (Array.isArray(damage) && damage.length > 0 && Array.isArray(damage[0])) {
      return (damage as number[][]).flat();
    }
    return damage as number[];
  }

  private formatKoChance(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'text' in value) {
      return String((value as { text?: string }).text ?? '');
    }
    return '';
  }

  readonly itemsByName = computed(() => {
  const map = new Map<string, ItemDexEntry>();
  for (const item of this.itemsDex()) map.set(item.name, item);
  return map;
});

readonly abilitiesByName = computed(() => {
  const map = new Map<string, AbilityDexEntry>();
  for (const ability of this.abilitiesDex()) map.set(ability.name, ability);
  return map;
});

getItemDescription(item?: string): string {
  if (!item) return '';
  return this.itemsByName().get(item)?.description ?? item;
}

getAbilityDescription(ability?: string): string {
  if (!ability) return '';
  return this.abilitiesByName().get(ability)?.description ?? ability;
}
}
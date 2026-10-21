import { Injectable, computed, inject, signal } from '@angular/core';

import { battleAbility, getSpecies } from '../../engine/champions';
import type { Revealed } from '../../engine/inference';
import {
  type BattleStatus,
  type FieldConditions,
  type Matchup,
  type SideConditions,
  TERRAIN_SETTERS,
  WEATHER_SETTERS,
  computeMatchup,
  emptySide,
  freshStatus,
} from '../../engine/matchup';
import { playerIndex } from '../../engine/players';
import { MetagameService } from './metagame.service';
import { persistedSignal } from './storage';
import { TeamStore } from './team-store.service';

/** Lo que pasa en la partida en curso, por especie. */
interface BattleRecord {
  mine: Record<string, BattleStatus>;
  rivals: Record<string, BattleStatus>;
  revealed: Record<string, Revealed>;
}

function emptyBattle(): BattleRecord {
  return { mine: {}, rivals: {}, revealed: {} };
}

function megaOf(statuses: Record<string, BattleStatus>): string | undefined {
  return Object.keys(statuses).find((species) => statuses[species].mega);
}

/**
 * Estado de la calculadora y de la partida en curso. Vive a nivel de app (no de página) para
 * no perderlo al cambiar de pantalla, y se guarda por si se recarga a mitad de combate.
 */
@Injectable({ providedIn: 'root' })
export class CalcState {
  private readonly metagame = inject(MetagameService).metagame;
  private readonly myTeam = inject(TeamStore).activeMembers;

  readonly rivalTeam = persistedSignal<(string | null)[]>('krustle.rival', Array(6).fill(null));
  readonly battle = persistedSignal<BattleRecord>('krustle.battle', emptyBattle());
  /** Usuario de Limitless del rival, si se sabe quién es. */
  readonly rivalPlayerId = persistedSignal<string | null>('krustle.rivalPlayer', null);
  readonly myIndex = signal(0);
  readonly rivalIndex = signal(0);
  /** Set candidato elegido para cada especie rival (por defecto, el más probable). */
  readonly candidateChoice = signal<Record<string, number>>({});
  readonly field = signal<FieldConditions>({ trickRoom: false });
  readonly mySide = signal<SideConditions>(emptySide());
  readonly theirSide = signal<SideConditions>(emptySide());

  /**
   * Rivales con los que calcular. Uno que la calculadora no conozca (un equipo antiguo de un
   * jugador, una especie nueva que aún no trae) se deja fuera en vez de romper la página.
   */
  readonly rivals = computed(() =>
    this.rivalTeam().filter((s): s is string => !!s && !!getSpecies(s)),
  );
  readonly me = computed(() => this.myTeam()[this.myIndex()] ?? this.myTeam()[0]);
  readonly rival = computed(() => this.rivals()[this.rivalIndex()] ?? this.rivals()[0]);

  /** Índice del rival en los datos (si se sabe quién es y ha jugado torneos del formato). */
  readonly rivalPlayer = computed(() => {
    const metagame = this.metagame();
    const id = this.rivalPlayerId();
    return metagame && id ? playerIndex(metagame, id) : undefined;
  });
  readonly rivalPlayerName = computed(() => {
    const index = this.rivalPlayer();
    return index === undefined ? undefined : this.metagame()?.players[index].name;
  });

  readonly myStatus = computed(() => this.myStatusOf(this.me()?.species));
  readonly rivalStatus = computed(() => this.rivalStatusOf(this.rival()));
  readonly revealed = computed(() => this.revealedOf(this.rival()));

  readonly matchup = computed<Matchup | undefined>(() => {
    const metagame = this.metagame();
    const me = this.me();
    const rival = this.rival();
    if (!metagame || !me || !rival) return undefined;
    return computeMatchup({
      metagame,
      me,
      rival,
      rivalTeam: this.rivals(),
      candidate: this.candidateChoice()[rival] ?? 0,
      field: this.field(),
      mySide: this.mySide(),
      theirSide: this.theirSide(),
      myStatus: this.myStatus(),
      rivalStatus: this.rivalStatus(),
      revealed: this.revealed(),
      rivalPlayer: this.rivalPlayer(),
    });
  });

  /** Quién ha megaevolucionado de cada lado (solo puede uno por combate). */
  readonly myMega = computed(() => megaOf(this.battle().mine));
  readonly rivalMega = computed(() => megaOf(this.battle().rivals));

  /** En la partida nadie empieza megaevolucionado: hasta que se marca, se usa la forma base. */
  myStatusOf(species: string | undefined): BattleStatus {
    return { mega: false, ...((species && this.battle().mine[species]) || freshStatus()) };
  }

  rivalStatusOf(species: string | undefined): BattleStatus {
    return { mega: false, ...((species && this.battle().rivals[species]) || freshStatus()) };
  }

  /**
   * Megaevoluciona a un Pokémon (o lo deshace, con `stone` nulo). Solo uno por lado, así que se
   * le quita la mega a quien la tuviera. La mega del rival revela su piedra, y si la habilidad
   * de la mega pone clima o terreno (Charizard-Mega-Y → Drought), se pone en el campo.
   */
  megaEvolve(side: 'mine' | 'rivals', species: string, stone: string | null): void {
    this.battle.update((b) => {
      const statuses = Object.fromEntries(
        Object.entries(b[side]).map(([s, status]) => [s, { ...status, mega: false }]),
      );
      statuses[species] = { ...freshStatus(), ...b[side][species], mega: !!stone };
      return { ...b, [side]: statuses };
    });
    if (!stone) return;
    const ability = battleAbility(species, stone) ?? '';
    const weather = WEATHER_SETTERS[ability];
    const terrain = TERRAIN_SETTERS[ability];
    if (weather) this.field.update((f) => ({ ...f, weather }));
    if (terrain) this.field.update((f) => ({ ...f, terrain }));
    const revealed = this.revealedOf(species);
    if (side === 'rivals' && revealed.item !== stone) {
      this.updateRevealed(species, { ...revealed, item: stone });
    }
  }

  revealedOf(species: string | undefined): Revealed {
    return (species && this.battle().revealed[species]) || {};
  }

  setRival(slot: number, species: string | null): void {
    this.rivalTeam.update((team) => team.map((s, i) => (i === slot ? species : s)));
    if (species) this.rivalIndex.set(this.rivals().indexOf(species));
  }

  /** Vacía el equipo rival y empieza de cero (otro rival). */
  clearRivals(): void {
    this.rivalTeam.set(Array(6).fill(null));
    this.rivalIndex.set(0);
    this.rivalPlayerId.set(null);
    this.newGame();
  }

  /** Carga un equipo conocido del rival (p. ej. el que llevó en su último torneo). */
  useRivalTeam(species: readonly string[]): void {
    this.rivalTeam.set([...species, ...Array(6).fill(null)].slice(0, 6));
    this.rivalIndex.set(0);
    this.newGame();
  }

  /** Otra partida contra el mismo rival (p. ej. la siguiente de un Bo3): se conservan los equipos. */
  newGame(): void {
    this.battle.set(emptyBattle());
    this.candidateChoice.set({});
    this.resetField();
  }

  chooseCandidate(species: string, index: number): void {
    this.candidateChoice.update((c) => ({ ...c, [species]: index }));
  }

  updateMyStatus(species: string, status: BattleStatus): void {
    this.battle.update((b) => ({ ...b, mine: { ...b.mine, [species]: status } }));
  }

  updateRivalStatus(species: string, status: BattleStatus): void {
    this.battle.update((b) => ({ ...b, rivals: { ...b.rivals, [species]: status } }));
  }

  /** Al revelar algo, el set elegido a mano deja de tener sentido: vuelve al más probable. */
  updateRevealed(species: string, revealed: Revealed): void {
    this.battle.update((b) => ({ ...b, revealed: { ...b.revealed, [species]: revealed } }));
    this.chooseCandidate(species, 0);
  }

  resetField(): void {
    this.field.set({ trickRoom: false });
    this.mySide.set(emptySide());
    this.theirSide.set(emptySide());
  }
}

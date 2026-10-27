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
  matchupAgainst,
} from '../../engine/matchup';
import { playerIndex } from '../../engine/players';
import { MetagameService } from './metagame.service';
import { persistedSignal } from './storage';
import { TeamStore } from './team-store.service';

/** Lo que pasa en la serie (Bo3) contra el rival actual, por especie. */
interface BattleRecord {
  mine: Record<string, BattleStatus>;
  rivals: Record<string, BattleStatus>;
  /** Lo que ha enseñado el rival en esta partida o en las anteriores de la serie. */
  revealed: Record<string, Revealed>;
  /** Lo que ya se sabía al empezar esta partida (de las anteriores). */
  earlier?: Record<string, Revealed>;
  /** Partida de la serie: 1, 2, 3... (sin definir en lo guardado por versiones anteriores). */
  game?: number;
}

function emptyBattle(): BattleRecord {
  return { mine: {}, rivals: {}, revealed: {}, earlier: {}, game: 1 };
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
  /** Lo que el rival elegido ya había enseñado en partidas anteriores de la serie. */
  readonly earlier = computed(() => {
    const rival = this.rival();
    return (rival && this.battle().earlier?.[rival]) || {};
  });
  readonly game = computed(() => this.battle().game ?? 1);

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
      singleTargetOdds: true,
    });
  });

  /** Compañeros para el golpe doble: uno mío contra el rival y uno suyo contra mi Pokémon. */
  readonly myPartnerChoice = signal<string | null>(null);
  readonly rivalPartnerChoice = signal<string | null>(null);

  readonly myPartner = computed(() => {
    const me = this.me();
    return this.myTeam().find((m) => m !== me && m.species === this.myPartnerChoice());
  });
  readonly rivalPartner = computed(() => {
    const species = this.rivalPartnerChoice();
    return species && species !== this.rival() && this.rivals().includes(species)
      ? species
      : undefined;
  });

  /** Mi compañero contra el mismo rival (su set y repartos ya inferidos en `matchup`). */
  readonly myPartnerMatchup = computed<Matchup | undefined>(() => {
    const metagame = this.metagame();
    const m = this.matchup();
    const partner = this.myPartner();
    if (!metagame || !m || !partner) return undefined;
    return matchupAgainst(
      partner,
      { inference: m.inference, set: m.rivalSet, spreads: m.spreads },
      {
        field: this.field(),
        mySide: this.mySide(),
        theirSide: this.theirSide(),
        myStatus: this.myStatusOf(partner.species),
        theirStatus: this.rivalStatus(),
        moves: metagame.moves,
      },
    );
  });

  /** Mi Pokémon contra el compañero del rival, con el set que se le supone a este. */
  readonly rivalPartnerMatchup = computed<Matchup | undefined>(() => {
    const metagame = this.metagame();
    const me = this.me();
    const partner = this.rivalPartner();
    if (!metagame || !me || !partner) return undefined;
    return computeMatchup({
      metagame,
      me,
      rival: partner,
      rivalTeam: this.rivals(),
      candidate: this.candidateChoice()[partner] ?? 0,
      field: this.field(),
      mySide: this.mySide(),
      theirSide: this.theirSide(),
      myStatus: this.myStatus(),
      rivalStatus: this.rivalStatusOf(partner),
      revealed: this.revealedOf(partner),
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
    this.newSeries();
  }

  /** Carga un equipo conocido del rival (p. ej. el que llevó en su último torneo). */
  useRivalTeam(species: readonly string[]): void {
    this.rivalTeam.set([...species, ...Array(6).fill(null)].slice(0, 6));
    this.rivalIndex.set(0);
    this.newSeries();
  }

  /**
   * La siguiente partida contra el mismo rival (la 2 o la 3 de un Bo3): vuelven los PS, los
   * estados, las megas y el campo, pero lo que ha enseñado se queda, porque en una serie los sets
   * no cambian. Lo que ya se sabía queda marcado como visto en una partida anterior.
   */
  newGame(): void {
    this.battle.update((b) => ({
      ...emptyBattle(),
      revealed: b.revealed,
      earlier: b.revealed,
      game: (b.game ?? 1) + 1,
    }));
    this.candidateChoice.set({});
    this.resetField();
  }

  /** Otro rival: se olvida todo, también lo que había enseñado. */
  private newSeries(): void {
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

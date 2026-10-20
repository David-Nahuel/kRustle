import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CalcState } from '../../data/calc-state.service';
import { I18n } from '../../i18n/i18n.service';
import { MetagameService } from '../../data/metagame.service';
import { TeamStore } from '../../data/team-store.service';
import { RivalTeamPicker } from '../../shared/rival-team-picker';
import { Sprite } from '../../shared/sprite';
import { BattleStatusPanel } from './battle-status-panel';
import { battleAbility, megaStonesFor } from '../../../engine/champions';
import type { DamageOdds } from '../../../engine/damage';
import type { MoveRow } from '../../../engine/matchup';
import { DamageRow } from './damage-row';
import { FieldBar } from './field-bar';
import { MoveNotes } from './move-notes';
import { RivalSetCard } from './rival-set-card';
import { SpeedCard } from './speed-card';

@Component({
  selector: 'app-calc-page',
  imports: [
    BattleStatusPanel,
    DamageRow,
    FieldBar,
    MoveNotes,
    RivalSetCard,
    RivalTeamPicker,
    RouterLink,
    SpeedCard,
    Sprite,
  ],
  templateUrl: './calc-page.html',
})
export class CalcPage {
  protected readonly t = inject(I18n).t;
  protected readonly state = inject(CalcState);
  protected readonly data = inject(MetagameService);
  protected readonly myTeam = inject(TeamStore).activeMembers;

  protected readonly selectedCandidate = computed(() => {
    const rival = this.state.rival();
    return rival ? (this.state.candidateChoice()[rival] ?? 0) : 0;
  });

  /** Habilidades en combate (las de la mega si ya ha megaevolucionado), para Intimidate. */
  protected readonly myAbility = computed(() => {
    const me = this.state.me();
    return me && battleAbility(me.species, me.item, me.ability, this.state.myStatus().mega);
  });
  protected readonly rivalAbility = computed(() => {
    const set = this.state.matchup()?.rivalSet;
    return set && battleAbility(set.species, set.item, set.ability, this.state.rivalStatus().mega);
  });

  /** Mi Pokémon solo puede megaevolucionar con la piedra que lleva. */
  protected readonly myStones = computed(() => {
    const me = this.state.me();
    return me?.item && megaStonesFor(me.species).includes(me.item) ? [me.item] : [];
  });

  /**
   * Del rival no se sabe el objeto hasta que lo enseña: se ofrecen todas sus megas legales
   * (Charizard X e Y), la de su set probable primero.
   */
  protected readonly rivalStones = computed(() => {
    const rival = this.state.rival();
    if (!rival) return [];
    const legal = this.data.metagame()?.itemIcons;
    const item = this.state.matchup()?.rivalSet.item;
    return megaStonesFor(rival)
      .filter((stone) => !legal?.size || legal.has(stone))
      .sort((a, b) => Number(b === item) - Number(a === item));
  });

  protected damaging(rows: MoveRow[]): (MoveRow & { odds: DamageOdds })[] {
    return rows.filter((r): r is MoveRow & { odds: DamageOdds } => !!r.odds);
  }

  /** Los de estado y los que no afectan (bloqueados o inmunes). */
  protected others(rows: MoveRow[]): MoveRow[] {
    return rows.filter((r) => !r.odds);
  }
}

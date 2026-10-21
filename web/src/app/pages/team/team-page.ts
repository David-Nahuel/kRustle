import { Component, computed, inject, linkedSignal, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { emptyStats } from '../../../engine/champions';
import {
  type PasteWarning,
  type TeamMember,
  addMember,
  parsePokepaste,
  updateMember,
} from '../../../engine/pokepaste';
import { MetagameService } from '../../data/metagame.service';
import { TeamStore } from '../../data/team-store.service';
import { UndoService } from '../../data/undo.service';
import { I18n } from '../../i18n/i18n.service';
import type { MessageKey } from '../../i18n/messages';
import { MemberCard } from '../../shared/member-card';
import { SpeciesSearch } from '../../shared/species-search';
import { MemberEditor } from './member-editor';

const EXAMPLE = `Incineroar @ Sitrus Berry
Ability: Intimidate
EVs: 32 HP / 2 Def / 32 SpD
Careful Nature
- Fake Out
- Flare Blitz
- Darkest Lariat
- Parting Shot`;

const STEPS: { title: MessageKey; text: MessageKey }[] = [
  { title: 'team.step1Title', text: 'team.step1' },
  { title: 'team.step2Title', text: 'team.step2' },
  { title: 'team.step3Title', text: 'team.step3' },
];

@Component({
  selector: 'app-team-page',
  imports: [MemberCard, MemberEditor, RouterLink, SpeciesSearch],
  templateUrl: './team-page.html',
})
export class TeamPage {
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly store = inject(TeamStore);
  protected readonly data = inject(MetagameService);
  private readonly undo = inject(UndoService);
  private readonly search = viewChild(SpeciesSearch);
  protected readonly example = EXAMPLE;
  protected readonly steps = STEPS;

  /** Equipo en edición: `null` es uno nuevo. Se reinicia al cambiar el equipo activo. */
  protected readonly editingId = linkedSignal<string | null>(() => this.store.active()?.id ?? null);
  protected readonly name = linkedSignal(() => this.store.active()?.name ?? '');
  protected readonly paste = linkedSignal(() => this.store.active()?.paste ?? '');

  protected readonly parsed = computed(() => parsePokepaste(this.paste()));
  protected readonly species = computed(() => this.parsed().members.map((m) => m.species));

  /**
   * El paste se ve de entrada si no hay equipo (es por donde se empieza) o hay sitio al lado de
   * las fichas; en el móvil, con el equipo ya puesto, se pliega para ver las fichas primero.
   */
  protected readonly pasteOpen = linkedSignal(
    () => !this.store.active() || matchMedia('(min-width: 1024px)').matches,
  );
  protected readonly copied = signal(false);
  /** Pokémon que se está editando en la interfaz (índice); se cierra al cambiar de equipo. */
  protected readonly editing = linkedSignal<number | null>(() => {
    this.store.active();
    return null;
  });
  protected readonly dirty = computed(() => {
    const active = this.store.active();
    if (this.editingId() === null) return this.paste().trim().length > 0;
    return active?.paste !== this.paste() || active?.name !== this.name();
  });
  protected readonly canSave = computed(() => this.dirty() && this.parsed().members.length > 0);

  protected save(): void {
    const name = this.name().trim() || this.t('team.defaultName');
    this.store.save(name, this.paste(), this.editingId() ?? undefined);
  }

  /** Lo que no se ha podido leer del paste, explicado en el idioma elegido. */
  protected warningText(warning: PasteWarning): string {
    switch (warning.code) {
      case 'noSpread':
        return this.t(warning.noNature ? 'warn.noSpreadNoNature' : 'warn.noSpread', {
          species: this.i18n.list(warning.species),
        });
      case 'tooManyMembers':
        return this.t('warn.tooManyMembers', { count: warning.count });
      case 'unknownSpecies':
        return this.t('warn.unknownSpecies', { value: warning.value });
      case 'spOverflow':
        return this.t('warn.spOverflow', { species: warning.species, max: warning.max });
      case 'unknownItem':
      case 'unknownAbility':
      case 'unknownNature':
      case 'unknownMove':
        return this.t(`warn.${warning.code}`, { species: warning.species, value: warning.value });
      default:
        return this.t(`warn.${warning.code}`, { species: warning.species });
    }
  }

  /** Lo editado en la interfaz se escribe en el paste: solo cambia el bloque de ese Pokémon. */
  protected updateMember(index: number, member: TeamMember): void {
    this.paste.set(updateMember(this.paste(), index, member));
  }

  /** Se quita al momento y se puede deshacer unos segundos (un toque sin querer es fácil). */
  protected removeMember(index: number): void {
    const before = this.paste();
    const teamId = this.editingId();
    const species = this.parsed().members[index]?.species ?? '';
    this.paste.set(updateMember(before, index, null));
    this.editing.set(null);
    this.undo.offer(this.t('undo.memberRemoved', { name: species }), () => {
      // Solo si sigue en el mismo equipo: si se ha cambiado de equipo, ya no hay nada que tocar.
      if (this.editingId() !== teamId) return;
      this.paste.set(before);
      this.editing.set(index);
    });
  }

  /** Huecos que faltan hasta 6, numerados (el primero lleva el buscador). */
  protected readonly emptySlots = computed(() => {
    const filled = this.parsed().members.length;
    return Array.from({ length: Math.max(0, 6 - filled) }, (_, i) => filled + i + 1);
  });

  protected focusSearch(): void {
    this.search()?.focus();
  }

  /** Un Pokémon nuevo, con la habilidad que más se usa, y se abre para rellenarlo. */
  protected addSpecies(species: string): void {
    const ability = this.data.abilitiesFor(species)[0];
    this.paste.set(addMember(this.paste(), { species, ability, sps: emptyStats(), moves: [] }));
    this.editing.set(this.parsed().members.length - 1);
  }

  /** Para llevarlo de vuelta a Showdown. */
  protected copy(): void {
    void navigator.clipboard.writeText(this.paste()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  protected newTeam(): void {
    this.editingId.set(null);
    this.name.set('');
    this.paste.set('');
  }

  protected remove(id: string, name: string): void {
    this.undo.offer(this.t('undo.teamRemoved', { name }), this.store.remove(id));
  }
}

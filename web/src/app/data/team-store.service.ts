import { Injectable, computed } from '@angular/core';

import { parsePokepaste } from '../../engine/pokepaste';
import { persistedSignal } from './storage';

export interface SavedTeam {
  id: string;
  name: string;
  /** Se guarda el texto original: si mejora el parser, los equipos guardados se benefician. */
  paste: string;
}

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random()}`;
}

/** Tus equipos, guardados en este navegador. */
@Injectable({ providedIn: 'root' })
export class TeamStore {
  readonly teams = persistedSignal<SavedTeam[]>('krustle.teams', []);
  private readonly activeId = persistedSignal<string | null>('krustle.activeTeam', null);

  readonly active = computed(() => {
    const teams = this.teams();
    return teams.find((t) => t.id === this.activeId()) ?? teams[0];
  });

  readonly activeMembers = computed(() => {
    const team = this.active();
    return team ? parsePokepaste(team.paste).members : [];
  });

  /** Crea o actualiza un equipo y lo deja como activo. Devuelve su id. */
  save(name: string, paste: string, id?: string): string {
    const team: SavedTeam = { id: id ?? newId(), name: name.trim() || 'My team', paste };
    this.teams.update((teams) =>
      teams.some((t) => t.id === team.id)
        ? teams.map((t) => (t.id === team.id ? team : t))
        : [...teams, team],
    );
    this.activeId.set(team.id);
    return team.id;
  }

  activate(id: string): void {
    this.activeId.set(id);
  }

  remove(id: string): void {
    this.teams.update((teams) => teams.filter((t) => t.id !== id));
    if (this.activeId() === id) this.activeId.set(null);
  }
}

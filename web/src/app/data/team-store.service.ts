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

  /**
   * Borra un equipo. Devuelve cómo deshacerlo: vuelve a su sitio y, si era el activo, lo es otra
   * vez.
   */
  remove(id: string): () => void {
    const teams = this.teams();
    const index = teams.findIndex((t) => t.id === id);
    const team = teams[index];
    const wasActive = this.active()?.id === id;
    this.teams.update((list) => list.filter((t) => t.id !== id));
    if (this.activeId() === id) this.activeId.set(null);
    return () => {
      if (!team) return;
      this.teams.update((list) =>
        list.some((t) => t.id === id)
          ? list
          : [...list.slice(0, index), team, ...list.slice(index)],
      );
      if (wasActive) this.activeId.set(id);
    };
  }
}

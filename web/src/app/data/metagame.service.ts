import { Injectable, computed, resource } from '@angular/core';

import { GEN, abilitiesByUsage, previewSpecies } from '../../engine/champions';
import {
  type Meta,
  type RosterFile,
  type SpeciesUsage,
  type SpreadsFile,
  type TeamsFile,
  buildMetagame,
} from '../../engine/metagame';

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`data/${path}`, { signal });
  // Sin texto propio: la interfaz lo envuelve en su idioma ('data.error').
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

/** Datos del formato vigente (los JSON que genera el pipeline), cargados una vez. */
@Injectable({ providedIn: 'root' })
export class MetagameService {
  private readonly data = resource({
    loader: async ({ abortSignal }) => {
      const { current } = await getJson<{ current: string }>('index.json', abortSignal);
      const [meta, usage, teams, spreads, roster] = await Promise.all([
        getJson<Meta>(`${current}/meta.json`, abortSignal),
        getJson<SpeciesUsage[]>(`${current}/usage.json`, abortSignal),
        getJson<TeamsFile>(`${current}/teams.json`, abortSignal),
        // Sin estadísticas de Smogon la app sigue funcionando con SP estimados.
        getJson<SpreadsFile>(`${current}/spreads.json`, abortSignal).catch(() => undefined),
        getJson<RosterFile>(`${current}/roster.json`, abortSignal).catch(() => undefined),
      ]);
      return buildMetagame({ meta, usage, teams, spreads, roster });
    },
  });

  readonly metagame = computed(() => (this.data.hasValue() ? this.data.value() : undefined));
  readonly loading = this.data.isLoading;
  readonly error = computed(() => this.data.error()?.message);

  /** Habilidades posibles de la especie, las más usadas en torneos primero. */
  abilitiesFor(species: string): string[] {
    const metagame = this.metagame();
    return abilitiesByUsage(
      species,
      metagame?.usage.get(species),
      metagame?.speciesAbilities.get(species),
    );
  }

  /** Vuelve a intentar la carga (p. ej. tras perder la conexión). */
  reload(): void {
    this.data.reload();
  }

  /** Objetos y movimientos legales en Champions, por orden alfabético (para el editor de equipo). */
  readonly itemOptions = computed(() => [...(this.metagame()?.itemIcons.keys() ?? [])].sort());
  readonly moveOptions = computed(() => [...(this.metagame()?.moves.keys() ?? [])].sort());

  /**
   * Pokémon que pueden salir en team preview, los más usados primero (para el buscador).
   * Sale de `roster.json`; sin él, de los datos de la calculadora (que incluyen formas de combate).
   */
  readonly speciesOptions = computed(() => {
    const metagame = this.metagame();
    const usage = metagame?.usage;
    const names = new Set<string>(metagame?.legalSpecies);
    if (!names.size) for (const species of GEN.species) names.add(previewSpecies(species.name));
    return [...names].sort(
      (a, b) => (usage?.get(b)?.usage ?? 0) - (usage?.get(a)?.usage ?? 0) || a.localeCompare(b),
    );
  });
}

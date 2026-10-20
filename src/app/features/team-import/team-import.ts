import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { PokemonSet, PokemonDexEntry } from '../../core/models/pokemon.models';

// Ajusta estas rutas a tu estructura real en core/services
import { TeamImportService } from '../../core/services/team-import.service';
import { CalculatorSessionService } from '../../core/services/calculator-session.service';

type EnemySlot = {
  id: number;
  name: string;
};

type TeamImportRequest = {
  allyShowdown: string;
  enemyNames: string[];
};

type TeamImportRecommendation = {
  recommendedLeadFour: string[];
  allyTeam: PokemonSet[];
  completedEnemyTeam: PokemonSet[];
};

@Component({
  selector: 'app-team-import',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './team-import.html',
})
export class TeamImport {
  private readonly teamImportService = inject(TeamImportService);
  private readonly calculatorSessionService = inject(CalculatorSessionService);
  private readonly router = inject(Router);

  pokemonDex = signal<PokemonDexEntry[]>([]);

  allyShowdown = signal(`Venusaur @ Life Orb
    Ability: Overgrow
    Level: 50
    Tera Type: Grass
    EVs: 252 SpA / 4 HP / 252 Spe
    Modest Nature
    - Sludge Bomb
    - Giga Drain
    - Earth Power
    - Protect`);

  enemySlots = signal<EnemySlot[]>([
    { id: 1, name: '' },
    { id: 2, name: '' },
    { id: 3, name: '' },
    { id: 4, name: '' },
    { id: 5, name: '' },
    { id: 6, name: '' },
  ]);

  isSubmitting = signal(false);
  hasSubmitted = signal(false);
  errorMessage = signal<string>('');
  result = signal<TeamImportRecommendation | null>(null);

  pokemonOptions = computed(() =>
    [...this.pokemonDex()]
      .map(p => p.name)
      .sort((a, b) => a.localeCompare(b))
  );

  enemyNames = computed(() =>
    this.enemySlots()
      .map(slot => slot.name.trim())
      .filter(Boolean)
  );

  duplicateEnemyNames = computed(() => {
    const counts = new Map<string, number>();

    for (const name of this.enemyNames()) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    return [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([name]) => name);
  });

  isFormValid = computed(() => {
    const ally = this.allyShowdown().trim();
    const enemy = this.enemyNames();

    return (
      ally.length > 0 &&
      enemy.length === 6 &&
      this.duplicateEnemyNames().length === 0
    );
  });

  canOpenCalculator = computed(() => {
    const current = this.result();
    return !!current?.allyTeam?.length && !!current?.completedEnemyTeam?.length;
  });

  constructor() {
    this.loadPokemonDex();
  }

  trackBySlotId(_: number, slot: EnemySlot): number {
    return slot.id;
  }

  updateAllyShowdown(value: string): void {
    this.allyShowdown.set(value);
    this.errorMessage.set('');
  }

  updateEnemyName(slotId: number, value: string): void {
    const normalized = value.trimStart();

    this.enemySlots.update(slots =>
      slots.map(slot =>
        slot.id === slotId
          ? { ...slot, name: normalized }
          : slot
      )
    );

    this.errorMessage.set('');
  }

  clearForm(): void {
    this.allyShowdown.set('');
    this.enemySlots.set([
      { id: 1, name: '' },
      { id: 2, name: '' },
      { id: 3, name: '' },
      { id: 4, name: '' },
      { id: 5, name: '' },
      { id: 6, name: '' },
    ]);
    this.result.set(null);
    this.hasSubmitted.set(false);
    this.errorMessage.set('');
  }

  async analyze(): Promise<void> {
    this.hasSubmitted.set(true);
    this.errorMessage.set('');
    this.result.set(null);

    const validationError = this.getValidationError();
    if (validationError) {
      this.errorMessage.set(validationError);
      return;
    }

    const payload: TeamImportRequest = {
      allyShowdown: this.allyShowdown().trim(),
      enemyNames: this.enemyNames(),
    };

    this.isSubmitting.set(true);

    try {
      const response = await this.teamImportService.recommend(payload);
      this.result.set(response as TeamImportRecommendation);
    } catch (error) {
      console.error('Error analyzing teams', error);
      this.errorMessage.set(
        'No se pudo analizar el enfrentamiento. Revisa los datos o inténtalo de nuevo.'
      );
    } finally {
      this.isSubmitting.set(false);
    }
  }

  openCalculator(): void {
    const current = this.result();
    if (!current) return;

    this.calculatorSessionService.setSession({
      allyTeam: current.allyTeam,
      enemyTeam: current.completedEnemyTeam,
      recommendedFour: current.recommendedLeadFour,
      source: 'team-import',
    });

    this.router.navigate(['/calculator']);
  }

  getSlotLabel(index: number): string {
    return `Pokémon rival ${index + 1}`;
  }

  isDuplicateName(name: string): boolean {
    const normalized = name.trim();
    if (!normalized) return false;
    return this.duplicateEnemyNames().includes(normalized);
  }

  private getValidationError(): string {
    if (!this.allyShowdown().trim()) {
      return 'Pega el equipo aliado en formato Showdown.';
    }

    if (this.enemyNames().length !== 6) {
      return 'Debes indicar los 6 Pokémon del equipo rival.';
    }

    if (this.duplicateEnemyNames().length > 0) {
      return `Hay Pokémon rivales duplicados: ${this.duplicateEnemyNames().join(', ')}.`;
    }

    return '';
  }

  private async loadPokemonDex(): Promise<void> {
    try {
      const response = await fetch('assets/pokemon.json');
      const data = await response.json();
      this.pokemonDex.set(data ?? []);
    } catch (error) {
      console.error('Error loading pokemon dex', error);
      this.pokemonDex.set([]);
    }
  }
}
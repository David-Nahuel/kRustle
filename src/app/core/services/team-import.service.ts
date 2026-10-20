import { Injectable } from '@angular/core';

import type { PokemonSet } from '../models/pokemon.models';
import type { TeamImportRequest, TeamImportResponse } from '../models/team-import.models';

@Injectable({
  providedIn: 'root',
})
export class TeamImportService {
  async recommend(payload: TeamImportRequest): Promise<TeamImportResponse> {
    await this.delay(900);

    const allyTeam = this.buildMockAllyTeam(payload.allyShowdown);
    const completedEnemyTeam = this.buildMockEnemyTeam(payload.enemyNames);

    return {
      recommendedLeadFour: allyTeam.slice(0, 4).map(pokemon => pokemon.name),
      allyTeam,
      completedEnemyTeam,
      reasoning: [
        {
          pokemonName: allyTeam[0]?.name ?? 'Venusaur',
          summary: 'Aporta presión ofensiva inmediata y fuerza intercambios favorables.',
        },
        {
          pokemonName: allyTeam[1]?.name ?? 'Incineroar',
          summary: 'Da utilidad defensiva y control de tempo con Intimidate y support.',
        },
        {
          pokemonName: allyTeam[2]?.name ?? 'Rillaboom',
          summary: 'Mejora el matchup con prioridad y presión de terreno.',
        },
        {
          pokemonName: allyTeam[3]?.name ?? 'Urshifu-Rapid-Strike',
          summary: 'Castiga composiciones más pasivas y obliga a respetar daño directo.',
        },
      ],
    };
  }

  /*
  Futuro:
  recommend(payload: TeamImportRequest): Promise<TeamImportResponse> {
    return firstValueFrom(
      this.http.post<TeamImportResponse>('/api/team-import/recommend', payload)
    );
  }
  */

  private buildMockAllyTeam(showdown: string): PokemonSet[] {
    const names = showdown
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !line.startsWith('Ability:'))
      .filter(line => !line.startsWith('Level:'))
      .filter(line => !line.startsWith('Tera Type:'))
      .filter(line => !line.startsWith('EVs:'))
      .filter(line => !line.startsWith('-'))
      .filter(line => !line.endsWith('Nature'))
      .filter(line => !line.startsWith('IVs:'))
      .filter(line => !line.startsWith('Shiny:'))
      .filter(line => !line.startsWith('Gender:'))
      .map(line => line.split('@')[0].trim())
      .filter((line, index, arr) => arr.indexOf(line) === index)
      .slice(0, 6);

    const fallback = [
      'Venusaur',
      'Incineroar',
      'Rillaboom',
      'Urshifu-Rapid-Strike',
      'Flutter Mane',
      'Landorus-Therian',
    ];

    return (names.length ? names : fallback).map(name => this.createMockPokemon(name));
  }

  private buildMockEnemyTeam(enemyNames: string[]): PokemonSet[] {
    return enemyNames.map(name => this.createMockPokemon(name));
  }

  private createMockPokemon(name: string): PokemonSet {
    return {
      name,
      level: 50,
      types: ['Normal'],
      ability: 'Pressure',
      item: 'Sitrus Berry',
      nature: 'Serious',
      currentHp: 100,
      moves: ['Protect', 'Taunt', 'Thunder Wave', 'Tera Blast'],
      sp: { hp: 12, atk: 12, def: 10, spa: 12, spd: 10, spe: 10 },
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
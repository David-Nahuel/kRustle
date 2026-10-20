import { describe, expect, it } from 'vitest';

import { type SetCandidate, candidateLabels, inferSet } from './inference';
import { type Meta, type TeamsFile, buildMetagame } from './metagame';

const NOW = new Date('2026-10-20T00:00:00Z');

const META: Meta = {
  format: 'M-C',
  generatedAt: NOW.toISOString(),
  halfLifeDays: 14,
  tournaments: 1,
  teams: 0,
  matches: 0,
  firstDate: null,
  lastDate: null,
};

interface FixtureSet {
  species: string;
  item?: string;
  moves?: string[];
}

/** Construye un `teams.json` mínimo: cada equipo es una lista de sets, todos del mismo torneo. */
function fixture(teams: FixtureSet[][]): TeamsFile {
  const file: TeamsFile = {
    species: [],
    items: [],
    abilities: [],
    natures: [],
    moves: [],
    sets: [],
    tournaments: [{ id: 't', name: 'Test', date: NOW.toISOString(), players: 8 }],
    teams: [],
    matches: [],
  };
  const intern = (table: string[], name: string) => {
    const i = table.indexOf(name);
    return i >= 0 ? i : table.push(name) - 1;
  };
  for (const team of teams) {
    const row = [0, 3, 3, 0];
    for (const s of team) {
      file.sets.push([
        intern(file.species, s.species),
        s.item ? intern(file.items, s.item) : null,
        null,
        null,
        (s.moves ?? []).map((m) => intern(file.moves, m)),
      ]);
      row.push(file.sets.length - 1);
    }
    file.teams.push(row);
  }
  return file;
}

const sunCore = ['Charizard', 'Venusaur', 'Torkoal'];
const trickRoomCore = ['Hatterene', 'Ursaluna', 'Kingambit'];
const sitrus: FixtureSet = {
  species: 'Incineroar',
  item: 'Sitrus Berry',
  moves: ['Fake Out', 'Parting Shot'],
};
const goggles: FixtureSet = {
  species: 'Incineroar',
  item: 'Safety Goggles',
  moves: ['Fake Out', 'Knock Off'],
};
const withCore = (core: string[], set: FixtureSet) => [
  set,
  ...core.map((species) => ({ species })),
];

// Sitrus es lo más común en general, pero en Trick Room se lleva Safety Goggles.
const metagame = buildMetagame(
  {
    meta: META,
    usage: [],
    teams: fixture([
      withCore(sunCore, sitrus),
      withCore(sunCore, sitrus),
      withCore(['Rillaboom', 'Sneasler', 'Garchomp'], sitrus),
      withCore(trickRoomCore, goggles),
    ]),
  },
  NOW,
);

describe('inferSet', () => {
  it('sin contexto, devuelve el set más usado', () => {
    const result = inferSet(metagame, 'Incineroar', ['Incineroar'])!;
    expect(result.candidates[0].item).toBe('Sitrus Berry');
    expect(result.sampleSize).toBe(4);
  });

  it('prioriza los sets de equipos parecidos al del rival', () => {
    const result = inferSet(metagame, 'Incineroar', ['Incineroar', ...trickRoomCore])!;
    expect(result.candidates[0].item).toBe('Safety Goggles');
    expect(result.similarTeams).toBe(1);
  });

  it('filtra por lo que ya se ha visto en la partida', () => {
    const result = inferSet(metagame, 'Incineroar', ['Incineroar', ...sunCore], {
      moves: ['Knock Off'],
    })!;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].item).toBe('Safety Goggles');
    expect(result.revealedMismatch).toBe(false);
  });

  it('si lo visto no encaja con nada conocido, lo fuerza sobre el set más probable', () => {
    const result = inferSet(metagame, 'Incineroar', ['Incineroar'], {
      item: 'Assault Vest',
      moves: ['Flare Blitz'],
    })!;
    expect(result.revealedMismatch).toBe(true);
    expect(result.candidates[0].item).toBe('Assault Vest');
    expect(result.candidates[0].moves).toContain('Flare Blitz');
  });

  it('fusiona los sets que quedan iguales al forzar lo visto', () => {
    // Ningún set lleva Flare Blitz: se fuerza lo visto sobre los dos (Sitrus y Goggles), que
    // con el mismo objeto y los mismos 4 movimientos quedan idénticos.
    const result = inferSet(metagame, 'Incineroar', ['Incineroar'], {
      item: 'Sitrus Berry',
      moves: ['Flare Blitz', 'Fake Out', 'Parting Shot', 'Knock Off'],
    })!;
    expect(result.revealedMismatch).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].probability).toBeCloseTo(1);
  });

  it('devuelve null para especies que no aparecen en la muestra', () => {
    expect(inferSet(metagame, 'Pikachu', ['Pikachu'])).toBeNull();
  });

  it('las probabilidades de los candidatos suman 1', () => {
    const result = inferSet(metagame, 'Incineroar', ['Incineroar'])!;
    const total = result.candidates.reduce((sum, c) => sum + c.probability, 0);
    expect(total).toBeCloseTo(1);
  });
});

describe('candidateLabels', () => {
  const set = (item: string, moves: string[], extra: Partial<SetCandidate> = {}): SetCandidate => ({
    species: 'Hawlucha',
    item,
    moves,
    probability: 0.2,
    ...extra,
  });

  it('usa solo el objeto si no hay dudas', () => {
    expect(candidateLabels([set('Hawluchanite', []), set('Focus Sash', [])])).toEqual([
      'Hawluchanite',
      'Focus Sash',
    ]);
  });

  it('añade detalles hasta que todas las etiquetas son distintas', () => {
    const labels = candidateLabels([
      set('Hawluchanite', ['Close Combat', 'Brave Bird', 'Protect']),
      set('Hawluchanite', ['Flying Press', 'Brave Bird', 'Protect']),
      set('Hawluchanite', ['Close Combat', 'Brave Bird', 'Detect']),
      set('Hawluchanite', ['Close Combat', 'Brave Bird', 'Protect'], { nature: 'Adamant' }),
    ]);
    expect(new Set(labels).size).toBe(4);
    expect(labels.every((l) => l.startsWith('Hawluchanite'))).toBe(true);
  });

  it('numera los que no se pueden distinguir', () => {
    expect(candidateLabels([set('Leftovers', ['Protect']), set('Leftovers', ['Protect'])])).toEqual(
      ['Leftovers', 'Leftovers (2)'],
    );
  });
});

import { describe, expect, it } from 'vitest';

import { type Stats, emptyStats } from './champions';
import { type Meta, type TeamsFile, buildMetagame } from './metagame';
import {
  analyzePick,
  combinations,
  duelWin,
  planDuel,
  protectionFor,
  speedWeights,
  supportBonus,
  supportRoles,
} from './pick';
import type { TeamMember } from './pokepaste';

const META: Meta = {
  format: 'M-C',
  generatedAt: '2026-10-20T00:00:00Z',
  halfLifeDays: 14,
  tournaments: 1,
  teams: 1,
  matches: 0,
  firstDate: null,
  lastDate: null,
};

// Equipo rival conocido: Pelipper (pone lluvia) y Garchomp con Scarf.
const TEAMS: TeamsFile = {
  species: ['Pelipper', 'Garchomp'],
  items: ['Damp Rock', 'Choice Scarf'],
  abilities: ['Drizzle', 'Rough Skin'],
  natures: ['Modest', 'Jolly'],
  moves: ['Hurricane', 'Weather Ball', 'Earthquake', 'Dragon Claw'],
  sets: [
    [0, 0, 0, 0, [0, 1]],
    [1, 1, 1, 1, [2, 3]],
  ],
  tournaments: [{ id: 't', name: 'T', date: '2026-10-19T00:00:00Z', players: 8 }],
  teams: [[0, 3, 3, 0, 0, 1]],
  matches: [],
};
const metagame = buildMetagame({ meta: META, usage: [], teams: TEAMS }, new Date('2026-10-20'));

const member = (
  species: string,
  moves: string[],
  extra: Omit<Partial<TeamMember>, 'sps'> & { sps?: Partial<Stats> } = {},
): TeamMember => ({
  species,
  moves,
  nature: 'Jolly',
  ...extra,
  sps: { ...emptyStats(), atk: 32, spa: 32, spe: 2, ...extra.sps },
});

const myTeam: TeamMember[] = [
  member('Rillaboom', ['Wood Hammer', 'Fake Out'], { ability: 'Grassy Surge' }),
  member('Raichu', ['Thunderbolt', 'Fake Out'], { nature: 'Timid' }),
  member('Tyranitar', ['Rock Slide', 'Crunch'], { ability: 'Sand Stream', nature: 'Adamant' }),
  member('Whimsicott', ['Tailwind', 'Encore', 'Protect'], { ability: 'Prankster' }),
  member('Mamoswine', ['Icicle Crash', 'Earthquake'], { nature: 'Adamant' }),
  member('Dragonite', ['Extreme Speed', 'Ice Spinner'], { nature: 'Adamant' }),
];

describe('combinations', () => {
  it('genera todas las combinaciones sin repetir', () => {
    const all = combinations(6, 4);
    expect(all).toHaveLength(15);
    expect(new Set(all.map((c) => c.join())).size).toBe(15);
    expect(all.every((c) => c.every((x, i) => i === 0 || x > c[i - 1]))).toBe(true);
  });
});

describe('analyzePick', () => {
  const analysis = analyzePick(metagame, myTeam, ['Pelipper', 'Garchomp']);

  it('devuelve planes coherentes y ordenados', () => {
    expect(analysis.duels).toHaveLength(6);
    expect(analysis.duels[0]).toHaveLength(2);
    for (const row of analysis.duels) {
      for (const d of row) expect(d.winChance).toBeGreaterThanOrEqual(0);
    }
    const scores = analysis.plans.map((p) => p.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    for (const plan of analysis.plans) {
      expect(new Set(plan.bring).size).toBe(4);
      expect([...plan.leads, ...plan.back].sort()).toEqual([...plan.bring].sort());
    }
  });

  it('no lleva a quien no puede debilitar a nadie', () => {
    const whimsicott = 3;
    expect(analysis.plans[0].bring).not.toContain(whimsicott);
  });

  it('el hielo de Mamoswine gana al Garchomp rival', () => {
    expect(analysis.duels[4][1].winChance).toBeGreaterThan(0.5);
  });

  it('si los dos equipos ponen clima, no supone ninguno', () => {
    expect(analysis.field.weather).toBeUndefined();
    expect(analysis.field.terrain).toBe('Grassy');
    const noSand = analyzePick(
      metagame,
      myTeam.filter((m) => m.species !== 'Tyranitar'),
      ['Pelipper', 'Garchomp'],
    );
    expect(noSand.field.weather).toBe('Rain');
  });

  it('funciona con equipos de menos de 6 y rivales sin datos', () => {
    const small = analyzePick(metagame, myTeam.slice(0, 3), ['Pikachu']);
    expect(small.plans[0].bring).toHaveLength(3);
    expect(small.rivalSets[0].species).toBe('Pikachu');
  });

  it('con un solo Pokémon, abre él solo (sin índices inventados)', () => {
    const [plan] = analyzePick(metagame, myTeam.slice(0, 1), ['Pikachu']).plans;
    expect(plan.leads).toEqual([0]);
    expect(plan.back).toEqual([]);
  });
});

describe('analyzePick con Trick Room', () => {
  const hatterene = member('Hatterene', ['Trick Room', 'Dazzling Gleam', 'Psyshock'], {
    nature: 'Quiet',
    sps: { hp: 32, atk: 0, spa: 32, spe: 0 },
  });
  const torkoal = member('Torkoal', ['Eruption', 'Heat Wave'], {
    ability: 'Drought',
    nature: 'Quiet',
    sps: { hp: 32, atk: 0, spa: 32, spe: 0 },
  });
  const rivals = ['Pelipper', 'Garchomp'];

  it('sin Trick Room en ningún equipo, ninguna opción lo supone', () => {
    const a = analyzePick(metagame, myTeam, rivals);
    expect(a.rivalTrickRoom).toBe(0);
    expect(a.plans.every((p) => p.trickRoom === 0)).toBe(true);
  });

  it('con Trick Room, los lentos se mueven antes y la opción que lo lleva lo tiene en cuenta', () => {
    const team = [hatterene, torkoal, ...myTeam.slice(0, 4)];
    const a = analyzePick(metagame, team, rivals, { maxPlans: 15 });
    const torkoalVsGarchomp = a.duels[1][1].firstBy;
    expect(torkoalVsGarchomp.trickRoom).toBeGreaterThan(torkoalVsGarchomp.none);

    const withSetter = a.plans.find((p) => p.bring.includes(0))!;
    const without = a.plans.find((p) => !p.bring.includes(0))!;
    expect(withSetter.setsTrickRoom).toBe(true);
    expect(withSetter.trickRoom).toBeCloseTo(0.5);
    expect(without.trickRoom).toBe(0);
  });

  it('un equipo de Trick Room lleva a quien lo pone', () => {
    const slow = (species: string, moves: string[]) =>
      member(species, moves, { nature: 'Brave', sps: { hp: 32, atk: 32, spa: 0, spe: 0 } });
    const team = [
      hatterene,
      torkoal,
      slow('Kingambit', ['Kowtow Cleave', 'Iron Head']),
      slow('Rhyperior', ['Rock Slide', 'High Horsepower']),
      slow('Conkeldurr', ['Drain Punch', 'Mach Punch']),
      slow('Snorlax', ['Double-Edge', 'Heat Crash']),
    ];
    const a = analyzePick(metagame, team, rivals);
    expect(a.plans[0].setsTrickRoom).toBe(true);
  });

  it('si el rival suele llevar Trick Room, también lo considera', () => {
    const farigiraf: TeamsFile = {
      ...TEAMS,
      species: ['Farigiraf', 'Garchomp'],
      abilities: ['Armor Tail', 'Rough Skin'],
      moves: ['Trick Room', 'Psychic', 'Earthquake', 'Dragon Claw'],
    };
    const rivalTr = buildMetagame(
      { meta: META, usage: [], teams: farigiraf },
      new Date('2026-10-20'),
    );
    const a = analyzePick(rivalTr, myTeam, ['Farigiraf', 'Garchomp']);
    expect(a.rivalTrickRoom).toBeCloseTo(1);
    expect(a.plans[0].trickRoom).toBeCloseTo(0.5);
  });
});

describe('analyzePick con Intimidate', () => {
  it('Intimidate de mi Pokémon baja el daño físico del rival en el 1 contra 1', () => {
    // Snorlax contra el Garchomp rival (físico): sin Intimidate gana a veces; con él, siempre.
    const snorlax = member('Snorlax', ['Double-Edge', 'Heat Crash'], {
      nature: 'Adamant',
      sps: { hp: 32, atk: 32, def: 2, spa: 0, spe: 0 },
    });
    const plain = analyzePick(metagame, [snorlax], ['Garchomp']).duels[0][0].winChance;
    const intimidating = analyzePick(
      metagame,
      [{ ...snorlax, ability: 'Intimidate' }],
      ['Garchomp'],
    ).duels[0][0].winChance;
    expect(plain).toBeLessThan(0.9);
    expect(intimidating).toBeGreaterThan(plain);
  });
});

describe('analyzePick con megas', () => {
  const zard = member('Charizard', ['Heat Wave', 'Hurricane'], {
    item: 'Charizardite Y',
    ability: 'Blaze',
    nature: 'Timid',
  });
  const chomp = member('Garchomp', ['Earthquake', 'Dragon Claw'], {
    item: 'Garchompite Z',
    ability: 'Rough Skin',
  });
  const team = [zard, chomp, ...myTeam.slice(0, 4)];
  const a = analyzePick(metagame, team, ['Pelipper', 'Garchomp'], { maxPlans: 15 });

  it('solo uno megaevoluciona: el otro que lleva piedra se valora con su forma base', () => {
    expect(a.canMega).toEqual([true, true, false, false, false, false]);
    for (const plan of a.plans) {
      const holders = plan.bring.filter((i) => a.canMega[i]);
      if (holders.length) expect(holders).toContain(plan.mega);
      else expect(plan.mega).toBeUndefined();
      for (const i of holders.filter((h) => h !== plan.mega)) {
        a.rivals.forEach((_, j) => expect(planDuel(a, plan, i, j)).toBe(a.baseDuels[i][j]));
      }
    }
  });

  it('la forma base cambia el resultado y los que no llevan piedra no se recalculan', () => {
    expect(a.baseDuels[0]).not.toEqual(a.duels[0]);
    expect(a.baseDuels[2]).toBe(a.duels[2]);
  });
});

describe('analyzePick con Tailwind', () => {
  // El Pelipper rival lleva Tailwind en todos sus sets.
  const tailwindTeams: TeamsFile = {
    ...TEAMS,
    moves: ['Hurricane', 'Tailwind', 'Earthquake', 'Dragon Claw'],
  };
  const rivalTw = buildMetagame(
    { meta: META, usage: [], teams: tailwindTeams },
    new Date('2026-10-20'),
  );

  it('el Tailwind del rival le hace más rápido', () => {
    const a = analyzePick(rivalTw, myTeam, ['Pelipper', 'Garchomp'], { maxPlans: 15 });
    expect(a.rivalTailwind).toBeCloseTo(1);
    expect(a.rivalTailwindSetters).toEqual([['Pelipper', 1]]);
    expect(a.plans.every((p) => p.theirTailwind === 0.4)).toBe(true);
    // Raichu adelanta a Pelipper, salvo con su Tailwind.
    const raichuVsPelipper = a.duels[1][0].firstBy;
    expect(raichuVsPelipper.none).toBe(1);
    expect(raichuVsPelipper.theirTailwind).toBeLessThan(1);
  });

  it('mi Tailwind solo cuenta en las opciones que llevan a quien lo pone', () => {
    const a = analyzePick(metagame, myTeam, ['Pelipper', 'Garchomp'], { maxPlans: 15 });
    expect(a.rivalTailwind).toBe(0);
    for (const plan of a.plans) {
      expect(plan.tailwind).toBe(plan.bring.includes(3) ? 0.4 : 0);
    }
  });

  it('cada duelo se puede valorar en cada situación sin recalcular el daño', () => {
    const a = analyzePick(rivalTw, myTeam, ['Pelipper', 'Garchomp']);
    const d = a.duels[1][0];
    expect(duelWin(d, 'none')).toBeCloseTo(d.winChance);
    const plan = a.plans[0];
    const weights = Object.values(speedWeights(plan));
    expect(weights.reduce((x, y) => x + y, 0)).toBeCloseTo(1);
  });
});

describe('analyzePick con apoyo', () => {
  it('reconoce los movimientos y habilidades de apoyo', () => {
    expect(
      supportRoles({ moves: ['Rock Slide', 'Tailwind', 'Wide Guard'], ability: 'Unnerve' }),
    ).toEqual(['Tailwind', 'Wide Guard']);
    expect(supportRoles({ moves: ['Fake Out'], ability: 'Intimidate' })).toEqual([
      'Fake Out',
      'Intimidate',
    ]);
  });

  it('el apoyo suma al llevarlo, megaevolucione o no', () => {
    // Con 4 Pokémon solo hay una opción: la diferencia de puntuación es solo el apoyo.
    const zard = member('Charizard', ['Heat Wave', 'Hurricane'], {
      item: 'Charizardite Y',
      nature: 'Timid',
    });
    const aero = (moves: string[]) =>
      member('Aerodactyl', ['Rock Slide', ...moves], { item: 'Aerodactylite' });
    const rest = myTeam.slice(0, 2);
    const score = (moves: string[]) =>
      analyzePick(metagame, [zard, aero(moves), ...rest], ['Pelipper', 'Garchomp']).plans[0];

    const plain = score([]);
    const support = score(['Reflect', 'Light Screen']);
    // Aerodactyl no es la mega, pero su apoyo cuenta igual: las pantallas, una vez (0,02).
    expect(support.mega).toBe(plain.mega);
    expect(support.score - plain.score).toBeCloseTo(0.02);
  });

  it('mi Wide Guard frena los ataques en área del rival en cada duelo', () => {
    // Un Garchomp rival que solo ataca en área (Earthquake, Rock Slide).
    const spreadOnly = buildMetagame(
      {
        meta: META,
        usage: [],
        teams: { ...TEAMS, moves: ['Hurricane', 'Weather Ball', 'Earthquake', 'Rock Slide'] },
      },
      new Date('2026-10-20'),
    );
    const guard = member('Aerodactyl', ['Rock Slide', 'Wide Guard'], { nature: 'Jolly' });
    const a = analyzePick(spreadOnly, [guard, ...myTeam.slice(0, 3)], ['Garchomp'], {
      maxPlans: 1,
    });
    const plan = a.plans[0];
    expect(plan.wideGuard).toBe(true);
    expect(protectionFor(plan, 3)).toBe('guard');
    // Tyranitar pierde contra su Earthquake; con Wide Guard, a veces le da tiempo.
    const tyranitar = a.duels[3][0];
    expect(duelWin(tyranitar, 'none', 'guard')).toBeGreaterThan(tyranitar.winChance);
  });

  it('la redirección protege a los compañeros, no a quien redirige', () => {
    const team = [
      member('Indeedee-F', ['Follow Me', 'Psychic'], { nature: 'Calm' }),
      ...myTeam.slice(0, 3),
    ];
    const plan = analyzePick(metagame, team, ['Garchomp'], { maxPlans: 1 }).plans[0];
    expect(plan.redirectors).toEqual([[0, 'Follow Me']]);
    expect(protectionFor(plan, 0)).toBeUndefined();
    expect(protectionFor(plan, 1)).toBe('followMe');
  });
});

describe('analyzePick con Wide Guard y redirección del rival', () => {
  // El mismo Pelipper rival, cambiando solo un movimiento de estado.
  const pelipperWith = (move: string, team = myTeam) =>
    analyzePick(
      buildMetagame(
        {
          meta: META,
          usage: [],
          teams: { ...TEAMS, moves: ['Hurricane', move, 'Earthquake', 'Dragon Claw'] },
        },
        new Date('2026-10-20'),
      ),
      team,
      ['Pelipper', 'Garchomp'],
    );
  const plain = pelipperWith('Protect');
  const column = (a: ReturnType<typeof pelipperWith>, j: number) =>
    a.duels.map((row) => row[j].winChance);
  const worse = (after: number[], before: number[]) =>
    after.every((w, i) => w <= before[i] + 1e-9) && after.some((w, i) => w < before[i] - 1e-9);

  it('Wide Guard resta a mis ataques en área', () => {
    const spreaders = [
      member('Rhyperior', ['Rock Slide'], { nature: 'Adamant' }),
      member('Gholdengo', ['Make It Rain'], { nature: 'Modest' }),
    ];
    const a = pelipperWith('Wide Guard', spreaders);
    expect(a.rivalWideGuard).toEqual([['Pelipper', 1]]);
    expect(worse(column(a, 0), column(pelipperWith('Protect', spreaders), 0))).toBe(true);
  });

  it('la redirección resta a mis ataques a un objetivo, pero no contra quien redirige', () => {
    const a = pelipperWith('Follow Me');
    expect(a.rivalRedirection).toEqual([['Pelipper', 1]]);
    expect(worse(column(a, 1), column(plain, 1))).toBe(true);
    expect(column(a, 0)).toEqual(column(plain, 0));
  });
});

describe('supportBonus', () => {
  const whimsicott = { moves: ['Tailwind', 'Moonblast'], ability: 'Prankster' };
  const farigiraf = { moves: ['Trick Room', 'Psychic'], ability: 'Armor Tail' };

  it('abrir con Tailwind vale menos cuanto más probable es el Trick Room rival', () => {
    expect(supportBonus([whimsicott], 'lead', { spread: 0, rivalTrickRoom: 0 })).toBeCloseTo(0.06);
    expect(supportBonus([whimsicott], 'lead', { spread: 0, rivalTrickRoom: 0.5 })).toBeCloseTo(
      0.03,
    );
    expect(supportBonus([whimsicott], 'lead', { spread: 0, rivalTrickRoom: 1 })).toBe(0);
  });

  it('mi Trick Room no pierde valor por el del rival', () => {
    expect(supportBonus([farigiraf], 'lead', { spread: 0, rivalTrickRoom: 1 })).toBeCloseTo(0.06);
  });
});

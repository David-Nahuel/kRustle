import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

// Pruebas de humo: con los datos reales del formato, cada página arranca y pinta lo principal sin
// errores. No comprueban los cálculos (de eso se encargan los tests del motor), sino que la
// interfaz y los datos del día encajan antes de publicar.

interface Usage {
  species: string;
  items: [string, number][];
  abilities: [string, number][];
  moves: [string, number][];
}

/** Un set con lo más usado de la especie, en formato Showdown. */
function pasteOf({ species, items, abilities, moves }: Usage): string {
  const item = items[0] ? ` @ ${items[0][0]}` : '';
  const ability = abilities[0] ? `\nAbility: ${abilities[0][0]}` : '';
  return `${species}${item}${ability}\n${moves
    .slice(0, 4)
    .map(([move]) => `- ${move}`)
    .join('\n')}`;
}

/**
 * Deja guardados tu equipo (los 6 Pokémon más usados) y el rival (los 6 siguientes), como si ya
 * se hubiera usado la app, y recoge los errores de la página para comprobarlos al final.
 */
async function setUp(
  page: Page,
  request: APIRequestContext,
): Promise<{ mine: string[]; errors: string[] }> {
  const { current } = await (await request.get('/data/index.json')).json();
  const usage: Usage[] = await (await request.get(`/data/${current}/usage.json`)).json();
  const mine = usage.slice(0, 6);
  const rivals = usage.slice(6, 12).map((u) => u.species);
  const paste = mine.map(pasteOf).join('\n\n');

  await page.addInitScript(
    ({ paste, rivals }) => {
      localStorage.setItem(
        'krustle.teams',
        JSON.stringify([{ id: 'smoke', name: 'Smoke', paste }]),
      );
      localStorage.setItem('krustle.activeTeam', JSON.stringify('smoke'));
      localStorage.setItem('krustle.rival', JSON.stringify(rivals));
    },
    { paste, rivals },
  );

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return { mine: mine.map((u) => u.species), errors };
}

test('Mi equipo enseña los 6 Pokémon guardados', async ({ page, request }) => {
  const { mine, errors } = await setUp(page, request);
  await page.goto('/equipo');
  for (const species of mine) {
    await expect(page.getByText(species, { exact: true }).first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('Pick recomienda qué 4 llevar y pinta los enfrentamientos', async ({ page, request }) => {
  const { errors } = await setUp(page, request);
  await page.goto('/seleccion');
  await expect(page.getByRole('heading', { name: 'Bring these 4' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('heading', { name: '1v1 matchups' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('La calculadora pinta el daño en los dos sentidos', async ({ page, request }) => {
  const { errors } = await setUp(page, request);
  await page.goto('/calculadora');
  await expect(page.getByRole('heading', { name: 'Your attacks' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('heading', { name: 'Their attacks' })).toBeVisible();
  await expect(page.getByText(/\d%/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

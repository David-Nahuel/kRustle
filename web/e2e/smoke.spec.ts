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

test('Meta enseña el uso, la ficha de cada Pokémon y los núcleos', async ({ page, request }) => {
  const { errors } = await setUp(page, request);
  await page.goto('/meta');
  const first = page.locator('button[aria-expanded]').first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await first.click();
  // El más usado tiene muestra de sobra: su ficha trae enfrentamientos.
  await expect(page.getByRole('heading', { name: 'Struggles against' })).toBeVisible();
  await page.getByRole('tab', { name: 'Cores' }).click();
  await expect(page.getByRole('heading', { name: 'Pairs' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trios' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Las amenazas del meta para tu equipo se calculan y abren en la calculadora', async ({
  page,
  request,
}) => {
  const { errors } = await setUp(page, request);
  // Sin rival: así la amenaza cabe en su equipo al abrirla en la calculadora.
  await page.addInitScript(() =>
    localStorage.setItem('krustle.rival', JSON.stringify(Array(6).fill(null))),
  );
  await page.goto('/meta');
  await page.getByRole('tab', { name: 'Your team' }).click();
  // Cada amenaza dice cuál es tu mejor respuesta (o que no la tienes).
  await expect(page.getByText(/^(Answer:|Nobody 2HKOs|None of your)/).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.locator('[role=tabpanel] button[aria-expanded]').first().click();
  await page.getByRole('button', { name: 'Open in the calc' }).first().click();
  await expect(page.getByRole('heading', { name: 'Your attacks' })).toBeVisible({
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
});

test('Un equipo del ranking se puede usar como propio y llega a Pick', async ({
  page,
  request,
}) => {
  const { errors } = await setUp(page, request);
  await page.goto('/meta');
  await page.getByRole('tab', { name: 'Teams' }).click();
  const first = page.locator('[role=tabpanel] button[aria-expanded]').first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await first.click();
  await expect(page.getByRole('heading', { name: 'Most common sets' })).toBeVisible();
  await page.getByRole('button', { name: 'Use as my team' }).click();
  await page.getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/equipo$/);
  await page.goto('/seleccion');
  await expect(page.getByRole('heading', { name: 'Bring these 4' })).toBeVisible({
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
});

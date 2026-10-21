import { defineConfig } from '@playwright/test';

// Lo único de Node que se usa aquí; así no hace falta @types/node.
declare const process: { env: Record<string, string | undefined> };

const CI = !!process.env['CI'];

/**
 * Pruebas de humo sobre el build de producción con los datos reales: `npm run e2e` después de
 * generar los datos y `ng build`. Usan el navegador ya instalado (Chrome en GitHub Actions, Edge
 * en Windows; otro con `PW_CHANNEL`), así que no hace falta descargar navegadores.
 */
export default defineConfig({
  testDir: 'e2e',
  forbidOnly: CI,
  reporter: CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4300',
    channel: process.env['PW_CHANNEL'] ?? (CI ? 'chrome' : 'msedge'),
    // Sin service worker: cada prueba carga lo recién construido, no una versión en caché.
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'node e2e/serve.mjs 4300',
    url: 'http://localhost:4300',
  },
});

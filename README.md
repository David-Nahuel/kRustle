# kRustle

Herramientas para Pokémon Champions (VGC):

- **Recomendador de pick**: dados los dos equipos, qué 4 llevar y con qué abrir.
- **Calculadora de daño y velocidad**: tu equipo (Pokepaste, guardado en local) contra el rival, con
  sus sets inferidos a partir de los torneos de [Limitless](https://play.limitlesstcg.com) y sus
  Stat Points a partir de las estadísticas del ladder de Showdown que publica [Smogon](https://www.smogon.com/stats/).
- **Idiomas**: inglés (por defecto) y español, desde la barra de navegación. En español también se
  traducen los datos (movimientos, objetos, habilidades, naturalezas y tipos) con sus nombres
  oficiales; el paste sigue en inglés, como en Showdown, y los formularios aceptan los dos idiomas.
- **Mi equipo**: se pega en formato Showdown o se monta desde la interfaz (objeto, habilidad,
  naturaleza, Stat Points y movimientos, con lo que lleva cada especie en torneos primero). Las dos
  vías están sincronizadas: lo que se edita en la interfaz reescribe solo el bloque de ese Pokémon
  en el paste.
- **Búsqueda por jugador**: si sabes contra quién juegas (usuario de Limitless), ves sus equipos
  anteriores, cargas uno con un toque y la inferencia usa sus propios sets.
- **Modo partida** (dentro de la calculadora): PS, estados y cambios de stat de cada Pokémon, y lo que
  revela el rival (objeto, habilidad, movimientos), que reajusta la inferencia de su set. Se guarda
  en el navegador por si se recarga a mitad de combate.
- **Megaevolución**: quien lleva su piedra empieza con su forma base y se megaevoluciona con un
  botón cuando ocurre en la partida (una por lado). Cambian tipos, stats y habilidad; si la mega
  pone clima (Charizard-Mega-Y → Drought) se activa en el campo, y la del rival revela su piedra.
  El recomendador de pick sí supone la mega desde el principio, porque planifica la partida entera.
- **Habilidades y prioridad**: cada movimiento (también los de estado) muestra su prioridad real
  (Prankster, Gale Wings, Triage, Grassy Glide en hierba) y, si no afecta, por qué (Armor Tail,
  Psychic Terrain, Prankster contra Siniestro, Good as Gold, Levitate...). Intimidate (según la
  habilidad de quien lo recibe) y Unburden al gastar el objeto. El recomendador aplica Intimidate en
  cada 1 contra 1 y descarta los ataques bloqueados. Los datos de movimientos (prioridad, objetivo,
  flags) salen de Showdown con los ajustes de Champions, porque la calculadora los trae incompletos.

## Arquitectura

No hay backend. Los datos son públicos, de solo lectura e iguales para todos, así que se
precalculan una vez al día y se sirven como JSON estáticos junto a la web, en Vercel. Los datos
no se guardan en el repositorio: se generan en cada despliegue (ver [Despliegue](#despliegue)).

```
Limitless API ──┐
Showdown dex  ──┤
Smogon stats  ──┼─► pipeline (Rust, en GitHub Actions) ──► JSON + sprites ──► build de la web ──► Vercel
PokeAPI       ──┘   descarga incremental · normalización · agregación       cálculo de daño y pick en el navegador
```

| Carpeta | Contenido |
| --- | --- |
| `pipeline/` | CLI en Rust que descarga, normaliza y agrega los torneos |
| `pipeline/aliases.json` | Correcciones manuales de nombres que la normalización no resuelve sola |
| `web/public/data/<formato>/` | Salida del pipeline (la consume la web) |
| `web/` | Frontend: Angular 22 + Tailwind, instalable y usable sin conexión (PWA) |
| `web/src/engine/` | Lógica sin dependencias de Angular: Pokepaste, inferencia de sets y SPs, cálculo de daño |

## Pipeline

```sh
cd pipeline
cargo run --release -- update              # fetch + build del formato por defecto (M-C)
cargo run --release -- fetch --format M-C  # solo descargar lo nuevo
cargo run --release -- build --format M-C  # solo regenerar los JSON desde la caché
cargo run --release -- sprites             # generar los sprites que falten
cargo run --release -- icons               # favicon e iconos de la app desde web/public/logo/
cargo test
```

- **Rate limit**: Limitless permite 50 peticiones cada 5 minutos. La caché (`pipeline/cache/`) guarda
  cada torneo descargado, así que solo la primera ejecución de un formato es lenta (~1 h).
- **Filtrado**: se ignoran torneos de menos de 8 jugadores, variantes (Monotype, UU, LC...) y los que
  en el nombre indican otra regulación distinta a la del formato pedido.
- **Normalización**: los nombres se escriben a mano en Limitless ("Rock Slides", "Citrus Berry").
  Se resuelven contra el dex de Showdown: primero alias, luego coincidencia exacta y después
  una búsqueda aproximada conservadora. El informe `pipeline/cache/report-<formato>.json` lista
  las correcciones aplicadas y lo que no se pudo resolver; esto último se añade a `aliases.json`.
- **Ponderación**: cada equipo pesa `0.5^(días / 14) × (0.5 + winrate suavizado)`, así que lo
  reciente y lo que gana cuenta más.

### Salida

- `meta.json`: tamaño y fechas de la muestra.
- `usage.json`: por especie, su uso, winrate (sin mirrors) y la distribución de objetos,
  habilidades, naturalezas, movimientos y compañeros.
- `teams.json`: todos los equipos y enfrentamientos en formato compacto (ver `TeamsFile` en
  `pipeline/src/aggregate.rs`), para inferir sets condicionados al equipo rival concreto.
- `spreads.json`: repartos de Stat Points por forma de combate y naturaleza, del ladder de Showdown.
- `../i18n/es.json`: nombres oficiales en español de movimientos, objetos, habilidades, naturalezas
  y tipos (solo los legales), de las tablas de [PokeAPI](https://github.com/PokeAPI/pokeapi)
  emparejadas con los ids de Showdown. Lo que aún no tiene traducción se enseña en inglés.

### Stat Points

Limitless no publica los Stat Points, así que vienen de las estadísticas mensuales de Smogon: las
partidas Bo3 con rating ≥ 1500 (lo más parecido a un torneo), con el ladder normal como respaldo
para las especies con poca muestra en Bo3. Cada fuente aporta lo que mejor sabe:

- **Limitless** (torneos, condicionado a los compañeros de equipo) → objeto, movimientos y naturaleza.
- **Smogon** (millones de combates) → los SP dentro de cada naturaleza.

La web no muestra un único reparto, sino probabilidades: "te mueves antes: 94%", "OHKO en el 62% de
los repartos". Si una especie no aparece en Smogon, se estiman los SP a partir de naturaleza,
objeto y movimientos.

## Web

Los datos y los sprites no están en el repositorio: antes de arrancar la web por primera vez hay
que generarlos con el pipeline (`cargo run --release -- update` en `pipeline/`; la primera vez
tarda ~1 h por el rate limit de Limitless, luego solo baja lo nuevo).

```sh
cd web
npm install
npm start        # http://localhost:4200
npm test         # tests del motor (Vitest)
npm run validate # acierto de la inferencia de sets con datos reales (M-C por defecto)
```

`npm run validate -- M-C 0,1,2.5` compara varios valores de `similarityBoost`. Conviene repetirlo
cuando cambie el formato: en M-C el valor por defecto (2,5) acierta el objeto el 81% de las veces,
frente al 71% de usar simplemente el set más común.

El cálculo de daño usa la mecánica de Champions de [@smogon/calc](https://github.com/smogon/damage-calc)
(generación 0: nivel 50 y Stat Points). Las megas se resuelven con `battleForme` en lugar de
`Pokemon.getForme`, que confunde las megas X/Y/Z nuevas.

### Recomendador de pick

`web/src/engine/pick.ts`. Con tu equipo y los 6 del rival (team preview):

1. **Matriz 6×6**: para cada pareja, probabilidad de ganar el 1 contra 1 con el set más probable del
   rival. Combina los golpes que necesita cada uno (como distribución: OHKO x%, 2HKO y%...) con quién
   golpea antes, contando velocidad y prioridad (Sucker Punch, Grassy Glide en hierba...).
2. **Campo supuesto**: si solo un equipo trae quien pone clima o terreno, se calcula con él activo.
   **Trick Room y Tailwind** se tratan aparte: no cambian el daño, solo quién golpea antes, así
   que cada duelo guarda la probabilidad de golpear antes con Trick Room, con tu Tailwind y con el
   del rival. Cada opción las mezcla según lo probable que sea cada situación: Trick Room ~50% de
   la partida y Tailwind ~40% si lo pones tú; para el rival, según cuántos de sus sets lo llevan
   en equipos parecidos (Whimsicott lleva Tailwind el 92% de las veces).
   **Wide Guard y redirección**, de los dos lados: si el rival suele llevar Wide Guard (Pelipper),
   tus ataques en área pierden algún turno (~25% de las veces que lo lleva); si lleva Follow Me o
   Rage Powder (Indeedee-F, Sinistcha), tus ataques a un objetivo también, salvo contra quien
   redirige. Lo mismo al revés con tu Wide Guard y tu redirección, según los 4 que lleves. Rage
   Powder no afecta a tipo Planta, Overcoat ni Safety Goggles, y Stalwart ignora la redirección.
   Cada duelo usa el ataque que antes debilita contando esos turnos perdidos.
3. **Qué 4 llevar**: de las 15 combinaciones, la que mejor cubre a cada rival (mejor respuesta y,
   con menos peso, una segunda), con penalización por el rival peor cubierto. Solo uno puede
   megaevolucionar: si la opción lleva varios con piedra, se prueba cada uno como mega y los demás
   cuentan con su forma base. La recomendación dice quién megaevoluciona. El apoyo cuenta
   megaevolucione o no: un Aerodactyl con su piedra junto a Charizard-Mega-Y sigue poniendo
   Tailwind. Lo que no se ve en un 1 contra 1 (pantallas, Icy Wind, Fake Out...) suma un bonus
   fijo al llevarlo.
4. **Con qué abrir**: la pareja que más presión mete, con bonus por Fake Out, control de velocidad,
   Wide Guard, Intimidate y redirección. Tailwind, Icy Wind y Electroweb valen menos cuanto más
   probable es el Trick Room rival: con él activo te hacen más lento, y sin él sus Pokémon lentos
   ya suelen ir después.

Es una estimación por 1 contra 1: no simula combos de dobles. Tarda ~75 ms en el navegador.

### Sprites y roster

- `roster.json`: los Pokémon y objetos legales en Champions, sacados de las tablas del editor de
  equipos de Showdown (`teambuilder-tables.js`). Son los que ofrece el buscador de la web: sin
  megas ni formas que solo existen en combate (Aegislash-Blade, Palafin-Hero...).
- La web sirve sus propios sprites (`web/public/sprites/`, ~1,3 MB) en lugar de cargarlos de
  Showdown en cada visita, y el service worker los guarda todos para usar la app sin conexión.
  - **Pokémon**: el sprite HOME de cada Pokémon legal, descargado una vez y guardado en WebP a 128 px.
  - **Objetos**: los iconos de los objetos legales, recortados de la hoja de Showdown y juntos en
    `items.webp` (una sola imagen de ~20 KB), en el mismo orden que `roster.json`.

## Despliegue

La web se publica en Vercel desde GitHub Actions (`.github/workflows/deploy.yml`), a diario, en
cada push a `main` que toque la web o el pipeline, y a mano desde *Run workflow*:

1. Restaura la caché de Actions (respuestas de Limitless y sprites ya descargados).
2. Tests del pipeline y `update`: datos del formato, roster, nombres traducidos y sprites.
3. Tests y build de la web.
4. Sube `dist/` a Vercel ya construido (`vercel deploy --prebuilt`, Build Output API con la
   config de `web/vercel/config.json`): Vercel no compila nada, solo sirve los ficheros.

Nada de lo generado se guarda en el repositorio. Si la caché de Actions se pierde (GitHub la
borra tras 7 días sin uso), la siguiente ejecución vuelve a descargar los torneos (~1 h).

### Puesta en marcha

1. En Vercel, crear un proyecto **sin conectar el repositorio** (los despliegues los hace el
   workflow) y un token en *Account Settings → Tokens*.
2. Sacar los ids con `npx vercel link` en `web/`: quedan en `web/.vercel/project.json`
   (`orgId` y `projectId`; la carpeta está en `.gitignore`).
3. En GitHub, *Settings → Secrets and variables → Actions*: los secretos `VERCEL_TOKEN`,
   `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID`.

### Cambio de formato

Cuando salga una regulación nueva, cambia la variable de repositorio `KRUSTLE_FORMAT` en GitHub
(o lanza el workflow *Desplegar* a mano con el formato nuevo).

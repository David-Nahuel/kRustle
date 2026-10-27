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
- **Meta**: uso y winrate de cada Pokémon, si sube o baja (última semana frente a las tres
  anteriores), sus sets y compañeros habituales, contra qué le va bien o mal según los
  enfrentamientos reales, y las parejas y tríos más usados. Desde la ficha se añade al equipo rival.
  Además, un ranking de equipos (los mismos 6 Pokémon llevados al menos 15 veces) por uso, winrate
  o porcentaje de top 8, con sus mejores resultados y sus sets más llevados: se puede usar como
  equipo propio (con los Stat Points más comunes del ladder, que Limitless no publica) o cargar
  como rival. Y las amenazas del meta para tu equipo: los 20 Pokémon más usados que no llevas,
  ordenados por lo mal que los cubres (quién los debilita, a cuántos de los tuyos debilitan de un
  golpe, quién es más rápido), con el detalle de cada duelo y un enlace a la calculadora.
- **Modo partida** (dentro de la calculadora): PS, estados y cambios de stat de cada Pokémon, y lo que
  revela el rival (objeto, habilidad, movimientos), que reajusta la inferencia de su set. Se guarda
  en el navegador por si se recarga a mitad de combate.
- **Golpe doble** (dentro de la calculadora): si tu Pokémon y un compañero debilitan al rival
  entre los dos en un turno, o si el rival y uno suyo te debilitan a ti. Se combinan las 16
  tiradas de cada golpe con los repartos posibles del rival y los PS que le quedan al objetivo.
  Como no se sabe quién golpea antes, se hace la media de los dos órdenes, que importan con
  Sitrus Berry (se come tras el primer golpe) y Multiscale (solo reduce el primero).
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
cargo run --release -- icons               # favicon e iconos de la app desde web/branding/kRustle-icon.png
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
  Después se comprueba contra el roster de Champions: los objetos, movimientos y habilidades que
  no existen en el juego o que la especie no puede llevar se quitan del set (la habilidad de su
  mega sí vale, que es la que muchos apuntan), y una especie fuera del roster se avisa porque
  suele ser una forma mal etiquetada ("Floette" por "Floette-Eternal") que necesita un alias.
- **Ponderación**: cada equipo pesa `0.5^(días / 14) × (0.5 + winrate suavizado)`, así que lo
  reciente y lo que gana cuenta más.

### Salida

- `meta.json`: tamaño y fechas de la muestra.
- `usage.json`: por especie, su uso, winrate (sin mirrors) y la distribución de objetos,
  habilidades, naturalezas, movimientos y compañeros.
- `teams.json`: todos los equipos y enfrentamientos en formato compacto (ver `TeamsFile` en
  `pipeline/src/aggregate.rs`), para inferir sets condicionados al equipo rival concreto.
- `spreads.json`: repartos de Stat Points por forma de combate y naturaleza, del ladder de Showdown.
- `meta-analysis.json`: para la sección Meta (`pipeline/src/aggregate/meta.rs`). Tendencia de uso
  de cada especie, núcleos (parejas y tríos en al menos el 1% de los equipos, con su winrate
  contra quien no los lleva) y enfrentamientos entre especies con al menos 40 partidas, ordenados
  sumando 20 partidas al 50% para que unos pocos resultados no manden. Sin mirrors y sin ponderar.
  También los 50 arquetipos más llevados: winrate contra otros arquetipos, victorias y top 8 en
  torneos de 32 jugadores o más (con el puesto final de Limitless), mejores resultados por puesto
  relativo al tamaño del torneo y el set más llevado de cada Pokémon.
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
npm run validate-pick -- M-C 400 # si el recomendador predice quién gana (tarda; ver abajo)
npm run e2e      # pruebas de humo sobre el build (tras `ng build`; usa Edge, o PW_CHANNEL=chrome)
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

**Lo que no puede hacer: predecir quién gana.** `npm run validate-pick` lo mide con los
enfrentamientos reales de los últimos 15 torneos (aprendiendo de los anteriores). En M-C, que gane
quien más puntúa acierta el 52%; las referencias que solo miran datos (winrate de las especies,
cómo les va a unas contra otras) llegan al 54%, y combinarlas apenas mejora sobre decir siempre
50%. No es un fallo del modelo: en los datos, que un Pokémon le gane a otro mueve el resultado
unos ±3 puntos; el resto lo deciden los jugadores. Por eso la app no enseña probabilidades de
victoria entre equipos, sino daño y velocidad, que sí se calculan con exactitud.

### Sprites y roster

- `roster.json`: los Pokémon y objetos legales en Champions, sacados de las tablas del editor de
  equipos de Showdown (`teambuilder-tables.js`). Son los que ofrece el buscador de la web: sin
  megas ni formas que solo existen en combate (Aegislash-Blade, Palafin-Hero...). Incluye todas
  las habilidades de cada uno, porque la calculadora solo trae la primera (Incineroar sin
  Intimidate).
- La web sirve sus propios sprites (`web/public/sprites/`, ~1,3 MB) en lugar de cargarlos de
  Showdown en cada visita, y el service worker los guarda todos para usar la app sin conexión.
  - **Pokémon**: el sprite HOME de cada Pokémon legal, descargado una vez y guardado en WebP a 128 px.
  - **Objetos**: los iconos de los objetos legales, recortados de la hoja de Showdown y juntos en
    `items.webp` (una sola imagen de ~20 KB), en el mismo orden que `roster.json`.

## Despliegue

La web se publica en Vercel desde GitHub Actions (`.github/workflows/deploy.yml`), a diario, en
cada push a `main` que toque la web o el pipeline, y a mano desde *Run workflow*:

1. Comprobaciones (`.github/workflows/ci.yml`, que también corre en cada pull request): `cargo fmt`,
   clippy y tests del pipeline; Prettier, tests y build de la web. En la ejecución diaria se
   saltan, porque el código no cambia.
2. Restaura la caché de Actions (respuestas de Limitless y sprites ya descargados).
3. `update`: datos del formato, roster, nombres traducidos y sprites.
4. Build de la web y prueba de humo (`npm run e2e`): con los datos nuevos, cada página arranca y
   pinta lo principal sin errores. Si falla, no se publica.
5. Sube `dist/` a Vercel ya construido (`vercel deploy --prebuilt`, Build Output API con la
   config de `web/vercel/config.json`): Vercel no compila nada, solo sirve los ficheros.

Nada de lo generado se guarda en el repositorio. Si la caché de Actions se pierde (GitHub la
borra tras 7 días sin uso), la siguiente ejecución vuelve a descargar los torneos (~1 h).

Si Limitless o Smogon no responden, o falla algún torneo o sprite, el pipeline sigue con lo que
haya en caché y lo avisa con una anotación en el resumen de la ejecución: una caída de una
fuente externa no impide desplegar. Solo falla si no hay nada en caché con lo que trabajar.

Antes de escribir los datos, `build` comprueba la muestra: si sale vacía o con más de un 25% menos
de equipos que la build anterior (los equipos se acumulan durante el formato, así que eso indica un
problema), falla y se queda publicada la versión anterior. Si la caída es correcta, se repite con
`--accept-drop` (en GitHub, *Run workflow* marcando *Aceptar caída de datos*).

El resumen de cada ejecución en GitHub muestra el tamaño de la muestra, los nombres que no se han
podido resolver (candidatos para `aliases.json`) y el acierto de la inferencia con los datos nuevos.

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

## Logo

El logo está en `web/branding/`: el PDF original y, sacados de él, el icono (`kRustle-icon.png`,
transparente, del que salen el favicon y los iconos de la app con `cargo run -- icons`) y el
logotipo (`kRustle-wordmark.png`, en claro para el fondo oscuro de la app). En `web/public/logo/`
van las versiones pequeñas en WebP que usa la cabecera. No está en `public` para no publicarlo.

## Aviso legal

kRustle es una herramienta de fans sin ánimo de lucro (sin anuncios ni donaciones), sin relación
con Nintendo, The Pokémon Company, Game Freak ni Creatures ni respaldada por ellas. Pokémon, los
nombres de los Pokémon y sus imágenes son marcas y propiedad de sus respectivos dueños. La web lo
dice en el pie de página.

- **Datos**: [Limitless](https://play.limitlesstcg.com) (torneos y equipos),
  [Smogon](https://www.smogon.com/stats/) (estadísticas del ladder),
  [Pokémon Showdown](https://pokemonshowdown.com) (dex, sprites e iconos) y
  [PokeAPI](https://pokeapi.co) (nombres en español). Todos se enlazan desde la web.
- **Licencias**: las librerías (Angular, @smogon/calc...) son de código abierto; el build genera
  `3rdpartylicenses.txt` con sus avisos, se publica con la web y el pie de página enlaza a él.
- **Datos personales**: la búsqueda por jugador enseña usuarios y resultados públicos de
  Limitless. Si alguien pide que se quite su nombre (o cualquier contenido), se retira; el pie de
  página enlaza a este repositorio para pedirlo.
- **Privacidad**: la web no usa cookies ni analítica; los equipos y la partida se guardan solo en
  el navegador de cada uno.

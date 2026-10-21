mod aggregate;
mod dex;
mod i18n;
mod icons;
mod limitless;
mod roster;
mod smogon;
mod sprites;

use std::path::{Path, PathBuf};

use anyhow::Result;
use clap::{Args, Parser, Subcommand};

/// Pipeline de datos de kRustle: Limitless → JSON estáticos para la web.
#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Descarga el dex de Showdown, los torneos de Limitless que falten y las estadísticas de Smogon.
    Fetch {
        #[command(flatten)]
        common: CommonArgs,
        #[command(flatten)]
        fetch: FetchArgs,
    },
    /// Normaliza la caché y genera roster.json, meta.json, usage.json, teams.json y spreads.json.
    Build {
        #[command(flatten)]
        common: CommonArgs,
        #[command(flatten)]
        build: BuildArgs,
    },
    /// Genera los sprites (WebP) que falten para las especies de los datos del formato.
    Sprites {
        #[command(flatten)]
        common: CommonArgs,
        #[command(flatten)]
        build: BuildArgs,
        #[command(flatten)]
        sprites: SpriteArgs,
    },
    /// Genera el favicon y los iconos de la app instalable a partir del logo.
    Icons {
        /// Imagen del logo (WebP o PNG, cuadrada) [por defecto: web/public/logo/Crustle.webp].
        #[arg(long)]
        logo: Option<PathBuf>,
    },
    /// fetch + build + sprites.
    Update {
        #[command(flatten)]
        common: CommonArgs,
        #[command(flatten)]
        fetch: FetchArgs,
        #[command(flatten)]
        build: BuildArgs,
        #[command(flatten)]
        sprites: SpriteArgs,
    },
}

#[derive(Args)]
struct CommonArgs {
    /// Código de formato de Limitless (M-A, M-B, M-C...).
    #[arg(long, default_value = "M-C")]
    format: String,
    /// Directorio de caché [por defecto: pipeline/cache].
    #[arg(long)]
    cache: Option<PathBuf>,
    /// Torneos con menos jugadores se ignoran.
    #[arg(long, default_value_t = 8)]
    min_players: u32,
}

#[derive(Args)]
struct FetchArgs {
    /// Días desde el inicio de un torneo para darlo por terminado.
    #[arg(long, default_value_t = 2)]
    settle_days: i64,
    /// Máximo de torneos a descargar en esta ejecución.
    #[arg(long)]
    max: Option<usize>,
    /// Vuelve a descargar el dex de Showdown aunque ya esté en caché.
    #[arg(long)]
    refresh_dex: bool,
}

#[derive(Args)]
struct BuildArgs {
    /// Directorio de salida [por defecto: web/public/data].
    #[arg(long)]
    out: Option<PathBuf>,
    /// Vida media (días) del peso de un equipo según su antigüedad.
    #[arg(long, default_value_t = 14.0)]
    half_life_days: f64,
    /// Media mínima de Pokémon del top 30 por equipo para no tratar un torneo como temático.
    #[arg(long, default_value_t = 0.55)]
    min_meta_overlap: f64,
    /// Genera los datos aunque haya bastantes menos equipos que en la build anterior.
    #[arg(long)]
    accept_drop: bool,
}

#[derive(Args)]
struct SpriteArgs {
    /// Directorio de los sprites [por defecto: web/public/sprites].
    #[arg(long)]
    sprites_out: Option<PathBuf>,
}

fn repo_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("el crate vive en <repo>/pipeline")
}

/// Problema que no detiene el pipeline. En GitHub Actions sale también como anotación en el
/// resumen de la ejecución, para que no pase desapercibido.
fn warn(message: &str) {
    if std::env::var_os("GITHUB_ACTIONS").is_some() {
        let escaped = message
            .replace('%', "%25")
            .replace('\r', "%0D")
            .replace('\n', "%0A");
        println!("::warning::{escaped}");
    } else {
        eprintln!("aviso: {message}");
    }
}

fn run_fetch(common: &CommonArgs, args: &FetchArgs) -> Result<()> {
    let cache = cache_dir(common);
    dex::ensure_downloaded(&cache, args.refresh_dex)?;
    limitless::fetch(
        &cache,
        &common.format,
        &limitless::FetchOptions {
            min_players: common.min_players,
            settle_days: args.settle_days,
            max_tournaments: args.max,
        },
    )?;
    // Los SP de Smogon son opcionales (sin ellos la web los estima): que no bloqueen el resto.
    if let Err(e) = smogon::fetch(&cache, &common.format) {
        warn(&format!(
            "Smogon no responde ({e:#}): se usan las estadísticas ya descargadas, si las hay"
        ));
    }
    Ok(())
}

fn data_dir(args: &BuildArgs) -> PathBuf {
    args.out
        .clone()
        .unwrap_or_else(|| repo_root().join("web/public/data"))
}

fn run_build(common: &CommonArgs, args: &BuildArgs) -> Result<()> {
    let cache = cache_dir(common);
    let format_dir = data_dir(args).join(&common.format);
    let dex = dex::Dex::load(&cache)?;
    let roster = roster::load(&cache, &dex)?;
    if let Some(roster) = &roster {
        println!(
            "Roster de Champions: {} Pokémon, {} objetos, {} movimientos",
            roster.species.len(),
            roster.items.len(),
            roster.moves.len()
        );
        limitless::write_atomic(
            &format_dir.join("roster.json"),
            serde_json::to_string(roster)?,
        )?;
    }
    // Nombres traducidos para la web (comunes a todos los formatos).
    i18n::build(&cache, &dex, roster.as_ref(), &data_dir(args))?;
    aggregate::build(
        &cache_dir(common),
        &repo_root().join("pipeline/aliases.json"),
        &data_dir(args),
        &common.format,
        roster.as_ref(),
        &aggregate::BuildOptions {
            min_players: common.min_players,
            half_life_days: args.half_life_days,
            min_meta_overlap: args.min_meta_overlap,
            accept_drop: args.accept_drop,
        },
    )
}

fn run_sprites(common: &CommonArgs, build: &BuildArgs, args: &SpriteArgs) -> Result<()> {
    let out = args
        .sprites_out
        .clone()
        .unwrap_or_else(|| repo_root().join("web/public/sprites"));
    sprites::build(
        &cache_dir(common),
        &data_dir(build).join(&common.format),
        &out,
    )
}

fn cache_dir(common: &CommonArgs) -> PathBuf {
    common
        .cache
        .clone()
        .unwrap_or_else(|| repo_root().join("pipeline/cache"))
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Fetch { common, fetch } => run_fetch(&common, &fetch),
        Command::Build { common, build } => run_build(&common, &build),
        Command::Icons { logo } => icons::build(
            &logo.unwrap_or_else(|| repo_root().join("web/public/logo/Crustle.webp")),
            &repo_root().join("web/public"),
        ),
        Command::Sprites {
            common,
            build,
            sprites,
        } => run_sprites(&common, &build, &sprites),
        Command::Update {
            common,
            fetch,
            build,
            sprites,
        } => {
            run_fetch(&common, &fetch)?;
            run_build(&common, &build)?;
            run_sprites(&common, &build, &sprites)
        }
    }
}

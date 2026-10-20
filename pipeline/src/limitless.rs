//! Cliente de la API pública de Limitless y caché en disco de sus respuestas.
//!
//! La API permite 50 peticiones cada 5 minutos, así que todo lo descargado se guarda
//! y solo se piden los torneos nuevos.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::thread::sleep;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use regex::Regex;
use reqwest::blocking::Client as HttpClient;
use reqwest::header::HeaderMap;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

const BASE_URL: &str = "https://play.limitlesstcg.com/api";
const PAGE_SIZE: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tournament {
    pub id: String,
    pub name: String,
    pub date: String,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub players: u32,
}

impl Tournament {
    pub fn date(&self) -> Option<DateTime<Utc>> {
        DateTime::parse_from_rfc3339(&self.date)
            .ok()
            .map(|d| d.with_timezone(&Utc))
    }
}

#[derive(Debug, Deserialize)]
pub struct Standing {
    /// Usuario de Limitless (identificador estable).
    pub player: String,
    /// Nombre visible, que el jugador puede cambiar.
    #[serde(default)]
    pub name: Option<String>,
    /// En VGC es una lista de Pokémon; se deja como `Value` porque otros juegos usan otra forma.
    #[serde(default)]
    pub decklist: Option<serde_json::Value>,
    #[serde(default)]
    pub record: Option<Record>,
}

#[derive(Debug, Default, Clone, Copy, Deserialize)]
pub struct Record {
    #[serde(default)]
    pub wins: u32,
    #[serde(default)]
    pub losses: u32,
    #[serde(default)]
    pub ties: u32,
}

#[derive(Debug, Deserialize)]
pub struct DeckMon {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub item: Option<String>,
    #[serde(default)]
    pub ability: Option<String>,
    #[serde(default)]
    pub attacks: Option<Vec<String>>,
    #[serde(default)]
    pub nature: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Pairing {
    /// Usuario ganador, `0` en empate, `-1` en byes / sin resultado.
    #[serde(default)]
    pub winner: serde_json::Value,
    #[serde(default)]
    pub player1: Option<String>,
    #[serde(default)]
    pub player2: Option<String>,
}

// ---------------------------------------------------------------------------
// Filtro de torneos
// ---------------------------------------------------------------------------

/// Variantes que comparten código de formato en Limitless pero no son el VGC estándar.
static EXCLUDED_NAME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(mono\s?-?types?|uu|nu|ru|lc|little\s?cup|draft|randoms?|anything\s?goes)\b")
        .unwrap()
});
static REGULATION_IN_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bM-([A-Z])\b").unwrap());

/// Devuelve por qué un torneo no debe usarse, o `None` si es válido.
pub fn exclusion_reason(t: &Tournament, format: &str, min_players: u32) -> Option<String> {
    if t.format.as_deref() != Some(format) {
        return Some(format!("formato {:?}", t.format));
    }
    if t.players < min_players {
        return Some(format!("menos de {min_players} jugadores"));
    }
    if let Some(m) = EXCLUDED_NAME.find(&t.name) {
        return Some(format!("variante en el nombre ({})", m.as_str()));
    }
    // Organizadores que etiquetan mal el formato: "Reg M-C" publicado como M-B, etc.
    let format_letter = format.strip_prefix("M-").map(str::to_ascii_uppercase);
    if let Some(letter) = format_letter {
        for cap in REGULATION_IN_NAME.captures_iter(&t.name) {
            if cap[1].to_ascii_uppercase() != letter {
                return Some(format!("el nombre indica otra regulación (M-{})", &cap[1]));
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Caché en disco
// ---------------------------------------------------------------------------

pub struct Cache {
    root: PathBuf,
}

impl Cache {
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.join("limitless"),
        }
    }

    fn list_path(&self, format: &str) -> PathBuf {
        self.root.join(format!("tournaments-{format}.json"))
    }

    fn tournament_dir(&self, id: &str) -> PathBuf {
        self.root.join(id)
    }

    /// `pairings.json` se escribe en último lugar, así que su presencia marca el torneo como completo.
    pub fn is_complete(&self, id: &str) -> bool {
        self.tournament_dir(id).join("pairings.json").exists()
    }

    pub fn load_list(&self, format: &str) -> Result<Vec<Tournament>> {
        read_json(&self.list_path(format))
    }

    pub fn load_standings(&self, id: &str) -> Result<Vec<Standing>> {
        read_json(&self.tournament_dir(id).join("standings.json"))
    }

    pub fn load_pairings(&self, id: &str) -> Result<Vec<Pairing>> {
        read_json(&self.tournament_dir(id).join("pairings.json"))
    }
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T> {
    let text = fs::read_to_string(path).with_context(|| format!("leyendo {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parseando {}", path.display()))
}

/// Escribe en un temporal y renombra, para no dejar ficheros a medias si se interrumpe.
pub fn write_atomic(path: &Path, contents: impl AsRef<[u8]>) -> Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Cliente HTTP con control del rate limit
// ---------------------------------------------------------------------------

struct Client {
    http: HttpClient,
}

impl Client {
    fn new() -> Result<Self> {
        let http = HttpClient::builder()
            .user_agent("kRustle-pipeline (+https://github.com/David-Nahuel/kRustle)")
            .timeout(Duration::from_secs(60))
            .build()?;
        Ok(Self { http })
    }

    fn get(&self, path: &str) -> Result<String> {
        let url = format!("{BASE_URL}{path}");
        for _ in 0..5 {
            let resp = self
                .http
                .get(&url)
                .send()
                .with_context(|| format!("GET {url}"))?;
            let (remaining, reset) = parse_rate_limit(resp.headers());
            if resp.status().as_u16() == 429 {
                wait_for_reset(reset.unwrap_or(60));
                continue;
            }
            let body = resp
                .error_for_status()
                .with_context(|| format!("GET {url}"))?
                .text()?;
            if remaining == Some(0) {
                wait_for_reset(reset.unwrap_or(60));
            }
            return Ok(body);
        }
        bail!("GET {url}: demasiados reintentos por rate limit")
    }
}

/// Cabecera con la forma `RateLimit: "50-in-5min"; r=46; t=253` (restantes, segundos hasta el reset).
fn parse_rate_limit(headers: &HeaderMap) -> (Option<u64>, Option<u64>) {
    let Some(value) = headers.get("ratelimit").and_then(|v| v.to_str().ok()) else {
        return (None, None);
    };
    let mut remaining = None;
    let mut reset = None;
    for part in value.split(';').map(str::trim) {
        if let Some(v) = part.strip_prefix("r=") {
            remaining = v.parse().ok();
        } else if let Some(v) = part.strip_prefix("t=") {
            reset = v.parse().ok();
        }
    }
    (remaining, reset)
}

fn wait_for_reset(seconds: u64) {
    eprintln!("  · rate limit agotado, esperando {}s", seconds + 1);
    sleep(Duration::from_secs(seconds + 1));
}

// ---------------------------------------------------------------------------
// Comando fetch
// ---------------------------------------------------------------------------

pub struct FetchOptions {
    pub min_players: u32,
    /// Días que deben pasar desde el inicio del torneo para darlo por terminado.
    pub settle_days: i64,
    pub max_tournaments: Option<usize>,
}

pub fn fetch(cache_root: &Path, format: &str, opts: &FetchOptions) -> Result<()> {
    let client = Client::new()?;
    let cache = Cache::new(cache_root);

    let mut list: Vec<Tournament> = Vec::new();
    for page in 1.. {
        let text = client.get(&format!(
            "/tournaments?game=VGC&format={format}&limit={PAGE_SIZE}&page={page}"
        ))?;
        let batch: Vec<Tournament> = serde_json::from_str(&text)?;
        let done = batch.len() < PAGE_SIZE;
        list.extend(batch);
        if done {
            break;
        }
    }
    write_atomic(&cache.list_path(format), &serde_json::to_string(&list)?)?;

    let now = Utc::now();
    let settled = |t: &Tournament| {
        t.date()
            .is_some_and(|d| (now - d).num_days() >= opts.settle_days)
    };
    let pending: Vec<&Tournament> = list
        .iter()
        .filter(|t| exclusion_reason(t, format, opts.min_players).is_none())
        .filter(|t| settled(t) && !cache.is_complete(&t.id))
        .take(opts.max_tournaments.unwrap_or(usize::MAX))
        .collect();

    println!(
        "{} torneos {format} en Limitless, {} por descargar",
        list.len(),
        pending.len()
    );

    for (i, t) in pending.iter().enumerate() {
        println!(
            "[{}/{}] {} ({} jugadores)",
            i + 1,
            pending.len(),
            t.name,
            t.players
        );
        let dir = cache.tournament_dir(&t.id);
        let standings = client.get(&format!("/tournaments/{}/standings", t.id))?;
        write_atomic(&dir.join("standings.json"), &standings)?;

        // Sin listas de equipos los emparejamientos no sirven: nos ahorramos la petición.
        let parsed: Vec<Standing> = serde_json::from_str(&standings)?;
        let pairings = if parsed.iter().any(|s| s.decklist.is_some()) {
            client.get(&format!("/tournaments/{}/pairings", t.id))?
        } else {
            "[]".to_string()
        };
        write_atomic(&dir.join("pairings.json"), &pairings)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tournament(name: &str, format: &str, players: u32) -> Tournament {
        Tournament {
            id: "x".into(),
            name: name.into(),
            date: "2026-10-01T00:00:00.000Z".into(),
            format: Some(format.into()),
            players,
        }
    }

    #[test]
    fn excludes_variants_and_mislabeled_tournaments() {
        let ok = |name: &str| exclusion_reason(&tournament(name, "M-C", 32), "M-C", 8).is_none();
        assert!(ok("Pokepal Smackdown #163 (Champions) (Reg M-C)"));
        assert!(ok("Stallcelth's Kick-off Tournament"));
        assert!(!ok("Copa Oak Stadium #12 - MonoType - R$ 50"));
        assert!(!ok("VGC UU Regulation M-C Kickoff"));
        assert!(!ok("Late Reg M-B Cup"));
        assert!(exclusion_reason(&tournament("Weekly", "M-B", 32), "M-C", 8).is_some());
        assert!(exclusion_reason(&tournament("Weekly", "M-C", 4), "M-C", 8).is_some());
    }

    #[test]
    fn parses_rate_limit_header() {
        let mut h = HeaderMap::new();
        h.insert("ratelimit", r#""50-in-5min"; r=46; t=253"#.parse().unwrap());
        assert_eq!(parse_rate_limit(&h), (Some(46), Some(253)));
        assert_eq!(parse_rate_limit(&HeaderMap::new()), (None, None));
    }
}

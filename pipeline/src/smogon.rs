//! Repartos de Stat Points a partir de las estadísticas mensuales de Smogon (ladder de Showdown).
//!
//! Limitless no publica los SP, pero Smogon sí, para cada especie y naturaleza. Se usan las
//! partidas Bo3 (las más parecidas a un torneo) y el ladder normal como respaldo para las
//! especies con poca muestra en Bo3.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use anyhow::{Context, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};

const STATS_URL: &str = "https://www.smogon.com/stats";
/// Corte de rating: filtra partidas de jugadores novatos sin perder demasiada muestra.
const CUTOFF: u32 = 1500;
/// Cuántos meses hacia atrás se busca el formato.
const MONTHS_TO_SEARCH: usize = 3;
/// Peso (en equipos) del ladder normal como "opinión previa" al combinarlo con Bo3.
const LADDER_PRIOR_TEAMS: f64 = 200.0;
/// Se ignoran especies con menos equipos que esto en ambas fuentes.
const MIN_TEAMS: f64 = 30.0;
const MIN_NATURE_SHARE: f64 = 0.02;
const MAX_SPREADS_PER_NATURE: usize = 15;
const SPREAD_COVERAGE: f64 = 0.9;

static MONTH_LINK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"href="(\d{4}-\d{2})/""#).unwrap());

/// Ficheros elegidos en la última descarga, para que `build` sepa cuáles leer.
#[derive(Debug, Serialize, Deserialize)]
struct Selection {
    month: String,
    bo3: Option<String>,
    ladder: Option<String>,
}

fn smogon_dir(cache_root: &Path) -> PathBuf {
    cache_root.join("smogon")
}

fn selection_path(cache_root: &Path, format: &str) -> PathBuf {
    smogon_dir(cache_root).join(format!("selection-{format}.json"))
}

/// "M-C" → expresión que reconoce `gen9championsvgc2026regmc[bo3]-1500.json`.
fn file_pattern(format: &str) -> Regex {
    let code = format.to_lowercase().replace('-', "");
    Regex::new(&format!(
        r#"href="(gen9championsvgc\d{{4}}reg{code}(bo3)?-{CUTOFF}\.json)""#
    ))
    .unwrap()
}

/// Busca el mes más reciente con estadísticas del formato y descarga lo que falte.
/// Si el formato aún no tiene estadísticas (regulación recién salida) no es un error.
pub fn fetch(cache_root: &Path, format: &str) -> Result<()> {
    let http = reqwest::blocking::Client::new();
    let get =
        |url: &str| -> Result<String> { Ok(http.get(url).send()?.error_for_status()?.text()?) };

    let index = get(&format!("{STATS_URL}/"))?;
    let mut months: Vec<&str> = MONTH_LINK
        .captures_iter(&index)
        .map(|c| c.get(1).unwrap().as_str())
        .collect();
    months.sort_unstable_by(|a, b| b.cmp(a));

    let pattern = file_pattern(format);
    for month in months.into_iter().take(MONTHS_TO_SEARCH) {
        let listing = get(&format!("{STATS_URL}/{month}/chaos/"))?;
        let mut selection = Selection {
            month: month.to_string(),
            bo3: None,
            ladder: None,
        };
        for cap in pattern.captures_iter(&listing) {
            let file = cap[1].to_string();
            if cap.get(2).is_some() {
                selection.bo3 = Some(file);
            } else {
                selection.ladder = Some(file);
            }
        }
        if selection.bo3.is_none() && selection.ladder.is_none() {
            continue;
        }

        for file in selection.bo3.iter().chain(&selection.ladder) {
            let path = smogon_dir(cache_root).join(month).join(file);
            if path.exists() {
                continue;
            }
            println!("Descargando estadísticas de Smogon: {month}/{file}");
            let body = get(&format!("{STATS_URL}/{month}/chaos/{file}"))?;
            crate::limitless::write_atomic(&path, &body)?;
        }
        crate::limitless::write_atomic(
            &selection_path(cache_root, format),
            &serde_json::to_string_pretty(&selection)?,
        )?;
        return Ok(());
    }
    println!("Smogon aún no tiene estadísticas de {format}: se usarán SP estimados");
    Ok(())
}

// ---------------------------------------------------------------------------
// Construcción de spreads.json
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct Chaos {
    info: ChaosInfo,
    data: HashMap<String, ChaosSpecies>,
}

#[derive(Deserialize)]
struct ChaosInfo {
    #[serde(rename = "number of battles")]
    battles: u64,
}

#[derive(Deserialize)]
struct ChaosSpecies {
    #[serde(rename = "Raw count")]
    raw_count: f64,
    #[serde(rename = "Spreads", default)]
    spreads: HashMap<String, f64>,
}

/// SP en el orden de Showdown: PS / Atq / Def / AtEsp / DefEsp / Vel.
type Sps = [u8; 6];

#[derive(Serialize)]
pub struct SpreadsFile {
    source: Source,
    /// Forma de combate (las megas van aparte, p. ej. "Garchomp-Mega-Z") → naturalezas.
    species: BTreeMap<String, Vec<NatureSpreads>>,
}

impl SpreadsFile {
    pub fn month(&self) -> &str {
        &self.source.month
    }
}

#[derive(Serialize)]
struct Source {
    month: String,
    files: Vec<String>,
    battles: u64,
}

#[derive(Serialize)]
struct NatureSpreads {
    nature: String,
    /// Proporción de la especie que usa esta naturaleza.
    share: f64,
    /// Repartos más comunes con esta naturaleza; probabilidades normalizadas dentro de ella.
    spreads: Vec<(Sps, f64)>,
}

/// `None` si nunca se descargaron estadísticas para el formato.
pub fn build(cache_root: &Path, format: &str) -> Result<Option<SpreadsFile>> {
    let path = selection_path(cache_root, format);
    if !path.exists() {
        return Ok(None);
    }
    let selection: Selection = serde_json::from_str(&fs::read_to_string(&path)?)?;
    let load = |file: &Option<String>| -> Result<Option<Chaos>> {
        let Some(file) = file else { return Ok(None) };
        let path = smogon_dir(cache_root).join(&selection.month).join(file);
        let text =
            fs::read_to_string(&path).with_context(|| format!("leyendo {}", path.display()))?;
        Ok(Some(serde_json::from_str(&text).with_context(|| {
            format!("parseando {}", path.display())
        })?))
    };
    let bo3 = load(&selection.bo3)?;
    let ladder = load(&selection.ladder)?;

    let mut names: Vec<&String> = bo3
        .iter()
        .chain(&ladder)
        .flat_map(|c| c.data.keys())
        .collect();
    names.sort();
    names.dedup();

    let mut species = BTreeMap::new();
    for name in names {
        if let Some(natures) = combine(entry(&bo3, name), entry(&ladder, name)) {
            species.insert(name.clone(), natures);
        }
    }

    Ok(Some(SpreadsFile {
        source: Source {
            month: selection.month.clone(),
            files: selection
                .bo3
                .iter()
                .chain(&selection.ladder)
                .cloned()
                .collect(),
            battles: bo3.iter().chain(&ladder).map(|c| c.info.battles).sum(),
        },
        species,
    }))
}

fn entry<'a>(chaos: &'a Option<Chaos>, name: &str) -> Option<&'a ChaosSpecies> {
    chaos.as_ref().and_then(|c| c.data.get(name))
}

/// Mezcla Bo3 y ladder: `p = (n·p_bo3 + K·p_ladder) / (n + K)`, con `n` los equipos de la
/// especie en Bo3. Con mucha muestra en Bo3 manda Bo3; con poca, el ladder.
fn combine(
    bo3: Option<&ChaosSpecies>,
    ladder: Option<&ChaosSpecies>,
) -> Option<Vec<NatureSpreads>> {
    let teams = bo3
        .map_or(0.0, |s| s.raw_count)
        .max(ladder.map_or(0.0, |s| s.raw_count));
    if teams < MIN_TEAMS {
        return None;
    }
    let p_bo3 = bo3.map(|s| normalize(&s.spreads)).unwrap_or_default();
    let p_ladder = ladder.map(|s| normalize(&s.spreads)).unwrap_or_default();
    let (w_bo3, w_ladder) = match (p_bo3.is_empty(), p_ladder.is_empty()) {
        (true, true) => return None,
        (false, true) => (1.0, 0.0),
        (true, false) => (0.0, 1.0),
        (false, false) => {
            let n = bo3.map_or(0.0, |s| s.raw_count);
            (
                n / (n + LADDER_PRIOR_TEAMS),
                LADDER_PRIOR_TEAMS / (n + LADDER_PRIOR_TEAMS),
            )
        }
    };

    let mut by_nature: HashMap<String, HashMap<Sps, f64>> = HashMap::new();
    for (key, p) in p_bo3
        .iter()
        .map(|(k, p)| (k, p * w_bo3))
        .chain(p_ladder.iter().map(|(k, p)| (k, p * w_ladder)))
    {
        if let Some((nature, sps)) = parse_spread(key) {
            *by_nature.entry(nature).or_default().entry(sps).or_default() += p;
        }
    }

    let mut natures: Vec<NatureSpreads> = by_nature
        .into_iter()
        .filter_map(|(nature, spreads)| {
            let share: f64 = spreads.values().sum();
            if share < MIN_NATURE_SHARE {
                return None;
            }
            let mut sorted: Vec<(Sps, f64)> =
                spreads.into_iter().map(|(s, p)| (s, p / share)).collect();
            sorted.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
            let mut kept = Vec::new();
            let mut covered = 0.0;
            for (sps, p) in sorted {
                if covered >= SPREAD_COVERAGE || kept.len() >= MAX_SPREADS_PER_NATURE {
                    break;
                }
                covered += p;
                kept.push((sps, p));
            }
            let spreads = kept
                .into_iter()
                .map(|(s, p)| (s, round4(p / covered)))
                .collect();
            Some(NatureSpreads {
                nature,
                share,
                spreads,
            })
        })
        .collect();
    let total_share: f64 = natures.iter().map(|n| n.share).sum();
    for n in &mut natures {
        n.share = round4(n.share / total_share);
    }
    natures.sort_by(|a, b| {
        b.share
            .total_cmp(&a.share)
            .then_with(|| a.nature.cmp(&b.nature))
    });
    Some(natures)
}

fn normalize(spreads: &HashMap<String, f64>) -> HashMap<String, f64> {
    let total: f64 = spreads.values().sum();
    if total <= 0.0 {
        return HashMap::new();
    }
    spreads
        .iter()
        .map(|(k, v)| (k.clone(), v / total))
        .collect()
}

/// `"Jolly:2/32/0/0/0/32"` → `("Jolly", [2, 32, 0, 0, 0, 32])`.
fn parse_spread(key: &str) -> Option<(String, Sps)> {
    let (nature, stats) = key.split_once(':')?;
    let values: Vec<u8> = stats
        .split('/')
        .map(|v| v.parse().ok())
        .collect::<Option<_>>()?;
    Some((nature.to_string(), values.try_into().ok()?))
}

fn round4(x: f64) -> f64 {
    (x * 10_000.0).round() / 10_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn species(raw_count: f64, spreads: &[(&str, f64)]) -> ChaosSpecies {
        ChaosSpecies {
            raw_count,
            spreads: spreads.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        }
    }

    #[test]
    fn finds_bo3_and_ladder_files_for_the_format() {
        let listing = r#"<a href="gen9championsvgc2026regmc-1500.json"> <a href="gen9championsvgc2026regmcbo3-1500.json">
            <a href="gen9championsvgc2026regmc-1630.json"> <a href="gen9championsvgc2026regmb-1500.json">"#;
        let found: Vec<(String, bool)> = file_pattern("M-C")
            .captures_iter(listing)
            .map(|c| (c[1].to_string(), c.get(2).is_some()))
            .collect();
        assert_eq!(
            found,
            [
                ("gen9championsvgc2026regmc-1500.json".to_string(), false),
                ("gen9championsvgc2026regmcbo3-1500.json".to_string(), true),
            ]
        );
    }

    #[test]
    fn parses_spread_keys() {
        assert_eq!(
            parse_spread("Jolly:2/32/0/0/0/32"),
            Some(("Jolly".into(), [2, 32, 0, 0, 0, 32]))
        );
        assert_eq!(parse_spread("Jolly:2/32/0"), None);
        assert_eq!(parse_spread("basura"), None);
    }

    #[test]
    fn groups_by_nature_and_trusts_bo3_when_it_has_sample() {
        let bo3 = species(
            10_000.0,
            &[
                ("Jolly:2/32/0/0/0/32", 60.0),
                ("Adamant:2/32/0/0/0/32", 40.0),
            ],
        );
        let ladder = species(100_000.0, &[("Adamant:32/32/0/0/2/0", 100.0)]);
        let natures = combine(Some(&bo3), Some(&ladder)).unwrap();
        assert_eq!(natures[0].nature, "Jolly");
        assert!((natures[0].share - 0.59).abs() < 0.01);
        let adamant = &natures[1];
        assert_eq!(adamant.spreads[0].0, [2, 32, 0, 0, 0, 32]);
        let total: f64 = adamant.spreads.iter().map(|s| s.1).sum();
        assert!((total - 1.0).abs() < 1e-3);
    }

    #[test]
    fn falls_back_to_ladder_and_drops_tiny_samples() {
        let ladder = species(500.0, &[("Bold:32/0/32/0/2/0", 1.0)]);
        let natures = combine(None, Some(&ladder)).unwrap();
        assert_eq!(natures[0].spreads, vec![([32, 0, 32, 0, 2, 0], 1.0)]);
        assert!(combine(Some(&species(5.0, &[("Bold:32/0/32/0/2/0", 1.0)])), None).is_none());
    }
}

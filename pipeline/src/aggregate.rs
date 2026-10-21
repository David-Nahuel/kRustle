//! Convierte la caché de Limitless en los JSON estáticos que consume la web:
//!
//! - `meta.json`  — resumen de la muestra.
//! - `usage.json` — por especie: uso, winrate y distribución de objetos, habilidades,
//!   naturalezas, movimientos y compañeros (ponderado por recencia y rendimiento).
//! - `teams.json` — todos los equipos y enfrentamientos en formato compacto, para que la web
//!   pueda inferir sets condicionados al equipo rival concreto.
//! - `spreads.json` — repartos de Stat Points por especie y naturaleza (ver `smogon.rs`).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use anyhow::{Result, bail};
use chrono::Utc;
use serde::Serialize;
use serde_json::Value;

use crate::dex::{Aliases, Dex, Kind, Normalizer};
use crate::limitless::{self, Cache, DeckMon, Record, Tournament};
use crate::roster::Roster;

pub struct BuildOptions {
    pub min_players: u32,
    /// Un equipo de hace `half_life_days` días pesa la mitad que uno de hoy.
    pub half_life_days: f64,
    /// Proporción mínima de Pokémon del top del formato que deben usar, de media, los equipos
    /// de un torneo para no considerarlo temático (ver `drop_off_meta`).
    pub min_meta_overlap: f64,
    /// Publica aunque la muestra haya caído más de `MAX_TEAM_DROP` respecto a la build anterior.
    pub accept_drop: bool,
}

/// Cuántas especies forman el "top" con el que se mide si un torneo es temático.
const TOP_SPECIES: usize = 30;

/// Los equipos se acumulan a lo largo del formato, así que una caída mayor que esta respecto a la
/// build anterior apunta a un problema (respuestas raras de Limitless, caché a medias, un fallo en
/// la normalización) y no se publica.
const MAX_TEAM_DROP: f64 = 0.25;

#[derive(Clone, PartialEq, Eq, Hash)]
struct Set {
    species: String,
    item: Option<String>,
    ability: Option<String>,
    nature: Option<String>,
    /// Ordenados, para que dos sets iguales con distinto orden de movimientos se deduplican.
    moves: Vec<String>,
}

struct Team {
    tournament: usize,
    /// Usuario de Limitless en minúsculas y nombre visible.
    player: String,
    player_name: String,
    record: Record,
    sets: Vec<Set>,
    weight: f64,
}

/// Resultado: 1 gana `a`, 2 gana `b`, 0 empate.
struct Match {
    a: usize,
    b: usize,
    result: u8,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    tournaments_used: usize,
    tournaments_pending_download: usize,
    tournaments_without_teams: usize,
    tournaments_off_meta: usize,
    teams_used: usize,
    matches_used: usize,
    dropped_teams: BTreeMap<String, u32>,
    unresolved_names: Vec<(String, u32)>,
    fuzzy_corrections: BTreeMap<String, String>,
    excluded_tournaments: BTreeMap<String, String>,
    /// Especie → sets de equipos usados que la llevan sin estar en el roster legal.
    species_not_in_roster: BTreeMap<String, u32>,
    /// "item: Assault Vest" → veces que se ha quitado de un set por no existir en Champions.
    not_in_champions: BTreeMap<String, u32>,
}

pub fn build(
    cache_root: &Path,
    aliases_path: &Path,
    out_root: &Path,
    format: &str,
    roster: Option<&Roster>,
    opts: &BuildOptions,
) -> Result<()> {
    let dex = Dex::load(cache_root)?;
    let mut norm = Normalizer::new(&dex, Aliases::load(aliases_path)?);
    let cache = Cache::new(cache_root);
    let mut report = Report::default();

    let list = cache.load_list(format)?;
    let mut candidates: Vec<&Tournament> = Vec::new();
    for t in &list {
        if let Some(reason) = limitless::exclusion_reason(t, format, opts.min_players) {
            report
                .excluded_tournaments
                .insert(format!("{} [{}]", t.name, t.id), reason);
        } else if cache.is_complete(&t.id) {
            candidates.push(t);
        } else {
            report.tournaments_pending_download += 1;
        }
    }
    candidates.sort_by(|a, b| a.date.cmp(&b.date));

    let now = Utc::now();
    let mut tournaments: Vec<&Tournament> = Vec::new();
    let mut teams: Vec<Team> = Vec::new();
    let mut matches: Vec<Match> = Vec::new();

    for t in candidates {
        let age_days = t
            .date()
            .map(|d| (now - d).num_seconds() as f64 / 86_400.0)
            .unwrap_or(0.0)
            .max(0.0);

        let mut team_of_player: HashMap<String, usize> = HashMap::new();
        for s in cache.load_standings(&t.id)? {
            let Some(decklist) = &s.decklist else {
                continue;
            };
            match parse_team(decklist, &mut norm) {
                Ok(sets) => {
                    let record = s.record.unwrap_or_default();
                    let player = s.player.to_lowercase();
                    team_of_player.insert(player.clone(), teams.len());
                    teams.push(Team {
                        tournament: tournaments.len(),
                        player_name: s.name.clone().unwrap_or_else(|| s.player.clone()),
                        player,
                        record,
                        sets,
                        weight: team_weight(age_days, opts.half_life_days, record),
                    });
                }
                Err(reason) => *report.dropped_teams.entry(reason).or_default() += 1,
            }
        }
        if team_of_player.is_empty() {
            report.tournaments_without_teams += 1;
            continue;
        }

        for p in cache.load_pairings(&t.id)? {
            let (Some(p1), Some(p2)) = (&p.player1, &p.player2) else {
                continue;
            };
            let (Some(&a), Some(&b)) = (
                team_of_player.get(&p1.to_lowercase()),
                team_of_player.get(&p2.to_lowercase()),
            ) else {
                continue;
            };
            let result = match &p.winner {
                Value::String(w) if w.eq_ignore_ascii_case(p1) => 1,
                Value::String(w) if w.eq_ignore_ascii_case(p2) => 2,
                Value::Number(n) if n.as_i64() == Some(0) => 0,
                _ => continue,
            };
            matches.push(Match { a, b, result });
        }
        tournaments.push(t);
    }

    for (t, overlap) in drop_off_meta(
        &mut tournaments,
        &mut teams,
        &mut matches,
        opts.min_meta_overlap,
    ) {
        report.excluded_tournaments.insert(
            format!("{} [{}]", t.name, t.id),
            format!("metajuego atípico ({overlap:.2} de media en el top {TOP_SPECIES})"),
        );
        report.tournaments_off_meta += 1;
    }

    // Una especie fuera del roster suele ser una forma mal etiquetada en Limitless ("Floette" por
    // "Floette-Eternal"): en la web no se encuentra al buscarla y la calculadora no la conoce.
    // Objetos, habilidades y movimientos que no existen en Champions o que la especie no puede
    // llevar (Assault Vest, Moongeist Beam...) son errores al escribir el equipo o correcciones
    // aproximadas que dieron con un nombre real de otro juego: se quitan del set.
    if let Some(roster) = roster {
        let legal: HashSet<&str> = roster.species.iter().map(|s| s.name.as_str()).collect();
        let legal_items: HashSet<&str> = roster.items.iter().map(String::as_str).collect();
        let legal_moves: HashSet<&str> = roster.moves.keys().map(String::as_str).collect();
        let mut discard = |name: String| *report.not_in_champions.entry(name).or_default() += 1;
        for set in teams.iter_mut().flat_map(|t| &mut t.sets) {
            if !legal.contains(set.species.as_str()) {
                *report
                    .species_not_in_roster
                    .entry(set.species.clone())
                    .or_default() += 1;
                continue;
            }
            let illegal_item = |item: &str| !legal_items.is_empty() && !legal_items.contains(item);
            if set.item.as_deref().is_some_and(illegal_item) {
                discard(format!("item: {}", set.item.take().unwrap_or_default()));
            }
            let illegal_ability =
                |a: &str| !dex.allows_ability(&set.species, set.item.as_deref(), a);
            if set.ability.as_deref().is_some_and(illegal_ability) {
                let ability = set.ability.take().unwrap_or_default();
                discard(format!("ability: {ability} ({})", set.species));
            }
            if !legal_moves.is_empty() {
                set.moves.retain(|m| {
                    let ok = legal_moves.contains(m.as_str());
                    if !ok {
                        discard(format!("move: {m}"));
                    }
                    ok
                });
            }
        }
        if !report.species_not_in_roster.is_empty() {
            let list: Vec<String> = report
                .species_not_in_roster
                .iter()
                .map(|(species, n)| format!("{species} ({n})"))
                .collect();
            crate::warn(&format!(
                "especies fuera del roster de Champions (¿falta un alias en aliases.json?): {}",
                list.join(", ")
            ));
        }
    }

    report.tournaments_used = tournaments.len();
    report.teams_used = teams.len();
    report.matches_used = matches.len();

    // Antes de escribir nada: si la muestra no es fiable, se queda la versión publicada.
    let report_path = cache_root.join(format!("report-{format}.json"));
    let previous_teams = previous_teams(&report_path);
    check_sample(format, previous_teams, teams.len(), opts.accept_drop)?;

    let out_dir = out_root.join(format);
    let usage = usage_stats(&teams, &matches);
    limitless::write_atomic(&out_dir.join("usage.json"), &serde_json::to_string(&usage)?)?;
    let teams_file = TeamsFile::new(&tournaments, &teams, &matches);
    limitless::write_atomic(
        &out_dir.join("teams.json"),
        &serde_json::to_string(&teams_file)?,
    )?;

    let spreads = crate::smogon::build(cache_root, format)?;
    if let Some(spreads) = &spreads {
        limitless::write_atomic(
            &out_dir.join("spreads.json"),
            &serde_json::to_string(spreads)?,
        )?;
    }

    let meta = serde_json::json!({
        "format": format,
        "generatedAt": now.to_rfc3339(),
        "halfLifeDays": opts.half_life_days,
        "tournaments": tournaments.len(),
        "teams": teams.len(),
        "matches": matches.len(),
        "firstDate": tournaments.first().map(|t| &t.date),
        "lastDate": tournaments.last().map(|t| &t.date),
        "spreadsMonth": spreads.as_ref().map(|s| s.month()),
    });
    limitless::write_atomic(
        &out_dir.join("meta.json"),
        &serde_json::to_string_pretty(&meta)?,
    )?;
    // La web lee aquí qué formato cargar: el último construido es el vigente.
    limitless::write_atomic(
        &out_root.join("index.json"),
        &serde_json::to_string_pretty(&serde_json::json!({ "current": format }))?,
    )?;

    let mut unresolved: Vec<(String, u32)> = norm.unresolved.into_iter().collect();
    unresolved.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    report.unresolved_names = unresolved;
    report.fuzzy_corrections = norm.fuzzy;
    limitless::write_atomic(&report_path, &serde_json::to_string_pretty(&report)?)?;
    write_step_summary(format, &report, previous_teams)?;

    println!(
        "{format}: {} torneos, {} equipos, {} enfrentamientos → {}",
        report.tournaments_used,
        report.teams_used,
        report.matches_used,
        out_dir.display()
    );
    if report.tournaments_off_meta > 0 {
        println!(
            "  {} torneos temáticos descartados (metajuego atípico)",
            report.tournaments_off_meta
        );
    }
    if report.tournaments_pending_download > 0 {
        println!(
            "  {} torneos válidos aún sin descargar",
            report.tournaments_pending_download
        );
    }
    for (reason, n) in &report.dropped_teams {
        println!("  descartados: {n} equipos ({reason})");
    }
    println!(
        "  {} correcciones aproximadas, {} nombres sin resolver (detalle en {})",
        report.fuzzy_corrections.len(),
        report.unresolved_names.len(),
        report_path.display()
    );
    for (name, n) in report.unresolved_names.iter().take(10) {
        println!("    {n:>5}× {name}");
    }
    Ok(())
}

/// Peso de un equipo: lo reciente y lo que gana cuenta más. La web lo recalcula igual
/// (`teamWeight` en `web/src/engine/metagame.ts`); `team-weight-cases.json` comprueba que coinciden.
fn team_weight(age_days: f64, half_life_days: f64, record: Record) -> f64 {
    let recency = 0.5f64.powf(age_days / half_life_days);
    // Laplace: un 0-0 cuenta como 50%, así un buen resultado pesa más sin anular al resto.
    let win_rate = (record.wins as f64 + 1.0) / ((record.wins + record.losses) as f64 + 2.0);
    recency * (0.5 + win_rate)
}

/// Equipos de la build anterior del formato, según su informe (si lo hay).
fn previous_teams(report_path: &Path) -> Option<usize> {
    let text = std::fs::read_to_string(report_path).ok()?;
    let report: Value = serde_json::from_str(&text).ok()?;
    report.get("teamsUsed")?.as_u64().map(|n| n as usize)
}

/// Falla si la muestra está vacía o ha caído demasiado respecto a la build anterior.
fn check_sample(
    format: &str,
    previous: Option<usize>,
    teams: usize,
    accept_drop: bool,
) -> Result<()> {
    if teams == 0 {
        bail!(
            "{format}: no hay ningún equipo con el que generar los datos \
             (¿formato sin torneos todavía o caché vacía?)"
        );
    }
    if let Some(previous) = previous
        && !accept_drop
        && (teams as f64) < previous as f64 * (1.0 - MAX_TEAM_DROP)
    {
        bail!(
            "{format}: {teams} equipos frente a {previous} en la build anterior. \
             Si la caída es correcta, repite con --accept-drop \
             (en GitHub, lanza el workflow a mano marcando \"Aceptar caída de datos\")"
        );
    }
    Ok(())
}

/// En GitHub Actions, un resumen de la muestra en la página de la ejecución, con los nombres
/// que no se han podido resolver para ir completando `aliases.json` sin abrir la caché.
fn write_step_summary(format: &str, report: &Report, previous_teams: Option<usize>) -> Result<()> {
    let Some(path) = std::env::var_os("GITHUB_STEP_SUMMARY") else {
        return Ok(());
    };
    let previous = previous_teams.map_or(String::new(), |n| format!(" (antes: {n})"));
    let mut md = format!(
        "### Datos {format}\n\n\
         - Torneos: {} ({} pendientes de descarga, {} temáticos descartados, {} sin equipos)\n\
         - Equipos: {}{previous}\n\
         - Enfrentamientos: {}\n\
         - Equipos descartados: {}\n\
         - Correcciones aproximadas: {}\n\
         - Nombres quitados por no existir en Champions: {}\n",
        report.tournaments_used,
        report.tournaments_pending_download,
        report.tournaments_off_meta,
        report.tournaments_without_teams,
        report.teams_used,
        report.matches_used,
        report.dropped_teams.values().sum::<u32>(),
        report.fuzzy_corrections.len(),
        report.not_in_champions.values().sum::<u32>(),
    );
    if !report.species_not_in_roster.is_empty() {
        md += "\n**Especies fuera del roster** (¿falta un alias de especie?):\n\n";
        for (species, n) in &report.species_not_in_roster {
            md += &format!("- {n}× `{species}`\n");
        }
    }
    if !report.unresolved_names.is_empty() {
        md += &format!(
            "\n**Nombres sin resolver** ({}; los frecuentes van a `pipeline/aliases.json`):\n\n",
            report.unresolved_names.len()
        );
        for (name, n) in report.unresolved_names.iter().take(15) {
            md += &format!("- {n}× `{name}`\n");
        }
    }
    md += "\n";
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    std::io::Write::write_all(&mut file, md.as_bytes())?;
    Ok(())
}

/// Torneos temáticos ("Off Meta", "solo 3.ª gen"...) que Limitless publica con el mismo código de
/// formato. Detectarlos por el nombre no escala, así que se detectan por los datos: sus equipos
/// apenas usan los Pokémon habituales. Los quita y reindexa equipos y enfrentamientos.
fn drop_off_meta<'a>(
    tournaments: &mut Vec<&'a Tournament>,
    teams: &mut Vec<Team>,
    matches: &mut Vec<Match>,
    min_overlap: f64,
) -> Vec<(&'a Tournament, f64)> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for team in teams.iter() {
        for set in &team.sets {
            *counts.entry(&set.species).or_default() += 1;
        }
    }
    let mut ranked: Vec<(&str, usize)> = counts.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    let top: HashSet<String> = ranked
        .iter()
        .take(TOP_SPECIES)
        .map(|(s, _)| s.to_string())
        .collect();

    let mut sum = vec![0.0; tournaments.len()];
    let mut count = vec![0usize; tournaments.len()];
    for team in teams.iter() {
        let in_top = team
            .sets
            .iter()
            .filter(|s| top.contains(&s.species))
            .count();
        sum[team.tournament] += in_top as f64 / team.sets.len() as f64;
        count[team.tournament] += 1;
    }
    let overlap: Vec<f64> = sum
        .iter()
        .zip(&count)
        .map(|(s, &n)| s / n.max(1) as f64)
        .collect();
    if overlap.iter().all(|&o| o >= min_overlap) {
        return Vec::new();
    }

    let mut excluded = Vec::new();
    let mut new_tournament = vec![None; tournaments.len()];
    let mut kept_tournaments = Vec::new();
    for (i, t) in tournaments.iter().enumerate() {
        if overlap[i] >= min_overlap {
            new_tournament[i] = Some(kept_tournaments.len());
            kept_tournaments.push(*t);
        } else {
            excluded.push((*t, overlap[i]));
        }
    }

    let mut new_team = vec![None; teams.len()];
    let mut kept_teams = Vec::new();
    for (i, mut team) in std::mem::take(teams).into_iter().enumerate() {
        if let Some(t) = new_tournament[team.tournament] {
            team.tournament = t;
            new_team[i] = Some(kept_teams.len());
            kept_teams.push(team);
        }
    }
    // Los dos equipos de un enfrentamiento son del mismo torneo: o se quedan ambos o ninguno.
    matches.retain_mut(|m| match (new_team[m.a], new_team[m.b]) {
        (Some(a), Some(b)) => {
            m.a = a;
            m.b = b;
            true
        }
        _ => false,
    });

    *tournaments = kept_tournaments;
    *teams = kept_teams;
    excluded
}

fn parse_team(decklist: &Value, norm: &mut Normalizer) -> Result<Vec<Set>, String> {
    let mons: Vec<DeckMon> = serde_json::from_value(decklist.clone())
        .map_err(|_| "lista con formato desconocido".to_string())?;
    if mons.len() != 6 {
        return Err(format!("equipo de {} Pokémon", mons.len()));
    }
    let mut seen = HashSet::new();
    let mut sets = Vec::with_capacity(6);
    for m in mons {
        let species = norm
            .species(m.id.as_deref(), &m.name)
            .ok_or_else(|| "especie desconocida".to_string())?;
        if !seen.insert(species.clone()) {
            return Err("especie repetida".to_string());
        }
        let mut moves: Vec<String> = m
            .attacks
            .unwrap_or_default()
            .iter()
            .filter_map(|a| norm.name(Kind::Move, a))
            .collect();
        moves.sort();
        moves.dedup();
        sets.push(Set {
            species,
            item: m.item.as_deref().and_then(|s| norm.name(Kind::Item, s)),
            ability: m
                .ability
                .as_deref()
                .and_then(|s| norm.name(Kind::Ability, s)),
            nature: m.nature.as_deref().and_then(|s| norm.name(Kind::Nature, s)),
            moves,
        });
    }
    Ok(sets)
}

// ---------------------------------------------------------------------------
// usage.json
// ---------------------------------------------------------------------------

/// `[nombre, proporción]`. Para movimientos la proporción es "sets que lo llevan",
/// así que suman ~4; para el resto suman ≤ 1.
type Shares = Vec<(String, f64)>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeciesUsage {
    species: String,
    /// Equipos que lo llevan (sin ponderar).
    teams: u32,
    /// Proporción ponderada de equipos que lo llevan.
    usage: f64,
    /// Enfrentamientos sin mirror en los que estaba en el equipo.
    games: u32,
    win_rate: Option<f64>,
    items: Shares,
    abilities: Shares,
    natures: Shares,
    moves: Shares,
    teammates: Shares,
}

#[derive(Default)]
struct Acc {
    teams: u32,
    weight: f64,
    games: u32,
    points: f64,
    items: HashMap<String, f64>,
    abilities: HashMap<String, f64>,
    natures: HashMap<String, f64>,
    moves: HashMap<String, f64>,
    teammates: HashMap<String, f64>,
}

fn usage_stats(teams: &[Team], matches: &[Match]) -> Vec<SpeciesUsage> {
    let mut acc: HashMap<&str, Acc> = HashMap::new();
    let total_weight: f64 = teams.iter().map(|t| t.weight).sum();

    for team in teams {
        let w = team.weight;
        for set in &team.sets {
            let a = acc.entry(&set.species).or_default();
            a.teams += 1;
            a.weight += w;
            for (map, value) in [
                (&mut a.items, &set.item),
                (&mut a.abilities, &set.ability),
                (&mut a.natures, &set.nature),
            ] {
                if let Some(v) = value {
                    *map.entry(v.clone()).or_default() += w;
                }
            }
            for m in &set.moves {
                *a.moves.entry(m.clone()).or_default() += w;
            }
            for mate in team.sets.iter().filter(|s| s.species != set.species) {
                *a.teammates.entry(mate.species.clone()).or_default() += w;
            }
        }
    }

    for m in matches {
        let species_a: HashSet<&str> = teams[m.a].sets.iter().map(|s| s.species.as_str()).collect();
        let species_b: HashSet<&str> = teams[m.b].sets.iter().map(|s| s.species.as_str()).collect();
        let points_a = match m.result {
            1 => 1.0,
            2 => 0.0,
            _ => 0.5,
        };
        for (mine, theirs, points) in [
            (&species_a, &species_b, points_a),
            (&species_b, &species_a, 1.0 - points_a),
        ] {
            for s in mine.difference(theirs) {
                let a = acc
                    .get_mut(s)
                    .expect("especie contada al recorrer los equipos");
                a.games += 1;
                a.points += points;
            }
        }
    }

    let mut out: Vec<SpeciesUsage> = acc
        .into_iter()
        .map(|(species, a)| SpeciesUsage {
            species: species.to_string(),
            teams: a.teams,
            usage: round4(a.weight / total_weight),
            games: a.games,
            win_rate: (a.games > 0).then(|| round4(a.points / a.games as f64)),
            items: top(&a.items, a.weight, 12),
            abilities: top(&a.abilities, a.weight, 4),
            natures: top(&a.natures, a.weight, 8),
            moves: top(&a.moves, a.weight, 24),
            teammates: top(&a.teammates, a.weight, 20),
        })
        .collect();
    out.sort_by(|a, b| {
        b.usage
            .total_cmp(&a.usage)
            .then_with(|| a.species.cmp(&b.species))
    });
    out
}

fn top(map: &HashMap<String, f64>, total: f64, n: usize) -> Shares {
    let mut v: Vec<(&String, &f64)> = map.iter().collect();
    v.sort_by(|a, b| b.1.total_cmp(a.1).then_with(|| a.0.cmp(b.0)));
    v.into_iter()
        .take(n)
        .map(|(k, x)| (k.clone(), round4(x / total)))
        .filter(|(_, share)| *share > 0.0)
        .collect()
}

fn round4(x: f64) -> f64 {
    (x * 10_000.0).round() / 10_000.0
}

// ---------------------------------------------------------------------------
// teams.json
// ---------------------------------------------------------------------------

/// `[especie, objeto, habilidad, naturaleza, [movimientos]]` como índices a las tablas de nombres.
type SetRow = (u32, Option<u32>, Option<u32>, Option<u32>, Vec<u32>);

/// Formato compacto: los nombres van en tablas y todo lo demás son índices a ellas.
///
/// - `sets[i]`    = `[especie, objeto, habilidad, naturaleza, [movimientos]]` (null si se desconoce)
/// - `teams[i]`   = `[torneo, victorias, derrotas, empates, set1, …, set6]`
/// - `matches[i]` = `[equipoA, equipoB, resultado]` con resultado 1 = gana A, 2 = gana B, 0 = empate
/// - `teamPlayers[i]` = índice en `players` del jugador que llevó `teams[i]`
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TeamsFile {
    species: Vec<String>,
    items: Vec<String>,
    abilities: Vec<String>,
    natures: Vec<String>,
    moves: Vec<String>,
    sets: Vec<SetRow>,
    tournaments: Vec<TournamentOut>,
    teams: Vec<Vec<u32>>,
    matches: Vec<(u32, u32, u8)>,
    players: Vec<PlayerOut>,
    team_players: Vec<u32>,
}

#[derive(Serialize)]
struct PlayerOut {
    /// Usuario de Limitless en minúsculas.
    id: String,
    /// Último nombre visible usado.
    name: String,
}

#[derive(Serialize)]
struct TournamentOut {
    id: String,
    name: String,
    date: String,
    players: u32,
}

#[derive(Default)]
struct Interner {
    names: Vec<String>,
    index: HashMap<String, u32>,
}

impl Interner {
    fn get(&mut self, name: &str) -> u32 {
        if let Some(&i) = self.index.get(name) {
            return i;
        }
        let i = self.names.len() as u32;
        self.names.push(name.to_string());
        self.index.insert(name.to_string(), i);
        i
    }
}

impl TeamsFile {
    fn new(tournaments: &[&Tournament], teams: &[Team], matches: &[Match]) -> Self {
        let (mut species, mut items, mut abilities, mut natures, mut moves) = Default::default();
        let mut set_index: HashMap<&Set, u32> = HashMap::new();
        let mut sets = Vec::new();
        let mut teams_out = Vec::with_capacity(teams.len());
        let mut players: Vec<PlayerOut> = Vec::new();
        let mut player_index: HashMap<&str, u32> = HashMap::new();
        let mut team_players = Vec::with_capacity(teams.len());

        for team in teams {
            let p = *player_index.entry(&team.player).or_insert_with(|| {
                players.push(PlayerOut {
                    id: team.player.clone(),
                    name: String::new(),
                });
                players.len() as u32 - 1
            });
            // Los equipos van por fecha: el último nombre visto es el más actual.
            players[p as usize].name = team.player_name.clone();
            team_players.push(p);

            let mut row = vec![
                team.tournament as u32,
                team.record.wins,
                team.record.losses,
                team.record.ties,
            ];
            for set in &team.sets {
                let idx = *set_index.entry(set).or_insert_with(|| {
                    sets.push((
                        Interner::get(&mut species, &set.species),
                        set.item.as_deref().map(|s| Interner::get(&mut items, s)),
                        set.ability
                            .as_deref()
                            .map(|s| Interner::get(&mut abilities, s)),
                        set.nature
                            .as_deref()
                            .map(|s| Interner::get(&mut natures, s)),
                        set.moves
                            .iter()
                            .map(|m| Interner::get(&mut moves, m))
                            .collect(),
                    ));
                    sets.len() as u32 - 1
                });
                row.push(idx);
            }
            teams_out.push(row);
        }

        let names = |i: Interner| i.names;
        Self {
            species: names(species),
            items: names(items),
            abilities: names(abilities),
            natures: names(natures),
            moves: names(moves),
            sets,
            tournaments: tournaments
                .iter()
                .map(|t| TournamentOut {
                    id: t.id.clone(),
                    name: t.name.clone(),
                    date: t.date.clone(),
                    players: t.players,
                })
                .collect(),
            teams: teams_out,
            matches: matches
                .iter()
                .map(|m| (m.a as u32, m.b as u32, m.result))
                .collect(),
            players,
            team_players,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tournament(id: &str) -> Tournament {
        Tournament {
            id: id.into(),
            name: id.into(),
            date: "2026-10-01T00:00:00Z".into(),
            format: Some("M-C".into()),
            players: 8,
        }
    }

    fn team(tournament: usize, species: &[&str]) -> Team {
        Team {
            tournament,
            player: format!("p{tournament}"),
            player_name: String::new(),
            record: Record::default(),
            weight: 1.0,
            sets: species
                .iter()
                .map(|s| Set {
                    species: s.to_string(),
                    item: None,
                    ability: None,
                    nature: None,
                    moves: Vec::new(),
                })
                .collect(),
        }
    }

    #[test]
    fn team_weight_matches_shared_cases() {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Case {
            age_days: f64,
            half_life_days: f64,
            wins: u32,
            losses: u32,
            weight: f64,
        }
        #[derive(serde::Deserialize)]
        struct Cases {
            cases: Vec<Case>,
        }
        let file: Cases = serde_json::from_str(include_str!("../team-weight-cases.json")).unwrap();
        for c in file.cases {
            let record = Record {
                wins: c.wins,
                losses: c.losses,
                ties: 0,
            };
            let weight = team_weight(c.age_days, c.half_life_days, record);
            assert!(
                (weight - c.weight).abs() < 1e-6,
                "{} días, {}-{}: {weight} en lugar de {}",
                c.age_days,
                c.wins,
                c.losses,
                c.weight
            );
        }
    }

    #[test]
    fn rejects_empty_or_shrunken_samples() {
        assert!(check_sample("M-C", None, 0, true).is_err());
        assert!(check_sample("M-C", None, 50, false).is_ok());
        assert!(check_sample("M-C", Some(1000), 1100, false).is_ok());
        assert!(check_sample("M-C", Some(1000), 800, false).is_ok());
        assert!(check_sample("M-C", Some(1000), 700, false).is_err());
        assert!(check_sample("M-C", Some(1000), 700, true).is_ok());
    }

    #[test]
    fn drops_themed_tournaments_and_reindexes() {
        let normal = tournament("normal");
        let themed = tournament("themed");
        let later = tournament("later");
        let mut tournaments = vec![&normal, &themed, &later];
        // Con 30 especies distintas en el top, las del torneo temático deben quedarse fuera.
        let meta: Vec<String> = (0..30).map(|i| format!("Meta{i}")).collect();
        let meta: Vec<&str> = meta.iter().map(String::as_str).collect();
        let mut teams = Vec::new();
        for chunk in meta.chunks(6) {
            teams.push(team(0, chunk));
            teams.push(team(0, chunk));
            teams.push(team(2, chunk));
        }
        teams.push(team(
            1,
            &["Rare1", "Rare2", "Rare3", "Rare4", "Rare5", "Rare6"],
        ));
        teams.push(team(
            1,
            &["Rare1", "Rare2", "Rare3", "Rare4", "Rare5", "Rare6"],
        ));
        let themed_a = teams.len() - 2;
        let later_team = 2;
        let mut matches = vec![
            Match {
                a: 0,
                b: 1,
                result: 1,
            },
            Match {
                a: themed_a,
                b: themed_a + 1,
                result: 2,
            },
            Match {
                a: later_team,
                b: later_team + 3,
                result: 0,
            },
        ];

        let excluded = drop_off_meta(&mut tournaments, &mut teams, &mut matches, 0.55);

        assert_eq!(excluded.len(), 1);
        assert_eq!(excluded[0].0.id, "themed");
        assert_eq!(
            tournaments
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            ["normal", "later"]
        );
        assert_eq!(teams.len(), 15);
        assert!(teams.iter().all(|t| t.tournament < 2));
        assert_eq!(matches.len(), 2);
        // El enfrentamiento del torneo posterior apunta a los equipos reindexados.
        assert_eq!((matches[1].a, matches[1].b), (2, 5));
        assert_eq!(teams[2].tournament, 1);
    }
}

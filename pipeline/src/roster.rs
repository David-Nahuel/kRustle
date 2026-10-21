//! Pokémon y objetos legales en Champions, según el editor de equipos de Showdown
//! (`teambuilder-tables.js`, sección `champions`).
//!
//! Los Pokémon son las claves de sus `learnsets`: ya vienen sin megas ni formas que solo
//! existen en combate (Aegislash-Blade, Palafin-Hero...), es decir, lo que se ve en team preview.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::dex::Dex;

#[derive(Debug, Serialize, Deserialize)]
pub struct Roster {
    pub species: Vec<RosterSpecies>,
    /// Nombres de objetos, por orden alfabético. La posición de cada uno es la de su icono en
    /// la hoja `sprites/items.webp`.
    pub items: Vec<String>,
    /// Movimientos que puede aprender algún Pokémon legal, con lo que la calculadora de daño no
    /// trae (o trae incompleto): prioridad, objetivo y flags.
    #[serde(default)]
    pub moves: BTreeMap<String, MoveInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MoveInfo {
    #[serde(rename = "type")]
    pub kind: String,
    pub category: String,
    pub priority: i64,
    /// "normal", "self", "allySide", "allAdjacentFoes"... (como en Showdown).
    pub target: String,
    pub flags: Vec<String>,
}

/// Flags que usa la web (inmunidades y modificadores de prioridad).
const MOVE_FLAGS: [&str; 7] = [
    "powder",
    "heal",
    "sound",
    "bullet",
    "wind",
    "contact",
    "reflectable",
];

#[derive(Debug, Serialize, Deserialize)]
pub struct RosterSpecies {
    pub name: String,
    /// Id de sprite de Showdown ("rotom-wash").
    pub sprite: String,
    /// Todas sus habilidades: la calculadora de la web solo trae la primera.
    #[serde(default)]
    pub abilities: Vec<String>,
}

/// `None` si las tablas de Showdown no están en caché.
pub fn load(cache_root: &Path, dex: &Dex) -> Result<Option<Roster>> {
    let path = cache_root.join("dex/teambuilder-tables.js");
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path)?;
    let tables = parse_tables(&text).with_context(|| format!("parseando {}", path.display()))?;
    let champions = &tables["champions"];

    let mut species: Vec<RosterSpecies> = champions["learnsets"]
        .as_object()
        .context("sin learnsets de champions")?
        .keys()
        .filter_map(|id| {
            let name = dex.species_name(id)?;
            let sprite = dex.sprite_id(name)?;
            Some(RosterSpecies {
                name: name.to_string(),
                sprite: sprite.to_string(),
                abilities: dex.species_abilities(name).to_vec(),
            })
        })
        .collect();
    species.sort_by(|a, b| a.name.cmp(&b.name));

    // La lista de objetos mezcla ids con cabeceras de sección (`["header", "Popular items"]`).
    let mut items: Vec<String> = champions["items"]
        .as_array()
        .context("sin objetos de champions")?
        .iter()
        .filter_map(Value::as_str)
        .filter_map(|id| dex.item_name(id).map(str::to_string))
        .collect();
    items.sort();
    items.dedup();

    // Champions retoca algunos movimientos (potencia, tipo...): se aplican encima de Showdown.
    let overrides = champions["overrideMoveData"].as_object();
    let mut moves = BTreeMap::new();
    for learnset in champions["learnsets"]
        .as_object()
        .into_iter()
        .flat_map(|l| l.values())
    {
        for id in learnset.as_object().into_iter().flat_map(|m| m.keys()) {
            let Some((name, data)) = dex.move_data(id) else {
                continue;
            };
            if moves.contains_key(name) {
                continue;
            }
            let field = |key: &str| {
                overrides
                    .and_then(|o| o.get(id))
                    .and_then(|o| o.get(key))
                    .unwrap_or(&data[key])
            };
            moves.insert(
                name.to_string(),
                MoveInfo {
                    kind: field("type").as_str().unwrap_or("Normal").to_string(),
                    category: field("category").as_str().unwrap_or("Status").to_string(),
                    priority: field("priority").as_i64().unwrap_or(0),
                    target: field("target").as_str().unwrap_or("normal").to_string(),
                    flags: MOVE_FLAGS
                        .iter()
                        .filter(|f| data["flags"].get(**f).is_some())
                        .map(|f| f.to_string())
                        .collect(),
                },
            );
        }
    }

    Ok(Some(Roster {
        species,
        items,
        moves,
    }))
}

pub fn read(path: &Path) -> Result<Option<Roster>> {
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path)?;
    Ok(Some(serde_json::from_str(&text)?))
}

/// El fichero es `exports.BattleTeambuilderTable = JSON.parse('...');`: se extrae el JSON
/// sin ejecutar nada, deshaciendo los escapes del literal entre comillas simples.
fn parse_tables(text: &str) -> Result<Value> {
    let start = text.find("JSON.parse('").context("no hay JSON.parse")? + "JSON.parse('".len();
    let end = start + text[start..].find("');").context("JSON.parse sin cerrar")?;
    Ok(serde_json::from_str(&unescape_single_quoted(
        &text[start..end],
    ))?)
}

/// En un literal JS entre comillas simples, `\\` es `\` y `\'` es `'`; el resto de escapes
/// (`\"`, `\n`...) son también escapes válidos de JSON y se dejan como están.
fn unescape_single_quoted(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' && matches!(chars.peek(), Some('\\' | '\'')) {
            out.push(chars.next().unwrap());
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unescapes_only_backslash_and_quote() {
        assert_eq!(unescape_single_quoted(r#"a\'b\\c\"d"#), r#"a'b\c\"d"#);
    }

    #[test]
    fn extracts_tables_without_running_js() {
        let js = r#"exports.BattleTeambuilderTable = JSON.parse('{"champions":{"items":[["header","X"],"leftovers"],"name":"Farfetch\'d \\"q\\""}}');"#;
        let tables = parse_tables(js).unwrap();
        assert_eq!(tables["champions"]["items"][1], "leftovers");
        assert_eq!(tables["champions"]["name"], r#"Farfetch'd "q""#);
    }
}

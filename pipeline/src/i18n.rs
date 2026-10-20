//! Nombres oficiales de los datos en otros idiomas, para la web: movimientos, objetos,
//! habilidades, naturalezas y tipos. Los Pokémon se llaman igual en inglés y en español.
//!
//! Salen de las tablas de PokeAPI (las de Veekun), que dan cada nombre por idioma con un
//! identificador ("flare-blitz") que, sin guiones, es el id de Showdown ("flareblitz").
//! Lo que PokeAPI aún no tiene (lo nuevo de Champions) se queda sin traducir y la web lo
//! enseña en inglés.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use serde::Serialize;

use crate::dex::{Dex, to_id};
use crate::roster::Roster;

const POKEAPI: &str = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
/// Idiomas a los que se traduce (identificador de PokeAPI = nombre del fichero de salida).
const LANGUAGES: [&str; 1] = ["es"];

/// Cada tipo de dato: su tabla de identificadores y la de nombres por idioma.
const TABLES: [(Kind, &str, &str); 5] = [
    (Kind::Move, "moves", "move_names"),
    (Kind::Item, "items", "item_names"),
    (Kind::Ability, "abilities", "ability_names"),
    (Kind::Nature, "natures", "nature_names"),
    (Kind::Type, "types", "type_names"),
];

#[derive(Clone, Copy)]
enum Kind {
    Move,
    Item,
    Ability,
    Nature,
    Type,
}

/// Nombre en inglés (el de Showdown) → nombre en el idioma, por tipo de dato.
#[derive(Default, Serialize)]
pub struct Names {
    moves: BTreeMap<String, String>,
    items: BTreeMap<String, String>,
    abilities: BTreeMap<String, String>,
    natures: BTreeMap<String, String>,
    types: BTreeMap<String, String>,
}

/// Escribe `<out>/i18n/<idioma>.json`. Movimientos y objetos, solo los legales (si hay roster),
/// para que el fichero pese poco.
pub fn build(cache_root: &Path, dex: &Dex, roster: Option<&Roster>, out: &Path) -> Result<()> {
    let dir = cache_root.join("pokeapi");
    ensure_downloaded(&dir)?;
    let languages = read_csv(&dir.join("languages.csv"))?;
    let legal_moves: Option<HashSet<&str>> =
        roster.map(|r| r.moves.keys().map(String::as_str).collect());
    let legal_items: Option<HashSet<&str>> =
        roster.map(|r| r.items.iter().map(String::as_str).collect());

    for language in LANGUAGES {
        let language_id = languages
            .iter()
            .find(|row| row.get(1).map(String::as_str) == Some(language))
            .and_then(|row| row.first().cloned())
            .with_context(|| format!("PokeAPI no tiene el idioma {language}"))?;

        let mut names = Names::default();
        for (kind, table, names_table) in TABLES {
            // id de PokeAPI → identificador ("flare-blitz").
            let identifiers: HashMap<String, String> = read_csv(&dir.join(format!("{table}.csv")))?
                .into_iter()
                .filter_map(|row| Some((row.first()?.clone(), row.get(1)?.clone())))
                .collect();
            for row in read_csv(&dir.join(format!("{names_table}.csv")))? {
                let [id, lang, local, ..] = row.as_slice() else {
                    continue;
                };
                if *lang != language_id || local.is_empty() {
                    continue;
                }
                let Some(identifier) = identifiers.get(id) else {
                    continue;
                };
                let showdown_id = to_id(identifier);
                let (english, target) = match kind {
                    Kind::Move => (
                        dex.move_data(&showdown_id).map(|(name, _)| name),
                        &mut names.moves,
                    ),
                    Kind::Item => (dex.item_name(&showdown_id), &mut names.items),
                    Kind::Ability => (dex.ability_name(&showdown_id), &mut names.abilities),
                    Kind::Nature => (dex.nature_name(&showdown_id), &mut names.natures),
                    Kind::Type => (type_name(identifier), &mut names.types),
                };
                let Some(english) = english else { continue };
                let legal = match kind {
                    Kind::Move => legal_moves.as_ref().is_none_or(|l| l.contains(english)),
                    Kind::Item => legal_items.as_ref().is_none_or(|l| l.contains(english)),
                    _ => true,
                };
                if legal {
                    target.insert(english.to_string(), local.clone());
                }
            }
        }

        println!(
            "Nombres en {language}: {} movimientos, {} objetos, {} habilidades, {} naturalezas, {} tipos",
            names.moves.len(),
            names.items.len(),
            names.abilities.len(),
            names.natures.len(),
            names.types.len()
        );
        crate::limitless::write_atomic(
            &out.join("i18n").join(format!("{language}.json")),
            serde_json::to_string(&names)?,
        )?;
    }
    Ok(())
}

/// Los 18 tipos con su nombre de Showdown ("fire" → "Fire"); los que no se usan, fuera.
fn type_name(identifier: &str) -> Option<&'static str> {
    const TYPES: [&str; 18] = [
        "Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground",
        "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy",
    ];
    TYPES
        .into_iter()
        .find(|t| t.eq_ignore_ascii_case(identifier))
}

fn ensure_downloaded(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir)?;
    let http = reqwest::blocking::Client::new();
    let files = TABLES
        .iter()
        .flat_map(|(_, table, names)| [*table, *names])
        .chain(["languages"]);
    for file in files {
        let path = dir.join(format!("{file}.csv"));
        if path.exists() {
            continue;
        }
        println!("Descargando de PokeAPI: {file}.csv");
        let body = http
            .get(format!("{POKEAPI}/{file}.csv"))
            .send()?
            .error_for_status()?
            .bytes()?;
        crate::limitless::write_atomic(&path, &body)?;
    }
    Ok(())
}

/// Filas de un CSV sin la cabecera. Admite campos entre comillas (con comas o comillas dobles).
fn read_csv(path: &Path) -> Result<Vec<Vec<String>>> {
    let text = fs::read_to_string(path).with_context(|| format!("leyendo {}", path.display()))?;
    Ok(text.lines().skip(1).map(parse_csv_line).collect())
}

fn parse_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => fields.push(std::mem::take(&mut field)),
            _ => field.push(c),
        }
    }
    fields.push(field);
    fields
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_con_comillas() {
        assert_eq!(parse_csv_line("1,7,Puño Fuego"), ["1", "7", "Puño Fuego"]);
        assert_eq!(
            parse_csv_line(r#"2,7,"Bola, ""rara""",x"#),
            ["2", "7", r#"Bola, "rara""#, "x"]
        );
    }

    #[test]
    fn tipos_por_identificador() {
        assert_eq!(type_name("fire"), Some("Fire"));
        assert_eq!(type_name("shadow"), None);
    }
}

//! Diccionario canónico (datos de Pokémon Showdown) y normalización de los nombres
//! escritos a mano en Limitless ("Rock Slides", "Darkest lariat"...).
//!
//! Se usan los nombres de Showdown porque son los mismos que espera `@smogon/calc` en la web,
//! y los `id` de Limitless (`rotom-wash`) coinciden con los de Showdown quitando guiones.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::Value;

const SHOWDOWN: &str = "https://play.pokemonshowdown.com";
/// Ficheros de Showdown que se guardan en `cache/dex` (ruta en Showdown, nombre local).
const FILES: [(&str, &str); 6] = [
    ("data/pokedex.json", "pokedex.json"),
    ("data/moves.json", "moves.json"),
    ("data/items.js", "items.js"),
    ("data/abilities.js", "abilities.js"),
    // Pokémon y objetos legales de cada formato, según el editor de equipos (ver roster.rs).
    ("data/teambuilder-tables.js", "teambuilder-tables.js"),
    // Todos los iconos de objetos en una hoja de 24×24 px; `spritenum` de items.js es su posición.
    ("sprites/itemicons-sheet.png", "itemicons-sheet.png"),
];

pub const NATURES: [&str; 25] = [
    "Adamant", "Bashful", "Bold", "Brave", "Calm", "Careful", "Docile", "Gentle", "Hardy", "Hasty",
    "Impish", "Jolly", "Lax", "Lonely", "Mild", "Modest", "Naive", "Naughty", "Quiet", "Quirky",
    "Rash", "Relaxed", "Sassy", "Serious", "Timid",
];

/// Equivalente al `toID` de Showdown.
pub fn to_id(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'é' | 'É' => 'e',
            c => c.to_ascii_lowercase(),
        })
        .filter(char::is_ascii_alphanumeric)
        .collect()
}

/// Descarga los ficheros del dex que falten (o todos con `refresh`).
pub fn ensure_downloaded(cache_root: &Path, refresh: bool) -> Result<()> {
    let dir = cache_root.join("dex");
    fs::create_dir_all(&dir)?;
    let http = reqwest::blocking::Client::new();
    for (remote, file) in FILES {
        let path = dir.join(file);
        if path.exists() && !refresh {
            continue;
        }
        println!("Descargando de Showdown: {remote}");
        let body = http
            .get(format!("{SHOWDOWN}/{remote}"))
            .send()?
            .error_for_status()?
            .bytes()?;
        crate::limitless::write_atomic(&path, &body)?;
    }
    Ok(())
}

pub struct Dex {
    /// id → nombre que se ve en team preview (las megas cuentan como su especie base).
    species: HashMap<String, String>,
    /// Nombre en team preview → id de sprite de Showdown ("Rotom-Wash" → "rotom-wash").
    sprite_ids: HashMap<String, String>,
    /// Nombre en team preview → sus habilidades (la normal, la segunda y la oculta).
    species_abilities: HashMap<String, Vec<String>>,
    /// Piedra → habilidades de la mega en la que se convierte ("Charizardite Y" → Drought).
    stone_abilities: HashMap<String, Vec<String>>,
    moves: HashMap<String, String>,
    /// id de movimiento → datos completos de Showdown (prioridad, objetivo, flags...).
    move_data: HashMap<String, Value>,
    items: HashMap<String, String>,
    /// id de objeto → posición de su icono en `itemicons-sheet.png`.
    item_icons: HashMap<String, u32>,
    abilities: HashMap<String, String>,
    natures: HashMap<String, String>,
}

impl Dex {
    pub fn load(cache_root: &Path) -> Result<Self> {
        let dir = cache_root.join("dex");
        let pokedex = read_object(&dir.join("pokedex.json"), false)?;
        let items = read_object(&dir.join("items.js"), true)?;
        let moves = read_object(&dir.join("moves.json"), false)?;
        let mut species = HashMap::new();
        let mut sprite_ids = HashMap::new();
        let mut species_abilities = HashMap::new();
        let mut stone_abilities = HashMap::new();
        let mut megas = Vec::new();
        // `{"0": ..., "1": ..., "H": ...}`: las claves ordenadas dan ese mismo orden.
        let abilities_of = |v: &Value| -> Vec<String> {
            v["abilities"]
                .as_object()
                .into_iter()
                .flat_map(|a| a.values().filter_map(Value::as_str).map(str::to_string))
                .collect()
        };
        for (id, v) in pokedex.into_iter().filter(|(_, v)| !is_fake(v)) {
            let Some(name) = v["name"].as_str() else {
                continue;
            };
            let forme = v["forme"].as_str().unwrap_or("");
            let base = v["baseSpecies"].as_str();
            if forme.contains("Mega") || forme == "Primal" {
                if let Some(stone) = v["requiredItem"].as_str() {
                    stone_abilities.insert(stone.to_string(), abilities_of(&v));
                }
                megas.push((id, name.to_string(), base.unwrap_or(name).to_string()));
            } else {
                sprite_ids.insert(name.to_string(), sprite_id(name, base, forme));
                species_abilities.insert(name.to_string(), abilities_of(&v));
                species.insert(id, name.to_string());
            }
        }
        // La forma base de una mega solo vale si existe: "Meowstic-M-Mega" → "Meowstic".
        for (id, name, base) in megas {
            let preview = preview_of_mega(&name);
            let preview = if sprite_ids.contains_key(preview) {
                preview
            } else {
                &base
            };
            species.insert(id, preview.to_string());
        }

        Ok(Self {
            species,
            sprite_ids,
            species_abilities,
            stone_abilities,
            moves: names(moves.clone()),
            move_data: moves.into_iter().collect(),
            items: names(items.clone()),
            item_icons: items
                .iter()
                .filter_map(|(id, v)| Some((id.clone(), v["spritenum"].as_u64()? as u32)))
                .collect(),
            abilities: names(read_object(&dir.join("abilities.js"), true)?),
            natures: NATURES.iter().map(|n| (to_id(n), n.to_string())).collect(),
        })
    }
}

impl Dex {
    /// Especie tal y como se ve en team preview, a partir de cualquier forma ("Garchomp-Mega-Z").
    pub fn preview_name(&self, name: &str) -> Option<&str> {
        self.species.get(&to_id(name)).map(String::as_str)
    }

    pub fn sprite_id(&self, preview_name: &str) -> Option<&str> {
        self.sprite_ids.get(preview_name).map(String::as_str)
    }

    /// Habilidades de una especie de team preview (la calculadora solo trae la primera).
    pub fn species_abilities(&self, preview_name: &str) -> &[String] {
        self.species_abilities
            .get(preview_name)
            .map_or(&[], Vec::as_slice)
    }

    /// Si un set puede llevar esa habilidad: una de la especie o, con su piedra, de la mega (en
    /// las hojas de equipo se suele apuntar la de la mega: Drought en Charizard con Charizardite Y).
    /// Sin datos de la especie no se descarta nada.
    pub fn allows_ability(&self, preview_name: &str, item: Option<&str>, ability: &str) -> bool {
        let own = self.species_abilities(preview_name);
        let mega = item
            .and_then(|i| self.stone_abilities.get(i))
            .map_or(&[][..], Vec::as_slice);
        own.is_empty() || own.iter().chain(mega).any(|a| a == ability)
    }

    /// Nombre de una especie por su id de Showdown (sin pasar a especie base).
    pub fn species_name(&self, id: &str) -> Option<&str> {
        self.sprite_ids
            .keys()
            .find(|name| to_id(name) == id)
            .map(String::as_str)
    }

    pub fn item_name(&self, id: &str) -> Option<&str> {
        self.items.get(id).map(String::as_str)
    }

    pub fn item_icon(&self, id: &str) -> Option<u32> {
        self.item_icons.get(id).copied()
    }

    /// Nombre y datos de Showdown de un movimiento, por su id.
    pub fn move_data(&self, id: &str) -> Option<(&str, &Value)> {
        Some((self.moves.get(id)?.as_str(), self.move_data.get(id)?))
    }

    pub fn ability_name(&self, id: &str) -> Option<&str> {
        self.abilities.get(id).map(String::as_str)
    }

    pub fn nature_name(&self, id: &str) -> Option<&str> {
        self.natures.get(id).map(String::as_str)
    }
}

/// La forma base de una mega es lo que va antes de "-Mega"/"-Primal":
/// "Charizard-Mega-X" → "Charizard", pero "Meowstic-F-Mega" → "Meowstic-F".
fn preview_of_mega(name: &str) -> &str {
    name.find("-Mega")
        .or_else(|| name.find("-Primal"))
        .map_or(name, |i| &name[..i])
}

/// Id de sprite de Showdown: especie base y forma separadas por guion ("rotom-wash").
fn sprite_id(name: &str, base: Option<&str>, forme: &str) -> String {
    match base {
        Some(base) if !forme.is_empty() => format!("{}-{}", to_id(base), to_id(forme)),
        _ => to_id(name),
    }
}

/// Lee un objeto `{id: {...}}`. Los `.js` de Showdown son literales JS (`exports.X = {...};`),
/// que se pueden parsear como JSON5.
fn read_object(path: &Path, is_js: bool) -> Result<serde_json::Map<String, Value>> {
    let text = fs::read_to_string(path).with_context(|| format!("leyendo {}", path.display()))?;
    let value: Value = if is_js {
        let start = text.find('{').context("objeto JS sin '{'")?;
        let end = text.rfind('}').context("objeto JS sin '}'")?;
        json5::from_str(&text[start..=end]).map_err(anyhow::Error::from)
    } else {
        serde_json::from_str(&text).map_err(anyhow::Error::from)
    }
    .with_context(|| format!("parseando {}", path.display()))?;
    match value {
        Value::Object(map) => Ok(map),
        _ => anyhow::bail!("{} no es un objeto", path.display()),
    }
}

/// Entradas de CAP y similares, que nunca aparecen en juego oficial.
fn is_fake(v: &Value) -> bool {
    matches!(v["isNonstandard"].as_str(), Some("CAP" | "Custom"))
}

fn names(map: serde_json::Map<String, Value>) -> HashMap<String, String> {
    map.into_iter()
        .filter(|(_, v)| !is_fake(v))
        .filter_map(|(id, v)| Some((id, v["name"].as_str()?.to_string())))
        .collect()
}

// ---------------------------------------------------------------------------
// Normalizador
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Kind {
    Species,
    Move,
    Item,
    Ability,
    Nature,
}

impl Kind {
    fn label(self) -> &'static str {
        match self {
            Kind::Species => "species",
            Kind::Move => "move",
            Kind::Item => "item",
            Kind::Ability => "ability",
            Kind::Nature => "nature",
        }
    }
}

/// Correcciones manuales (`pipeline/aliases.json`) para lo que la búsqueda aproximada no resuelve.
#[derive(Debug, Default, Deserialize)]
pub struct Aliases {
    #[serde(default)]
    species: HashMap<String, String>,
    #[serde(default)]
    moves: HashMap<String, String>,
    #[serde(default)]
    items: HashMap<String, String>,
    #[serde(default)]
    abilities: HashMap<String, String>,
}

impl Aliases {
    pub fn load(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let text = fs::read_to_string(path)?;
        serde_json::from_str(&text).with_context(|| format!("parseando {}", path.display()))
    }

    fn get(&self, kind: Kind, id: &str) -> Option<String> {
        let table = match kind {
            Kind::Species => &self.species,
            Kind::Move => &self.moves,
            Kind::Item => &self.items,
            Kind::Ability => &self.abilities,
            Kind::Nature => return None,
        };
        table
            .iter()
            .find(|(k, _)| to_id(k) == id)
            .map(|(_, v)| to_id(v))
    }
}

pub struct Normalizer<'a> {
    dex: &'a Dex,
    aliases: Aliases,
    memo: HashMap<(Kind, String), Option<String>>,
    /// "kind: texto original" → veces que no se pudo resolver.
    pub unresolved: BTreeMap<String, u32>,
    /// "kind: texto original" → nombre elegido por búsqueda aproximada.
    pub fuzzy: BTreeMap<String, String>,
}

impl<'a> Normalizer<'a> {
    pub fn new(dex: &'a Dex, aliases: Aliases) -> Self {
        Self {
            dex,
            aliases,
            memo: HashMap::new(),
            unresolved: BTreeMap::new(),
            fuzzy: BTreeMap::new(),
        }
    }

    /// Devuelve la especie tal y como se ve en team preview.
    pub fn species(&mut self, limitless_id: Option<&str>, name: &str) -> Option<String> {
        // El id de Limitless es más fiable que el nombre ("rotom-wash" frente a "Wash Rotom").
        let raw = limitless_id.filter(|s| !s.is_empty()).unwrap_or(name);
        let id = self.resolve(Kind::Species, raw)?;
        Some(self.dex.species[&id].clone())
    }

    pub fn name(&mut self, kind: Kind, raw: &str) -> Option<String> {
        let id = self.resolve(kind, raw)?;
        Some(self.table(kind)[&id].clone())
    }

    fn table(&self, kind: Kind) -> &'a HashMap<String, String> {
        match kind {
            Kind::Move => &self.dex.moves,
            Kind::Item => &self.dex.items,
            Kind::Ability => &self.dex.abilities,
            Kind::Nature => &self.dex.natures,
            Kind::Species => unreachable!("las especies tienen su propia tabla"),
        }
    }

    fn contains(&self, kind: Kind, id: &str) -> bool {
        match kind {
            Kind::Species => self.dex.species.contains_key(id),
            _ => self.table(kind).contains_key(id),
        }
    }

    /// Devuelve el id canónico del dex.
    fn resolve(&mut self, kind: Kind, raw: &str) -> Option<String> {
        let id = to_id(raw);
        // Formas de decir "nada" que no son errores de escritura.
        if matches!(
            id.as_str(),
            "" | "none" | "noitem" | "nohelditem" | "noobject" | "noability" | "nothing"
        ) {
            return None;
        }
        if let Some(hit) = self.memo.get(&(kind, id.clone())) {
            if hit.is_none() {
                *self
                    .unresolved
                    .entry(format!("{}: {raw}", kind.label()))
                    .or_default() += 1;
            }
            return hit.clone();
        }

        let found = if let Some(alias) = self
            .aliases
            .get(kind, &id)
            .filter(|a| self.contains(kind, a))
        {
            Some(alias)
        } else if self.contains(kind, &id) {
            Some(id.clone())
        } else {
            let guess = self.fuzzy_match(kind, &id);
            if let Some(g) = &guess {
                self.fuzzy
                    .insert(format!("{}: {raw}", kind.label()), g.clone());
            }
            guess
        };

        if found.is_none() {
            *self
                .unresolved
                .entry(format!("{}: {raw}", kind.label()))
                .or_default() += 1;
        }
        self.memo.insert((kind, id), found.clone());
        found
    }

    /// Distancia de edición pequeña y sin empates: corrige erratas ("rockslides") sin
    /// inventarse coincidencias entre nombres cortos.
    fn fuzzy_match(&self, kind: Kind, id: &str) -> Option<String> {
        if id.len() < 5 {
            return None;
        }
        let max_distance = if id.len() >= 10 { 2 } else { 1 };
        let keys: Box<dyn Iterator<Item = &String>> = match kind {
            Kind::Species => Box::new(self.dex.species.keys()),
            _ => Box::new(self.table(kind).keys()),
        };
        let mut best: Option<(usize, &String)> = None;
        let mut tie = false;
        for key in keys {
            let d = strsim::levenshtein(id, key);
            if d > max_distance {
                continue;
            }
            match best {
                Some((bd, _)) if d > bd => {}
                Some((bd, _)) if d == bd => tie = true,
                _ => {
                    best = Some((d, key));
                    tie = false;
                }
            }
        }
        best.filter(|_| !tie).map(|(_, k)| k.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dex() -> Dex {
        let table = |names: &[&str]| names.iter().map(|n| (to_id(n), n.to_string())).collect();
        Dex {
            species: [
                ("rotomwash", "Rotom-Wash"),
                ("charizardmegay", "Charizard"),
                ("charizard", "Charizard"),
            ]
            .into_iter()
            .map(|(id, name)| (id.to_string(), name.to_string()))
            .collect(),
            sprite_ids: HashMap::new(),
            species_abilities: HashMap::new(),
            stone_abilities: HashMap::new(),
            item_icons: HashMap::new(),
            move_data: HashMap::new(),
            moves: table(&[
                "Rock Slide",
                "Helping Hand",
                "Darkest Lariat",
                "Protect",
                "Swords Dance",
            ]),
            items: table(&["Sitrus Berry", "Choice Scarf"]),
            abilities: table(&["Technician", "Intimidate"]),
            natures: table(&NATURES),
        }
    }

    #[test]
    fn megas_keep_their_base_forme() {
        assert_eq!(preview_of_mega("Charizard-Mega-X"), "Charizard");
        assert_eq!(preview_of_mega("Garchomp-Mega-Z"), "Garchomp");
        assert_eq!(preview_of_mega("Meowstic-F-Mega"), "Meowstic-F");
        assert_eq!(preview_of_mega("Groudon-Primal"), "Groudon");
    }

    #[test]
    fn sprite_ids_match_showdown() {
        assert_eq!(sprite_id("Garchomp", None, ""), "garchomp");
        assert_eq!(sprite_id("Rotom-Wash", Some("Rotom"), "Wash"), "rotom-wash");
        assert_eq!(sprite_id("Kommo-o", None, ""), "kommoo");
        assert_eq!(
            sprite_id("Tauros-Paldea-Combat", Some("Tauros"), "Paldea-Combat"),
            "tauros-paldeacombat"
        );
    }

    #[test]
    fn to_id_matches_showdown() {
        assert_eq!(to_id("Rotom-Wash"), "rotomwash");
        assert_eq!(to_id("Flabébé"), "flabebe");
        assert_eq!(to_id("Indeedee ♀"), "indeedee");
    }

    #[test]
    fn resolves_typos_and_case() {
        let dex = dex();
        let mut n = Normalizer::new(&dex, Aliases::default());
        assert_eq!(
            n.name(Kind::Move, "Darkest lariat").as_deref(),
            Some("Darkest Lariat")
        );
        assert_eq!(
            n.name(Kind::Move, "Rock Slides").as_deref(),
            Some("Rock Slide")
        );
        assert_eq!(
            n.name(Kind::Move, "helping hands").as_deref(),
            Some("Helping Hand")
        );
        assert_eq!(
            n.name(Kind::Item, "Citrus Berry").as_deref(),
            Some("Sitrus Berry")
        );
        assert_eq!(n.name(Kind::Nature, "Jelly").as_deref(), Some("Jolly"));
        assert!(n.unresolved.is_empty());
    }

    #[test]
    fn species_use_limitless_id_and_collapse_megas() {
        let dex = dex();
        let mut n = Normalizer::new(&dex, Aliases::default());
        assert_eq!(
            n.species(Some("rotom-wash"), "Wash Rotom").as_deref(),
            Some("Rotom-Wash")
        );
        assert_eq!(
            n.species(None, "Charizard-Mega-Y").as_deref(),
            Some("Charizard")
        );
    }

    #[test]
    fn short_or_ambiguous_names_stay_unresolved() {
        let dex = dex();
        let mut n = Normalizer::new(&dex, Aliases::default());
        assert_eq!(n.name(Kind::Ability, "Technical"), None);
        assert_eq!(n.name(Kind::Move, "Prot"), None);
        assert_eq!(n.unresolved.len(), 2);
    }

    #[test]
    fn aliases_and_empty_values() {
        let dex = dex();
        let aliases: Aliases =
            serde_json::from_str(r#"{"abilities": {"Technical": "Technician"}}"#).unwrap();
        let mut n = Normalizer::new(&dex, aliases);
        assert_eq!(
            n.name(Kind::Ability, "technical").as_deref(),
            Some("Technician")
        );
        assert_eq!(n.name(Kind::Item, "No-Item"), None);
        assert!(n.unresolved.is_empty());
    }
}

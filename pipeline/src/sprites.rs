//! Sprites propios para la web: así no se carga el servidor de Showdown en cada visita y la
//! app funciona sin conexión.
//!
//! - Pokémon: se descargan una vez (a la caché) los sprites HOME de Showdown de cada Pokémon legal
//!   (`roster.json`) y se guardan reducidos a 128 px en WebP (~5 KB cada uno).
//! - Objetos: los iconos de los objetos legales se recortan de la hoja de Showdown y se juntan en
//!   una sola imagen, `items.webp`, en el mismo orden que `roster.json`.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;
use std::thread::sleep;
use std::time::Duration;

use anyhow::{Context, Result};
use image::imageops::FilterType;
use serde::Deserialize;

use crate::dex::{Dex, to_id};
use crate::roster;

/// El sprite más grande de la web se ve a 64 px; 128 cubre pantallas de densidad 2×.
const SIZE: u32 = 128;
const WEBP_QUALITY: f32 = 85.0;
/// Primero los modelos HOME (los que usa la web); si no existen, los de 5.ª gen.
const SOURCES: [&str; 2] = [
    "https://play.pokemonshowdown.com/sprites/home-centered",
    "https://play.pokemonshowdown.com/sprites/gen5",
];
/// Pausa entre descargas para no cargar el servidor de Showdown.
const DOWNLOAD_PAUSE: Duration = Duration::from_millis(100);
/// Iconos de objetos: 24×24 px, 16 por fila (igual en la hoja de Showdown y en la nuestra).
const ICON: u32 = 24;
const ICONS_PER_ROW: u32 = 16;

#[derive(Deserialize)]
struct UsageEntry {
    species: String,
}

/// Genera en `out_dir` los sprites que falten para las especies de los datos del formato.
pub fn build(cache_root: &Path, data_dir: &Path, out_dir: &Path) -> Result<()> {
    let dex = Dex::load(cache_root)?;
    let roster = roster::read(&data_dir.join("roster.json"))?;
    let mut species = species_in_data(&dex, data_dir)?;
    if let Some(roster) = &roster {
        species.extend(roster.species.iter().map(|s| s.name.clone()));
    }
    let raw_dir = cache_root.join("sprites");
    fs::create_dir_all(&raw_dir)?;
    fs::create_dir_all(out_dir)?;

    let http = reqwest::blocking::Client::builder()
        .user_agent("kRustle-pipeline (+https://github.com/David-Nahuel/kRustle)")
        .build()?;
    let (mut created, mut missing) = (0, Vec::new());
    for name in &species {
        let Some(id) = dex.sprite_id(name) else {
            missing.push(name.clone());
            continue;
        };
        let out = out_dir.join(format!("{id}.webp"));
        if out.exists() {
            continue;
        }
        let raw = raw_dir.join(format!("{id}.png"));
        if !raw.exists() && !download(&http, id, &raw)? {
            missing.push(name.clone());
            continue;
        }
        convert(&raw, &out).with_context(|| format!("convirtiendo el sprite de {name}"))?;
        created += 1;
    }

    let removed = remove_stale(out_dir, &species, &dex)?;
    println!(
        "Sprites: {} especies, {created} nuevos, {removed} obsoletos borrados en {}",
        species.len(),
        out_dir.display()
    );
    if !missing.is_empty() {
        println!(
            "  sin sprite (la web usará las iniciales): {}",
            missing.join(", ")
        );
    }

    if let Some(roster) = &roster {
        let missing = item_sheet(cache_root, &dex, &roster.items, &out_dir.join("items.webp"))?;
        println!("Iconos de objetos: {}", roster.items.len() - missing.len());
        if !missing.is_empty() {
            println!("  sin icono: {}", missing.join(", "));
        }
    }
    Ok(())
}

/// Junta en una hoja los iconos de `items`, en ese orden. Devuelve los que no tienen icono.
fn item_sheet(cache_root: &Path, dex: &Dex, items: &[String], out: &Path) -> Result<Vec<String>> {
    let source = image::open(cache_root.join("dex/itemicons-sheet.png"))
        .context("leyendo la hoja de iconos de Showdown")?
        .to_rgba8();
    let rows = (items.len() as u32).div_ceil(ICONS_PER_ROW);
    let mut sheet = image::RgbaImage::new(ICONS_PER_ROW * ICON, rows * ICON);
    let mut missing = Vec::new();
    for (k, name) in items.iter().enumerate() {
        let Some(n) = dex.item_icon(&to_id(name)) else {
            missing.push(name.clone());
            continue;
        };
        let (sx, sy) = ((n % ICONS_PER_ROW) * ICON, (n / ICONS_PER_ROW) * ICON);
        if sy + ICON > source.height() {
            missing.push(name.clone());
            continue;
        }
        let icon = image::imageops::crop_imm(&source, sx, sy, ICON, ICON).to_image();
        let k = k as u32;
        image::imageops::replace(
            &mut sheet,
            &icon,
            i64::from((k % ICONS_PER_ROW) * ICON),
            i64::from((k / ICONS_PER_ROW) * ICON),
        );
    }
    // Pixel art: sin pérdida, para no emborronar los bordes.
    let encoded = webp::Encoder::from_rgba(&sheet, sheet.width(), sheet.height()).encode_lossless();
    fs::write(out, &*encoded)?;
    Ok(missing)
}

/// Borra los sprites de especies que ya no están en los datos (p. ej. de otra regulación).
fn remove_stale(out_dir: &Path, species: &BTreeSet<String>, dex: &Dex) -> Result<usize> {
    let expected: BTreeSet<String> = species
        .iter()
        .filter_map(|s| dex.sprite_id(s))
        .map(|id| format!("{id}.webp"))
        .chain(["items.webp".to_string()])
        .collect();
    let mut removed = 0;
    for entry in fs::read_dir(out_dir)? {
        let path = entry?.path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if name.ends_with(".webp") && !expected.contains(name) {
            fs::remove_file(&path)?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// Especies (como se ven en team preview) que aparecen en torneos o en el ladder.
fn species_in_data(dex: &Dex, data_dir: &Path) -> Result<BTreeSet<String>> {
    let usage: Vec<UsageEntry> = read_json(&data_dir.join("usage.json"))?;
    let mut species: BTreeSet<String> = usage.into_iter().map(|u| u.species).collect();

    // El ladder incluye especies que nadie lleva en torneos; sus claves son formas de combate.
    let spreads = data_dir.join("spreads.json");
    if spreads.exists() {
        let file: serde_json::Value = read_json(&spreads)?;
        if let Some(forms) = file["species"].as_object() {
            species.extend(
                forms
                    .keys()
                    .filter_map(|form| dex.preview_name(form))
                    .map(str::to_string),
            );
        }
    }
    Ok(species)
}

/// Descarga el sprite de la primera fuente que lo tenga. `false` si ninguna lo tiene.
fn download(http: &reqwest::blocking::Client, id: &str, path: &Path) -> Result<bool> {
    for source in SOURCES {
        sleep(DOWNLOAD_PAUSE);
        let response = http.get(format!("{source}/{id}.png")).send()?;
        if response.status().as_u16() == 404 {
            continue;
        }
        let bytes = response.error_for_status()?.bytes()?;
        fs::write(path, &bytes)?;
        return Ok(true);
    }
    Ok(false)
}

/// Reduce a `SIZE` (sin ampliar los que ya son más pequeños) y guarda en WebP.
fn convert(raw: &Path, out: &Path) -> Result<()> {
    let image = image::open(raw)?.to_rgba8();
    let (width, height) = image.dimensions();
    let image = if width > SIZE || height > SIZE {
        image::imageops::resize(&image, SIZE, SIZE, FilterType::Lanczos3)
    } else {
        image
    };
    let encoded =
        webp::Encoder::from_rgba(&image, image.width(), image.height()).encode(WEBP_QUALITY);
    fs::write(out, &*encoded)?;
    Ok(())
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    let text = fs::read_to_string(path).with_context(|| format!("leyendo {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parseando {}", path.display()))
}

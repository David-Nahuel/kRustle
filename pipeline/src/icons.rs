//! Favicon e iconos de la app instalable (PWA) a partir del logo.
//!
//! - `favicon.ico` con 16, 32 y 48 px.
//! - `icons/icon-N.png`: el logo tal cual, con fondo transparente ("any").
//! - `icons/maskable-N.png`: con fondo y margen, porque Android recorta el icono en círculo y
//!   solo garantiza visible el 80 % central.
//! - `icons/apple-touch-icon.png`: con fondo, porque iOS no admite transparencia.

use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use image::codecs::ico::{IcoEncoder, IcoFrame};
use image::imageops::FilterType;
use image::{ExtendedColorType, ImageFormat, Rgba, RgbaImage};

const ANY_SIZES: [u32; 8] = [72, 96, 128, 144, 152, 192, 384, 512];
const MASKABLE_SIZES: [u32; 2] = [192, 512];
const FAVICON_SIZES: [u32; 3] = [16, 32, 48];
const APPLE_SIZE: u32 = 180;
/// Parte del icono "maskable" que ocupa el logo (la zona segura es el 80 % central).
const MASKABLE_LOGO: f32 = 0.7;
/// Fondo de la app (slate-950), el mismo que `theme_color` en el manifiesto.
const BACKGROUND: Rgba<u8> = Rgba([2, 6, 23, 255]);

pub fn build(logo: &Path, public_dir: &Path) -> Result<()> {
    let bytes = fs::read(logo).with_context(|| format!("leyendo {}", logo.display()))?;
    let source = decode(&bytes).with_context(|| format!("decodificando {}", logo.display()))?;
    let icons_dir = public_dir.join("icons");
    fs::create_dir_all(&icons_dir)?;

    for size in ANY_SIZES {
        resize(&source, size).save_with_format(
            icons_dir.join(format!("icon-{size}x{size}.png")),
            ImageFormat::Png,
        )?;
    }
    for size in MASKABLE_SIZES {
        on_background(&source, size, MASKABLE_LOGO).save_with_format(
            icons_dir.join(format!("maskable-{size}x{size}.png")),
            ImageFormat::Png,
        )?;
    }
    on_background(&source, APPLE_SIZE, 0.85)
        .save_with_format(icons_dir.join("apple-touch-icon.png"), ImageFormat::Png)?;

    let frames = FAVICON_SIZES
        .iter()
        .map(|&size| {
            IcoFrame::as_png(
                resize(&source, size).as_raw(),
                size,
                size,
                ExtendedColorType::Rgba8,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    IcoEncoder::new(fs::File::create(public_dir.join("favicon.ico"))?).encode_images(&frames)?;

    println!(
        "Iconos: favicon.ico, {} iconos, {} maskable y apple-touch-icon a partir de {} ({}×{} px)",
        ANY_SIZES.len(),
        MASKABLE_SIZES.len(),
        logo.display(),
        source.width(),
        source.height()
    );
    if source.width() < 512 {
        println!(
            "  aviso: el logo es más pequeño que 512 px; los iconos grandes saldrán algo borrosos"
        );
    }
    Ok(())
}

/// PNG con el formato que trae el crate `image`; WebP con libwebp.
fn decode(bytes: &[u8]) -> Result<RgbaImage> {
    if bytes.starts_with(b"RIFF") {
        let decoded = webp::Decoder::new(bytes)
            .decode()
            .context("WebP no válido")?;
        let (width, height) = (decoded.width(), decoded.height());
        let rgba = if decoded.is_alpha() {
            decoded.to_vec()
        } else {
            decoded
                .chunks(3)
                .flat_map(|p| [p[0], p[1], p[2], 255])
                .collect()
        };
        return RgbaImage::from_raw(width, height, rgba).context("tamaño de WebP no válido");
    }
    Ok(image::load_from_memory(bytes)?.to_rgba8())
}

fn resize(image: &RgbaImage, size: u32) -> RgbaImage {
    image::imageops::resize(image, size, size, FilterType::Lanczos3)
}

/// El logo centrado sobre el fondo de la app, ocupando `fraction` del lado.
fn on_background(logo: &RgbaImage, size: u32, fraction: f32) -> RgbaImage {
    let mut canvas = RgbaImage::from_pixel(size, size, BACKGROUND);
    let inner = (size as f32 * fraction).round() as u32;
    let offset = i64::from((size - inner) / 2);
    image::imageops::overlay(&mut canvas, &resize(logo, inner), offset, offset);
    canvas
}

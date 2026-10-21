// Icona di Mosaikit disegnata a codice (stesso disegno del favicon della UI):
// riquadro scuro arrotondato con quattro tessere, una ambra.
// Usato sia a runtime (icona nell'area di notifica) sia da build.rs (icona dell'exe).

/// (x, y, lato, raggio, colore RGBA) nello spazio 48x48 del favicon.
const SHAPES: [(f32, f32, f32, f32, [u8; 4]); 5] = [
    (0.0, 0.0, 48.0, 10.0, [0x0b, 0x0c, 0x0f, 255]),
    (8.0, 8.0, 15.0, 3.0, [0xf0, 0xb2, 0x3e, 255]),
    (25.0, 8.0, 15.0, 3.0, [0x2a, 0x2e, 0x37, 255]),
    (8.0, 25.0, 15.0, 3.0, [0x2a, 0x2e, 0x37, 255]),
    (25.0, 25.0, 15.0, 3.0, [0x55, 0x52, 0x4b, 255]),
];

fn inside(px: f32, py: f32, x: f32, y: f32, side: f32, r: f32) -> bool {
    if px < x || py < y || px > x + side || py > y + side {
        return false;
    }
    let cx = px.clamp(x + r, x + side - r);
    let cy = py.clamp(y + r, y + side - r);
    (px - cx).powi(2) + (py - cy).powi(2) <= r * r
}

/// Pixel RGBA (riga per riga, dall'alto) di un'icona `size` x `size`, con antialiasing 4x4.
pub fn render(size: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity((size * size * 4) as usize);
    let scale = 48.0 / size as f32;
    for y in 0..size {
        for x in 0..size {
            let mut acc = [0f32; 4];
            for sy in 0..4 {
                for sx in 0..4 {
                    let px = (x as f32 + (sx as f32 + 0.5) / 4.0) * scale;
                    let py = (y as f32 + (sy as f32 + 0.5) / 4.0) * scale;
                    // l'ultima forma che contiene il punto vince
                    if let Some(&(.., c)) = SHAPES.iter().rev().find(|s| inside(px, py, s.0, s.1, s.2, s.3)) {
                        for i in 0..3 {
                            acc[i] += c[i] as f32;
                        }
                        acc[3] += 255.0;
                    }
                }
            }
            let n = 16.0;
            let a = acc[3] / n;
            if a == 0.0 {
                out.extend_from_slice(&[0, 0, 0, 0]);
            } else {
                // colore medio dei campioni coperti, alfa = copertura
                let cov = acc[3] / 255.0;
                out.extend_from_slice(&[
                    (acc[0] / cov) as u8,
                    (acc[1] / cov) as u8,
                    (acc[2] / cov) as u8,
                    a as u8,
                ]);
            }
        }
    }
    out
}

/// File .ico con immagini BMP a 32 bit (16, 24, 32, 48, 256 px).
pub fn ico() -> Vec<u8> {
    let sizes = [16u32, 24, 32, 48, 256];
    let images: Vec<Vec<u8>> = sizes
        .iter()
        .map(|&s| {
            let rgba = render(s);
            let mut bmp = Vec::new();
            // BITMAPINFOHEADER: altezza doppia (immagine + maschera AND)
            bmp.extend_from_slice(&40u32.to_le_bytes());
            bmp.extend_from_slice(&(s as i32).to_le_bytes());
            bmp.extend_from_slice(&((s * 2) as i32).to_le_bytes());
            bmp.extend_from_slice(&1u16.to_le_bytes());
            bmp.extend_from_slice(&32u16.to_le_bytes());
            bmp.extend_from_slice(&[0u8; 24]);
            for y in (0..s).rev() {
                for x in 0..s {
                    let i = ((y * s + x) * 4) as usize;
                    bmp.extend_from_slice(&[rgba[i + 2], rgba[i + 1], rgba[i], rgba[i + 3]]);
                }
            }
            let mask_row = (s.div_ceil(32) * 4) as usize;
            bmp.extend(std::iter::repeat_n(0u8, mask_row * s as usize));
            bmp
        })
        .collect();
    let mut out = Vec::new();
    out.extend_from_slice(&[0, 0, 1, 0]);
    out.extend_from_slice(&(sizes.len() as u16).to_le_bytes());
    let mut offset = 6 + 16 * sizes.len() as u32;
    for (s, img) in sizes.iter().zip(&images) {
        let dim = if *s >= 256 { 0 } else { *s as u8 };
        out.extend_from_slice(&[dim, dim, 0, 0]);
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&32u16.to_le_bytes());
        out.extend_from_slice(&(img.len() as u32).to_le_bytes());
        out.extend_from_slice(&offset.to_le_bytes());
        offset += img.len() as u32;
    }
    for img in images {
        out.extend_from_slice(&img);
    }
    out
}

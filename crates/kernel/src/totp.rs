//! Secondo fattore TOTP (RFC 6238: HMAC-SHA1, 6 cifre, passo di 30 secondi),
//! compatibile con Google/Microsoft Authenticator, FreeOTP e simili.

use hmac::{Hmac, Mac};
use rand::RngCore;
use sha1::Sha1;

pub const PERIOD: u64 = 30;
const DIGITS: u32 = 6;
/// passi accettati prima e dopo quello corrente (orologi non allineati)
const SKEW: u64 = 1;
const ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// Nuovo segreto (160 bit) in base32, come lo mostrano le app di autenticazione.
pub fn new_secret() -> String {
    let mut b = [0u8; 20];
    rand::thread_rng().fill_bytes(&mut b);
    base32_encode(&b)
}

pub fn base32_encode(data: &[u8]) -> String {
    let mut out = String::new();
    let (mut buf, mut bits) = (0u32, 0u32);
    for &b in data {
        buf = (buf << 8) | b as u32;
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(ALPHABET[((buf >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(ALPHABET[((buf << (5 - bits)) & 31) as usize] as char);
    }
    out
}

pub fn base32_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let (mut buf, mut bits) = (0u32, 0u32);
    for c in s.chars().filter(|c| !c.is_whitespace() && *c != '=') {
        let v = ALPHABET.iter().position(|&a| a as char == c.to_ascii_uppercase())? as u32;
        buf = (buf << 5) | v;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Some(out)
}

/// Codice del passo `step` (`unix_time / 30`).
pub fn code(secret: &[u8], step: u64) -> String {
    let mut mac = Hmac::<Sha1>::new_from_slice(secret).expect("HMAC accetta chiavi di ogni lunghezza");
    mac.update(&step.to_be_bytes());
    let h = mac.finalize().into_bytes();
    let off = (h[h.len() - 1] & 0x0f) as usize;
    let bin = u32::from_be_bytes([h[off] & 0x7f, h[off + 1], h[off + 2], h[off + 3]]);
    format!("{:0width$}", bin % 10u32.pow(DIGITS), width = DIGITS as usize)
}

pub fn current_step() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() / PERIOD)
        .unwrap_or(0)
}

/// Verifica `input` attorno al passo `now`; ritorna il passo riconosciuto, se e' successivo
/// a `last_step` (un codice gia' usato non vale una seconda volta).
pub fn verify(secret_b32: &str, input: &str, now: u64, last_step: u64) -> Option<u64> {
    let input: String = input.chars().filter(|c| !c.is_whitespace()).collect();
    if input.len() != DIGITS as usize || !input.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let secret = base32_decode(secret_b32)?;
    (now.saturating_sub(SKEW)..=now + SKEW)
        .filter(|s| *s > last_step)
        .find(|s| constant_eq(code(&secret, *s).as_bytes(), input.as_bytes()))
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// URI `otpauth://` da registrare nell'app (anche come QR code).
pub fn uri(issuer: &str, account: &str, secret_b32: &str) -> String {
    let (i, a) = (pct(issuer), pct(account));
    format!("otpauth://totp/{i}:{a}?secret={secret_b32}&issuer={i}&algorithm=SHA1&digits={DIGITS}&period={PERIOD}")
}

fn pct(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// QR code SVG dell'URI.
pub fn qr_svg(data: &str) -> String {
    match qrcode::QrCode::new(data.as_bytes()) {
        Ok(q) => q.render::<qrcode::render::svg::Color>().min_dimensions(200, 200).quiet_zone(true).build(),
        Err(_) => String::new(),
    }
}

/// Codici di recupero monouso, nel formato `xxxx-xxxx`.
pub fn recovery_codes(n: usize) -> Vec<String> {
    const CH: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let mut rng = rand::thread_rng();
    (0..n)
        .map(|_| {
            let mut s: String = (0..8).map(|_| CH[(rng.next_u32() as usize) % CH.len()] as char).collect();
            s.insert(4, '-');
            s
        })
        .collect()
}

/// Forma canonica di un codice di recupero (minuscole, senza spazi; il trattino e' facoltativo).
pub fn normalize_recovery(s: &str) -> String {
    let c: String = s.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_lowercase()).collect();
    if c.len() == 8 {
        format!("{}-{}", &c[..4], &c[4..])
    } else {
        c
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc6238_sha1() {
        // RFC 6238, appendice B (8 cifre: 94287082 / 07081804 / 14050471 / 89005924): le ultime 6
        let key = b"12345678901234567890";
        assert_eq!(code(key, 59 / PERIOD), "287082");
        assert_eq!(code(key, 1111111109 / PERIOD), "081804");
        assert_eq!(code(key, 1111111111 / PERIOD), "050471");
        assert_eq!(code(key, 1234567890 / PERIOD), "005924");
    }

    #[test]
    fn base32_andata_e_ritorno() {
        let s = new_secret();
        assert_eq!(s.len(), 32);
        assert_eq!(base32_encode(&base32_decode(&s).unwrap()), s);
        assert_eq!(base32_encode(b"12345678901234567890"), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    }

    #[test]
    fn verifica_con_tolleranza_e_senza_riuso() {
        let s = base32_encode(b"12345678901234567890");
        let now = 1234567890 / PERIOD;
        assert_eq!(verify(&s, "005924", now, 0), Some(now));
        assert_eq!(verify(&s, "005 924", now + 1, 0), Some(now));
        assert_eq!(verify(&s, "005924", now + 2, 0), None);
        assert_eq!(verify(&s, "005924", now, now), None);
        assert_eq!(verify(&s, "12345", now, 0), None);
    }

    #[test]
    fn uri_e_codici_di_recupero() {
        let u = uri("Mosaikit Test", "admin", "ABC");
        assert!(u.starts_with("otpauth://totp/Mosaikit%20Test:admin?secret=ABC&issuer=Mosaikit%20Test"));
        assert!(qr_svg(&u).contains("<svg"));
        let c = recovery_codes(10);
        assert_eq!(c.len(), 10);
        assert!(c.iter().all(|x| x.len() == 9 && &x[4..5] == "-"));
        assert_eq!(normalize_recovery(" ABCD efgh "), "abcd-efgh");
    }
}

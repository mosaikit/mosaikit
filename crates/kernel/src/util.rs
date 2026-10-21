use sha2::{Digest, Sha256};

/// Token casuale esadecimale di `n` byte.
pub fn random_token(n: usize) -> String {
    let bytes: Vec<u8> = (0..n).map(|_| rand::random::<u8>()).collect();
    hex::encode(bytes)
}

pub fn sha256(data: &[u8]) -> Vec<u8> {
    Sha256::digest(data).to_vec()
}

/// Nome di file o cartella valido (niente separatori, `.`/`..`, caratteri di controllo).
pub fn valid_name(name: &str) -> bool {
    let n = name.trim();
    !n.is_empty()
        && n == name
        && n.len() <= 255
        && n != "."
        && n != ".."
        && !n.chars().any(|c| c == '/' || c == '\\' || c.is_control())
}

/// Escape per ILIKE con `escape '\'`.
pub fn like_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nomi() {
        assert!(valid_name("relazione 2026.pdf"));
        for bad in ["", " x", "a/b", "a\\b", "..", ".", "a\u{0}b"] {
            assert!(!valid_name(bad), "{bad:?}");
        }
        assert_eq!(like_escape("50%_a"), "50\\%\\_a");
        assert_eq!(random_token(16).len(), 32);
    }
}

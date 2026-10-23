use sha2::{Digest, Sha256};

/// Random hexadecimal token of `n` bytes.
pub fn random_token(n: usize) -> String {
    let bytes: Vec<u8> = (0..n).map(|_| rand::random::<u8>()).collect();
    hex::encode(bytes)
}

/// Condition "the item `$n` is an ancestor": on PostgreSQL written as `ancestors @> array[$n]`, which the
/// GIN index on `ancestors` answers (`$n = any(ancestors)` reads the whole table); SQLite has no
/// arrays and keeps `= any` (translated to `json_each`).
pub fn under(sqlite: bool, n: usize) -> String {
    if sqlite {
        format!("${n} = any(ancestors)")
    } else {
        format!("ancestors @> array[${n}::uuid]")
    }
}

pub fn sha256(data: &[u8]) -> Vec<u8> {
    Sha256::digest(data).to_vec()
}

/// Valid file or folder name (no separators, `.`/`..`, control characters).
pub fn valid_name(name: &str) -> bool {
    let n = name.trim();
    !n.is_empty()
        && n == name
        && n.len() <= 255
        && n != "."
        && n != ".."
        && !n.chars().any(|c| c == '/' || c == '\\' || c.is_control())
}

/// Escape for ILIKE with `escape '\'`.
pub fn like_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert!(valid_name("report 2026.pdf"));
        for bad in ["", " x", "a/b", "a\\b", "..", ".", "a\u{0}b"] {
            assert!(!valid_name(bad), "{bad:?}");
        }
        assert_eq!(like_escape("50%_a"), "50\\%\\_a");
        assert_eq!(random_token(16).len(), 32);
    }
}

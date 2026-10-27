//! Encryption of the keys of outside services (ChaCha20-Poly1305).
//!
//! The key of the installation is not in the database: it comes from `secret_key` in the
//! configuration (or `MOSAIKIT_SECRET_KEY`, 32 bytes in base64) or, without it, from the file
//! `secret.key` in the data folder, created at the first start. A copy of the database alone does
//! not reveal the keys; losing the key makes them unreadable (they have to be entered again).

use std::path::Path;

use base64::Engine;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, CHACHA20_POLY1305, NONCE_LEN};

use crate::config::Config;
use crate::{Error, Result};

/// Name of the file with the key, in the data folder.
pub const KEY_FILE: &str = "secret.key";

pub struct SecretBox(LessSafeKey);

impl SecretBox {
    pub fn new(key: &[u8; 32]) -> SecretBox {
        SecretBox(LessSafeKey::new(UnboundKey::new(&CHACHA20_POLY1305, key).expect("32-byte key")))
    }

    /// The key of the configuration, otherwise the one of the data folder (created if missing).
    pub fn load(cfg: &Config) -> Result<SecretBox> {
        let b64 = base64::engine::general_purpose::STANDARD;
        let text = match &cfg.secret_key {
            Some(k) => k.trim().to_string(),
            None => read_or_create(&cfg.data_dir.join(KEY_FILE))?,
        };
        let raw = b64.decode(text.trim()).map_err(|_| Error::internal("secret_key: invalid base64"))?;
        let key: [u8; 32] = raw.try_into().map_err(|_| Error::internal("secret_key: 32 bytes are needed"))?;
        Ok(SecretBox::new(&key))
    }

    /// `nonce || ciphertext || tag`; `aad` binds the value to where it belongs (it cannot be moved).
    pub fn seal(&self, aad: &[u8], plain: &[u8]) -> Vec<u8> {
        let nonce: [u8; NONCE_LEN] = rand::random();
        let mut buf = plain.to_vec();
        self.0
            .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from(aad), &mut buf)
            .expect("encryption");
        let mut out = nonce.to_vec();
        out.extend_from_slice(&buf);
        out
    }

    pub fn open(&self, aad: &[u8], sealed: &[u8]) -> Result<Vec<u8>> {
        if sealed.len() < NONCE_LEN {
            return Err(Error::internal("encrypted value too short"));
        }
        let (n, ct) = sealed.split_at(NONCE_LEN);
        let nonce = Nonce::try_assume_unique_for_key(n).map_err(|_| Error::internal("invalid nonce"))?;
        let mut buf = ct.to_vec();
        let plain = self.0.open_in_place(nonce, Aad::from(aad), &mut buf).map_err(|_| {
            Error::internal("the key cannot be read: was the secret key of the installation changed?")
        })?;
        Ok(plain.to_vec())
    }
}

fn read_or_create(path: &Path) -> Result<String> {
    if let Ok(t) = std::fs::read_to_string(path) {
        return Ok(t);
    }
    let key: [u8; 32] = rand::random();
    let text = base64::engine::general_purpose::STANDARD.encode(key);
    let dir = path.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;
    // written to a temporary file that only the owner can read from the start, then linked under its
    // name in one step: never readable by others, never half written, and of two starts at the same
    // time the first one wins (the other reads its key)
    let tmp = dir.join(format!(".{KEY_FILE}.{}.tmp", std::process::id()));
    write_private(&tmp, text.as_bytes())?;
    let linked = std::fs::hard_link(&tmp, path);
    let _ = std::fs::remove_file(&tmp);
    match linked {
        Ok(()) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(std::fs::read_to_string(path)?),
        Err(e) => Err(e.into()),
    }
}

/// A new file readable and writable by its owner only: mode `0600` on Unix; on Windows the inherited
/// permissions are removed and only the owner and the system keep access (`icacls`).
fn write_private(path: &Path, data: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    #[cfg(windows)]
    {
        // S-1-3-4: OWNER RIGHTS, S-1-5-18: SYSTEM
        let ok = std::process::Command::new("icacls")
            .arg(path)
            .args(["/inheritance:r", "/grant:r", "*S-1-3-4:F", "*S-1-5-18:F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        if !ok {
            tracing::warn!("{}: the permissions could not be restricted (icacls)", path.display());
        }
    }
    f.write_all(data)?;
    f.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_bound_to_its_place() {
        let b = SecretBox::new(&[7; 32]);
        let s = b.seal(b"tenant:alfa:ai-hosted", b"sk-123456");
        assert_ne!(&s[NONCE_LEN..], b"sk-123456");
        assert_eq!(b.open(b"tenant:alfa:ai-hosted", &s).unwrap(), b"sk-123456");
        // in another place, or with another key, it does not open
        assert!(b.open(b"tenant:beta:ai-hosted", &s).is_err());
        assert!(SecretBox::new(&[8; 32]).open(b"tenant:alfa:ai-hosted", &s).is_err());
        // two encryptions of the same value differ (random nonce)
        assert_ne!(b.seal(b"x", b"v"), b.seal(b"x", b"v"));
    }

    #[test]
    fn key_file_created_once() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(KEY_FILE);
        let a = read_or_create(&p).unwrap();
        assert_eq!(read_or_create(&p).unwrap(), a);
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(a.trim()).unwrap().len(), 32);
        // no temporary file left behind
        let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from(KEY_FILE)]);
    }

    #[test]
    fn key_file_private_from_the_start() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(KEY_FILE);
        read_or_create(&p).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
        }
        #[cfg(windows)]
        {
            // no permission inherited from the folder: only the explicit owner and system entries
            let out = std::process::Command::new("icacls").arg(&p).output().unwrap();
            let acl = String::from_utf8_lossy(&out.stdout);
            assert!(!acl.contains("(I)"), "{acl}");
        }
    }
}

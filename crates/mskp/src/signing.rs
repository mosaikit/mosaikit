//! Firma ed25519 dei pacchetti.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

use crate::{Error, Result};

/// Contenuto del file `SIGNATURE`: chiave pubblica dell'editore e firma di `MANIFEST.sha256`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Signature {
    pub key: String,
    pub sig: String,
}

impl Signature {
    pub fn sign(key: &SigningKey, data: &[u8]) -> Signature {
        Signature {
            key: B64.encode(key.verifying_key().to_bytes()),
            sig: B64.encode(key.sign(data).to_bytes()),
        }
    }

    pub fn verify(&self, data: &[u8]) -> Result<VerifyingKey> {
        let vk = decode_verifying_key(&self.key)?;
        let raw = B64.decode(&self.sig).map_err(|e| Error::Signature(e.to_string()))?;
        let bytes: [u8; 64] = raw.try_into().map_err(|_| Error::Signature("lunghezza firma".into()))?;
        let sig = ed25519_dalek::Signature::from_bytes(&bytes);
        vk.verify(data, &sig)
            .map_err(|_| Error::Signature("la firma non corrisponde al contenuto".into()))?;
        Ok(vk)
    }
}

fn decode_verifying_key(b64: &str) -> Result<VerifyingKey> {
    let raw = B64.decode(b64.trim()).map_err(|e| Error::Signature(format!("chiave: {e}")))?;
    let bytes: [u8; 32] = raw.try_into().map_err(|_| Error::Signature("lunghezza chiave".into()))?;
    VerifyingKey::from_bytes(&bytes).map_err(|e| Error::Signature(e.to_string()))
}

/// Chiavi pubbliche degli editori di cui l'installazione si fida.
#[derive(Debug, Clone, Default)]
pub struct TrustedKeys(Vec<VerifyingKey>);

impl TrustedKeys {
    pub fn from_b64<S: AsRef<str>>(keys: &[S]) -> Result<TrustedKeys> {
        keys.iter().map(|k| decode_verifying_key(k.as_ref())).collect::<Result<Vec<_>>>().map(TrustedKeys)
    }

    pub fn contains(&self, k: &VerifyingKey) -> bool {
        self.0.iter().any(|t| t == k)
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

pub fn generate_key() -> SigningKey {
    SigningKey::generate(&mut rand::rngs::OsRng)
}

pub fn signing_key_to_b64(k: &SigningKey) -> String {
    B64.encode(k.to_bytes())
}

pub fn signing_key_from_b64(s: &str) -> Result<SigningKey> {
    let raw = B64.decode(s.trim()).map_err(|e| Error::Signature(format!("chiave privata: {e}")))?;
    let bytes: [u8; 32] = raw.try_into().map_err(|_| Error::Signature("lunghezza chiave privata".into()))?;
    Ok(SigningKey::from_bytes(&bytes))
}

pub fn public_key_b64(k: &SigningKey) -> String {
    B64.encode(k.verifying_key().to_bytes())
}

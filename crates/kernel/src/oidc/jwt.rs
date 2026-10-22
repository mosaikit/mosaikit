//! JSON Web Tokens of the identity providers: decoding and signature check with `ring` (already in the
//! tree for TLS and the encryption of secrets), for the two algorithms OIDC providers use: RS256 and
//! ES256. Everything else (`none`, HMAC, other curves) is refused.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ring::signature::{self, RsaPublicKeyComponents, UnparsedPublicKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{Error, Result};

/// A public key of the provider (`jwks_uri`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Jwk {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kid: Option<String>,
    pub kty: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alg: Option<String>,
    #[serde(default, rename = "use", skip_serializing_if = "Option::is_none")]
    pub use_: Option<String>,
    // RSA
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub n: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub e: Option<String>,
    // EC
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crv: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Jwks {
    pub keys: Vec<Jwk>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Header {
    pub alg: String,
    #[serde(default)]
    pub kid: Option<String>,
}

/// A token split in its parts, not yet verified.
#[derive(Debug)]
pub struct Decoded {
    pub header: Header,
    pub claims: Value,
    signing_input: String,
    signature: Vec<u8>,
}

fn bad(msg: &str) -> Error {
    Error::unauthorized(format!("invalid token: {msg}")).with_code("oidc_token")
}

pub fn b64(s: &str) -> Result<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(s.trim_end_matches('=')).map_err(|_| bad("bad base64"))
}

pub fn decode(token: &str) -> Result<Decoded> {
    if token.len() > 16 * 1024 {
        return Err(bad("too long"));
    }
    let mut parts = token.split('.');
    let (Some(h), Some(p), Some(s), None) = (parts.next(), parts.next(), parts.next(), parts.next()) else {
        return Err(bad("not a signed JWT"));
    };
    let header: Header = serde_json::from_slice(&b64(h)?).map_err(|_| bad("bad header"))?;
    let claims: Value = serde_json::from_slice(&b64(p)?).map_err(|_| bad("bad claims"))?;
    if !claims.is_object() {
        return Err(bad("bad claims"));
    }
    Ok(Decoded { header, claims, signing_input: format!("{h}.{p}"), signature: b64(s)? })
}

/// Outcome of the signature check: `UnknownKey` lets the caller fetch the keys again (rotation).
#[derive(Debug, PartialEq, Eq)]
pub enum Check {
    Valid,
    UnknownKey,
}

/// Checks the signature with the keys of the provider.
pub fn verify(d: &Decoded, jwks: &Jwks) -> Result<Check> {
    let (kty, alg): (&str, &dyn signature::VerificationAlgorithm) = match d.header.alg.as_str() {
        "RS256" => ("RSA", &signature::RSA_PKCS1_2048_8192_SHA256),
        "ES256" => ("EC", &signature::ECDSA_P256_SHA256_FIXED),
        other => return Err(bad(&format!("algorithm {other} not accepted"))),
    };
    let candidates: Vec<&Jwk> = jwks
        .keys
        .iter()
        .filter(|k| k.kty == kty)
        .filter(|k| k.use_.as_deref().is_none_or(|u| u == "sig"))
        .filter(|k| k.alg.as_deref().is_none_or(|a| a == d.header.alg))
        .filter(|k| match (&d.header.kid, &k.kid) {
            (Some(want), Some(have)) => want == have,
            (Some(_), None) => false,
            (None, _) => true,
        })
        .collect();
    if candidates.is_empty() {
        return Ok(Check::UnknownKey);
    }
    let msg = d.signing_input.as_bytes();
    for k in candidates {
        let ok = match kty {
            "RSA" => {
                let (Some(n), Some(e)) = (&k.n, &k.e) else { continue };
                RsaPublicKeyComponents { n: b64(n)?, e: b64(e)? }.verify(alg_rsa(), msg, &d.signature).is_ok()
            }
            _ => {
                let (Some(x), Some(y)) = (&k.x, &k.y) else { continue };
                if k.crv.as_deref() != Some("P-256") {
                    continue;
                }
                let mut point = vec![4u8];
                point.extend(b64(x)?);
                point.extend(b64(y)?);
                UnparsedPublicKey::new(alg, point).verify(msg, &d.signature).is_ok()
            }
        };
        if ok {
            return Ok(Check::Valid);
        }
    }
    Err(bad("signature does not match"))
}

fn alg_rsa() -> &'static signature::RsaParameters {
    &signature::RSA_PKCS1_2048_8192_SHA256
}

/// Encodes header and claims and signs them with `sign` (used by the test provider).
pub fn encode(header: &Value, claims: &Value, sign: impl FnOnce(&[u8]) -> Vec<u8>) -> String {
    let input = format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(header.to_string()),
        URL_SAFE_NO_PAD.encode(claims.to_string())
    );
    let sig = sign(input.as_bytes());
    format!("{input}.{}", URL_SAFE_NO_PAD.encode(sig))
}

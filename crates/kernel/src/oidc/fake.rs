//! Keys, people and tokens of the test identity provider (`mosaikit-fake-idp` and the tests). Nothing
//! here is used by a real sign-in: the two RSA keys are fixed test keys (ring cannot generate RSA keys)
//! and are published in this repository on purpose.

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use ring::rand::SystemRandom;
use ring::signature::{self, EcdsaKeyPair, KeyPair, RsaKeyPair, RsaPublicKeyComponents};
use serde_json::{json, Value};

use super::jwt::{self, Jwk, Jwks};

const RSA_1: &str = include_str!("test-rsa-1.pk8.b64");
const RSA_2: &str = include_str!("test-rsa-2.pk8.b64");

/// A person of the test provider.
#[derive(Debug, Clone)]
pub struct FakeUser {
    pub sub: &'static str,
    pub username: &'static str,
    pub name: &'static str,
    pub email: &'static str,
    pub groups: &'static [&'static str],
}

/// The people of the test provider: one Tenant Manager and one User through the groups, one without
/// groups (refused when the roles come from the provider).
pub const USERS: &[FakeUser] = &[
    FakeUser {
        sub: "f1d0c0a1-0001",
        username: "anna.rossi",
        name: "Anna Rossi",
        email: "anna.rossi@idp.example",
        groups: &["mosaikit-managers", "staff"],
    },
    FakeUser {
        sub: "f1d0c0a1-0002",
        username: "bruno.neri",
        name: "Bruno Neri",
        email: "bruno.neri@idp.example",
        groups: &["mosaikit-users", "staff"],
    },
    FakeUser {
        sub: "f1d0c0a1-0003",
        username: "carla.bassi",
        name: "Carla Bassi",
        email: "carla.bassi@idp.example",
        groups: &[],
    },
];

pub fn user(sub_or_username: &str) -> Option<&'static FakeUser> {
    USERS.iter().find(|u| u.sub == sub_or_username || u.username == sub_or_username)
}

/// The signing keys of a generation: an ES256 key (new at every generation) and one of the two RSA
/// keys (alternating). A new generation is a key rotation.
pub struct FakeKeys {
    pub generation: u32,
    ec: EcdsaKeyPair,
    rsa: RsaKeyPair,
}

impl FakeKeys {
    pub fn new(generation: u32) -> FakeKeys {
        let rng = SystemRandom::new();
        let pkcs8 =
            EcdsaKeyPair::generate_pkcs8(&signature::ECDSA_P256_SHA256_FIXED_SIGNING, &rng).expect("EC key");
        let ec = EcdsaKeyPair::from_pkcs8(&signature::ECDSA_P256_SHA256_FIXED_SIGNING, pkcs8.as_ref(), &rng)
            .expect("EC key");
        let der = STANDARD
            .decode(
                if generation.is_multiple_of(2) { RSA_1 } else { RSA_2 }
                    .split_whitespace()
                    .collect::<String>(),
            )
            .expect("RSA test key");
        let rsa = RsaKeyPair::from_pkcs8(&der).expect("RSA test key");
        FakeKeys { generation, ec, rsa }
    }

    pub fn ec_kid(&self) -> String {
        format!("ec-{}", self.generation)
    }

    pub fn rsa_kid(&self) -> String {
        format!("rsa-{}", self.generation % 2 + 1)
    }

    /// The public keys, as served by `jwks_uri`.
    pub fn jwks(&self) -> Jwks {
        let p = self.ec.public_key().as_ref();
        let rsa: RsaPublicKeyComponents<Vec<u8>> = self.rsa.public().into();
        Jwks {
            keys: vec![
                Jwk {
                    kid: Some(self.ec_kid()),
                    kty: "EC".into(),
                    alg: Some("ES256".into()),
                    use_: Some("sig".into()),
                    crv: Some("P-256".into()),
                    x: Some(URL_SAFE_NO_PAD.encode(&p[1..33])),
                    y: Some(URL_SAFE_NO_PAD.encode(&p[33..65])),
                    ..Jwk::default()
                },
                Jwk {
                    kid: Some(self.rsa_kid()),
                    kty: "RSA".into(),
                    alg: Some("RS256".into()),
                    use_: Some("sig".into()),
                    n: Some(URL_SAFE_NO_PAD.encode(&rsa.n)),
                    e: Some(URL_SAFE_NO_PAD.encode(&rsa.e)),
                    ..Jwk::default()
                },
            ],
        }
    }

    /// A signed token with `alg` (`ES256` or `RS256`).
    pub fn sign(&self, alg: &str, claims: &Value) -> String {
        let rng = SystemRandom::new();
        if alg == "RS256" {
            let header = json!({ "alg": "RS256", "typ": "JWT", "kid": self.rsa_kid() });
            jwt::encode(&header, claims, |msg| {
                let mut sig = vec![0u8; self.rsa.public().modulus_len()];
                self.rsa.sign(&signature::RSA_PKCS1_SHA256, &rng, msg, &mut sig).expect("RSA signature");
                sig
            })
        } else {
            let header = json!({ "alg": "ES256", "typ": "JWT", "kid": self.ec_kid() });
            jwt::encode(&header, claims, |msg| {
                self.ec.sign(&rng, msg).expect("EC signature").as_ref().to_vec()
            })
        }
    }
}

/// The claims of an ID token of `u` for `client_id`, valid from now for `ttl` seconds.
pub fn id_claims(issuer: &str, client_id: &str, u: &FakeUser, nonce: &str, sid: &str, ttl: i64) -> Value {
    let now = chrono::Utc::now().timestamp();
    json!({
        "iss": issuer,
        "aud": client_id,
        "sub": u.sub,
        "iat": now,
        "exp": now + ttl,
        "nonce": nonce,
        "sid": sid,
        "preferred_username": u.username,
        "name": u.name,
        "email": u.email,
        "groups": u.groups,
    })
}

/// The claims of a back-channel logout token for a session (`sid`) or a person (`sub`).
pub fn logout_claims(issuer: &str, client_id: &str, sub: Option<&str>, sid: Option<&str>) -> Value {
    let mut c = json!({
        "iss": issuer,
        "aud": client_id,
        "iat": chrono::Utc::now().timestamp(),
        "jti": hex::encode(rand::random::<[u8; 12]>()),
        "events": { super::BACKCHANNEL_EVENT: {} },
    });
    if let Some(s) = sub {
        c["sub"] = json!(s);
    }
    if let Some(s) = sid {
        c["sid"] = json!(s);
    }
    c
}

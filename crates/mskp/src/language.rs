//! Language plugins (`kind = "language"`): a new language of the interface.
//!
//! A language plugin declares `[language]` (`code`, `name`) and ships two kinds of data, never code:
//!
//! - `lang/host.json`: the texts of the host (the shell, the pages), a flat object from the English
//!   phrase (the key used by the host, e.g. `"Sign in"`, or `"errors.<code>"` for a server error) to
//!   its translation, with the same `{placeholders}`;
//! - `lang/plugins/<plugin id>.toml`: the texts of the manifest of another plugin in this language, in
//!   the shape of that plugin's `[i18n.<code>]` table (name, description, labels of fields, KPIs,
//!   permissions…). A plugin that has its own `[i18n.<code>]` keeps it.
//!
//! The texts inside the UI of a plugin (its iframe) stay the business of that plugin.
//! `en` and `it` are built into the host and cannot be replaced by a plugin.

use std::collections::BTreeMap;
use std::sync::RwLock;

use crate::manifest::Translation;
use crate::{Error, Result};

/// The host texts, inside the package.
pub const HOST_FILE: &str = "host.json";
/// The folder with the texts of the manifests of other plugins, inside the package.
pub const PLUGINS_DIR: &str = "plugins/";

const MAX_HOST_BYTES: usize = 1024 * 1024;
const MAX_HOST_TEXTS: usize = 6000;
const MAX_TEXT_CHARS: usize = 1000;
const MAX_PLUGIN_FILES: usize = 100;
const MAX_PLUGIN_FILE_BYTES: usize = 200 * 1024;

/// A language the plugin brings, checked.
#[derive(Debug, Clone, PartialEq)]
pub struct LanguagePack {
    pub code: String,
    /// the name of the language in that language ("Español")
    pub name: String,
    /// English phrase → translation
    pub host: BTreeMap<String, String>,
    /// id of a plugin → its texts in this language
    pub plugins: BTreeMap<String, Translation>,
}

/// A code of a language: two or three lower case letters (`es`, `fr`, `pt`, `fil`), and not one of the
/// languages the host has built in.
pub fn check_code(code: &str) -> std::result::Result<(), String> {
    let ok = (2..=3).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase());
    if !ok {
        return Err(format!("language.code '{code}': two or three lower case letters"));
    }
    if matches!(code, "en" | "it") {
        return Err(format!("language.code '{code}' is built into the host"));
    }
    Ok(())
}

fn bad(m: impl Into<String>) -> Error {
    Error::Manifest(format!("language: {}", m.into()))
}

fn text_ok(s: &str) -> bool {
    s.chars().count() <= MAX_TEXT_CHARS && !s.chars().any(|c| c.is_control() && c != '\n')
}

/// Reads and checks the files of `lang/` (names relative to that folder): `host.json` and
/// `plugins/<id>.toml`.
pub fn load_language(code: &str, name: &str, files: &BTreeMap<String, Vec<u8>>) -> Result<LanguagePack> {
    check_code(code).map_err(bad)?;
    let host = match files.get(HOST_FILE) {
        None => BTreeMap::new(),
        Some(b) => {
            if b.len() > MAX_HOST_BYTES {
                return Err(bad("host.json is over 1 MB"));
            }
            let m: BTreeMap<String, String> =
                serde_json::from_slice(b).map_err(|e| bad(format!("host.json: {e}")))?;
            if m.len() > MAX_HOST_TEXTS {
                return Err(bad(format!("host.json: at most {MAX_HOST_TEXTS} texts")));
            }
            for (k, v) in &m {
                if k.is_empty() || !text_ok(k) || !text_ok(v) {
                    return Err(bad(format!(
                        "host.json: invalid text «{}»",
                        k.chars().take(40).collect::<String>()
                    )));
                }
            }
            m
        }
    };
    let mut plugins = BTreeMap::new();
    for (path, bytes) in files.iter().filter(|(p, _)| p.starts_with(PLUGINS_DIR)) {
        let id = path[PLUGINS_DIR.len()..].strip_suffix(".toml").unwrap_or_default();
        if !crate::manifest::is_plugin_id(id) {
            return Err(bad(format!("{path}: the name must be the id of a plugin and end with .toml")));
        }
        if plugins.len() >= MAX_PLUGIN_FILES || bytes.len() > MAX_PLUGIN_FILE_BYTES {
            return Err(bad(format!("{path}: too many or too large files of plugins")));
        }
        let text = std::str::from_utf8(bytes).map_err(|_| bad(format!("{path}: not UTF-8")))?;
        let tr: Translation = toml::from_str(text).map_err(|e| bad(format!("{path}: {e}")))?;
        let texts = [&tr.name, &tr.description, &tr.label];
        if texts.iter().any(|t| t.as_deref().is_some_and(|t| !text_ok(t))) {
            return Err(bad(format!("{path}: invalid text")));
        }
        plugins.insert(id.to_string(), tr);
    }
    Ok(LanguagePack { code: code.to_string(), name: name.trim().to_string(), host, plugins })
}

// ------------------------------------------------------------------ texts of the manifests

type Texts = BTreeMap<String, BTreeMap<String, Translation>>;
static TEXTS: RwLock<Texts> = RwLock::new(BTreeMap::new());

/// Makes the texts of the manifests of a language available to [`crate::Manifest::localized`].
pub fn set_texts(code: &str, plugins: BTreeMap<String, Translation>) {
    TEXTS.write().expect("lock language texts").insert(code.to_string(), plugins);
}

/// Takes them away (the language plugin was turned off or uninstalled).
pub fn clear_texts(code: &str) {
    TEXTS.write().expect("lock language texts").remove(code);
}

/// The texts of a plugin in a language that came from a language plugin.
pub fn texts_for(code: &str, plugin: &str) -> Option<Translation> {
    TEXTS.read().expect("lock language texts").get(code).and_then(|m| m.get(plugin)).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(host: &str, plugin: Option<(&str, &str)>) -> BTreeMap<String, Vec<u8>> {
        let mut f = BTreeMap::new();
        f.insert(HOST_FILE.to_string(), host.as_bytes().to_vec());
        if let Some((id, toml)) = plugin {
            f.insert(format!("{PLUGINS_DIR}{id}.toml"), toml.as_bytes().to_vec());
        }
        f
    }

    #[test]
    fn codes() {
        for ok in ["es", "fr", "pt", "fil"] {
            assert!(check_code(ok).is_ok(), "{ok}");
        }
        for bad in ["", "e", "ES", "es-ES", "english", "en", "it", "e1"] {
            assert!(check_code(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_pack_is_read_and_checked() {
        let p = load_language(
            "es",
            " Español ",
            &files(
                r#"{"Sign in": "Iniciar sesión"}"#,
                Some(("com.mosaikit.notes", "name = \"Notas\"\n[resources.notes]\nlabel = \"Notas\"")),
            ),
        )
        .unwrap();
        assert_eq!((p.code.as_str(), p.name.as_str()), ("es", "Español"));
        assert_eq!(p.host["Sign in"], "Iniciar sesión");
        assert_eq!(p.plugins["com.mosaikit.notes"].name.as_deref(), Some("Notas"));
        // not JSON, not an object of texts, a control character, a bad file name, unknown keys
        for host in ["nope", r#"["a"]"#, r#"{"a": 1}"#, "{\"a\": \"b\\u0007\"}", r#"{"": "x"}"#] {
            assert!(load_language("es", "Español", &files(host, None)).is_err(), "{host}");
        }
        assert!(load_language("es", "x", &files("{}", Some(("not an id", "name = \"x\"")))).is_err());
        assert!(load_language("es", "x", &files("{}", Some(("com.a.b", "unknown = 1")))).is_err());
        assert!(load_language("it", "x", &files("{}", None)).is_err());
    }

    #[test]
    fn texts_of_manifests_by_language() {
        let mut m = BTreeMap::new();
        m.insert(
            "com.example.a".to_string(),
            Translation { name: Some("A es".into()), ..Translation::default() },
        );
        set_texts("zz", m);
        assert_eq!(texts_for("zz", "com.example.a").unwrap().name.as_deref(), Some("A es"));
        assert!(texts_for("zz", "com.example.b").is_none());
        clear_texts("zz");
        assert!(texts_for("zz", "com.example.a").is_none());
    }
}

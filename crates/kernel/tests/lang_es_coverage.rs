//! The language plugins (`lang-*`) carry the name of a language and the texts of the shell (`lang/host.json`); every
//! other plugin carries its own texts in its `lang/` folder: `lang/<code>.toml` for its manifest (the fields it has in
//! `[i18n.it]`) and `lang/<code>.json` for the texts inside its page. A new plugin therefore needs no change in the
//! language plugins. Skipped when the plugins repository is not next to this one.

use mosaikit_mskp::{Manifest, Translation};
use serde_json::Value;
use std::path::PathBuf;

/// The leaves of a translation as paths, e.g. `resources.notes.fields.title`.
fn leaves(prefix: &str, v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Null => {}
        Value::Object(m) => m.iter().for_each(|(k, v)| leaves(&format!("{prefix}.{k}"), v, out)),
        Value::String(s) if s.is_empty() => {}
        Value::Array(a) if a.is_empty() => {}
        _ => out.push(prefix.to_string()),
    }
}

fn shape(t: &Translation) -> Vec<String> {
    let mut out = Vec::new();
    leaves("", &serde_json::to_value(t).unwrap(), &mut out);
    out.sort();
    out
}

fn placeholders(s: &str) -> Vec<String> {
    let mut v: Vec<String> = s
        .match_indices('{')
        .filter_map(|(i, _)| s[i..].find('}').map(|j| s[i..=i + j].to_string()))
        .collect();
    v.sort();
    v
}

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../mosaikit-plugins")
}

/// The language plugins: (folder, code), sorted.
fn languages(root: &std::path::Path) -> Vec<(String, String)> {
    let mut langs: Vec<(String, String)> = std::fs::read_dir(root)
        .map(|d| {
            d.flatten()
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| n.starts_with("lang-") && root.join(n).join("lang/host.json").is_file())
                .map(|n| {
                    let code = n.trim_start_matches("lang-").to_string();
                    (n, code)
                })
                .collect()
        })
        .unwrap_or_default();
    langs.sort();
    langs
}

/// The plugins that are not language plugins: (folder, manifest).
fn plugins(root: &std::path::Path) -> Vec<(PathBuf, Manifest)> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(root).into_iter().flatten().flatten() {
        let Ok(text) = std::fs::read_to_string(entry.path().join("plugin.toml")) else { continue };
        let Ok(m) = Manifest::from_toml(&text) else { continue };
        if m.kind != Some(mosaikit_mskp::PluginKind::Language) {
            out.push((entry.path(), m));
        }
    }
    out.sort_by(|a, b| a.1.id.cmp(&b.1.id));
    out
}

/// The texts of the shell: every language has the same phrases as Spanish, each with a translation and its placeholders;
/// and the language pack loads as the kernel reads it.
#[test]
fn language_plugins_translate_the_shell() {
    let root = root();
    let langs = languages(&root);
    if langs.is_empty() {
        eprintln!("mosaikit-plugins not found next to this repository: skipped");
        return;
    }
    let keys = |dir: &str| -> Option<serde_json::Map<String, Value>> {
        let t = std::fs::read_to_string(root.join(dir).join("lang/host.json")).ok()?;
        serde_json::from_str(&t).ok()
    };
    let mut problems = Vec::new();
    if let Some(base) = keys("lang-es") {
        for (lang, _) in langs.iter().filter(|(l, _)| l != "lang-es") {
            let Some(host) = keys(lang) else {
                problems.push(format!("{lang}: lang/host.json is missing or is not a JSON object"));
                continue;
            };
            for k in base.keys().filter(|k| !host.contains_key(*k)) {
                problems.push(format!("{lang}: host.json lacks: {k}"));
            }
            for (k, v) in &host {
                match v.as_str() {
                    Some(t) if !t.trim().is_empty() => {
                        if placeholders(k) != placeholders(t) {
                            problems.push(format!("{lang}: placeholders differ: {k}"));
                        }
                    }
                    _ => problems.push(format!("{lang}: no translation: {k}")),
                }
            }
        }
    }
    for (lang, code) in &langs {
        let mut files = std::collections::BTreeMap::new();
        files.insert("host.json".to_string(), std::fs::read(root.join(lang).join("lang/host.json")).unwrap());
        if let Err(e) = mosaikit_mskp::language::load_language(code, "x", &files) {
            problems.push(format!("{lang}: the pack does not load: {e}"));
        }
    }
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

/// Every plugin translates itself in every language there is: its manifest (`lang/<code>.toml`, the fields of its
/// `[i18n.it]`) and, when its page reads its texts through `msk.t`, the page (`lang/<code>.json`: the same phrases in
/// every language, a translation for each and the same placeholders). The `lang/` folder must pass the check the kernel
/// makes when it loads the plugin.
#[test]
fn every_plugin_translates_itself() {
    let root = root();
    let langs = languages(&root);
    if langs.is_empty() {
        eprintln!("mosaikit-plugins not found next to this repository: skipped");
        return;
    }
    let mut problems = Vec::new();
    let mut checked = 0;
    for (dir, m) in plugins(&root) {
        let lang_dir = dir.join("lang");
        // the folder as the kernel reads it
        let mut files = std::collections::BTreeMap::new();
        for e in std::fs::read_dir(&lang_dir).into_iter().flatten().flatten() {
            if e.path().is_file() {
                files.insert(e.file_name().to_string_lossy().to_string(), std::fs::read(e.path()).unwrap());
            }
        }
        if let Err(e) = mosaikit_mskp::language::load_own(&files) {
            problems.push(format!("{}: lang/ does not load: {e}", m.id));
        }
        for (_, code) in &langs {
            if let Some(it) = m.i18n.get("it") {
                checked += 1;
                let file = lang_dir.join(format!("{code}.toml"));
                match std::fs::read_to_string(&file) {
                    Err(_) => problems.push(format!("{}: lang/{code}.toml is missing", m.id)),
                    Ok(text) => {
                        let tr: Translation =
                            toml::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", file.display()));
                        let got = shape(&tr);
                        for p in shape(it).iter().filter(|p| !got.contains(p)) {
                            problems.push(format!("{}: lang/{code}.toml misses: {p}", m.id));
                        }
                    }
                }
            }
        }
        // the page: the phrases are the ones of the first language
        let read = |code: &str| -> Option<serde_json::Map<String, Value>> {
            serde_json::from_str(&std::fs::read_to_string(lang_dir.join(format!("{code}.json"))).ok()?).ok()
        };
        if lang_dir.join(format!("{}.json", langs[0].1)).is_file() {
            let base = read(&langs[0].1).unwrap_or_default();
            for (_, code) in &langs {
                let Some(t) = read(code) else {
                    problems.push(format!("{}: lang/{code}.json is missing or is not a JSON object", m.id));
                    continue;
                };
                for k in base.keys().filter(|k| !t.contains_key(*k)) {
                    problems.push(format!("{}: {code}: lacks: {k}", m.id));
                }
                for k in t.keys().filter(|k| !base.contains_key(*k)) {
                    problems.push(format!("{}: {code}: unknown phrase: {k}", m.id));
                }
                for (k, v) in &t {
                    match v.as_str() {
                        Some(x) if !x.trim().is_empty() => {
                            if placeholders(k) != placeholders(x) {
                                problems.push(format!("{}: {code}: placeholders differ: {k}", m.id));
                            }
                        }
                        _ => problems.push(format!("{}: {code}: no translation: {k}", m.id)),
                    }
                }
            }
        }
    }
    assert!(checked > 0, "no plugin with [i18n.it] found: is the folder layout changed?");
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

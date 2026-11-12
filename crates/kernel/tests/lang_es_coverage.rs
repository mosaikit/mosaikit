//! Every language plugin (`lang-*`) must translate the manifest texts of every shipped plugin that has `[i18n.it]`
//! (same fields, resources, options, KPI columns...). Skipped when the plugins repository is not next to this one.

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

#[test]
fn language_plugins_translate_every_plugin_that_has_italian() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../mosaikit-plugins");
    let mut langs: Vec<String> = std::fs::read_dir(&root)
        .map(|d| {
            d.flatten()
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| n.starts_with("lang-") && root.join(n).join("lang/plugins").is_dir())
                .collect()
        })
        .unwrap_or_default();
    langs.sort();
    if langs.is_empty() {
        eprintln!("mosaikit-plugins not found next to this repository: skipped");
        return;
    }
    let mut problems = Vec::new();
    let mut checked = 0;
    for lang in &langs {
        let es_dir = root.join(lang).join("lang/plugins");
        for entry in std::fs::read_dir(&root).unwrap().flatten() {
            let Ok(text) = std::fs::read_to_string(entry.path().join("plugin.toml")) else { continue };
            let Ok(m) = Manifest::from_toml(&text) else { continue };
            // a language plugin is not translated by another language plugin
            if m.kind == Some(mosaikit_mskp::PluginKind::Language) {
                continue;
            }
            let Some(it) = m.i18n.get("it") else { continue };
            checked += 1;
            let file = es_dir.join(format!("{}.toml", m.id));
            let Ok(es_text) = std::fs::read_to_string(&file) else {
                problems.push(format!("{lang}: {}.toml is missing", m.id));
                continue;
            };
            let es: Translation =
                toml::from_str(&es_text).unwrap_or_else(|e| panic!("{}: {e}", file.display()));
            let (want, got) = (shape(it), shape(&es));
            for p in want.iter().filter(|p| !got.contains(p)) {
                problems.push(format!("{lang}: {}: missing: {p}", m.id));
            }
        }
    }
    // the texts of the shell: every language has the same phrases as the first one, each with a translation and its placeholders
    let keys = |lang: &str| -> Option<serde_json::Map<String, Value>> {
        let t = std::fs::read_to_string(root.join(lang).join("lang/host.json")).ok()?;
        serde_json::from_str(&t).ok()
    };
    let placeholders = |s: &str| {
        let mut v: Vec<String> = s
            .match_indices('{')
            .filter_map(|(i, _)| s[i..].find('}').map(|j| s[i..=i + j].to_string()))
            .collect();
        v.sort();
        v
    };
    if let Some(base) = keys("lang-es") {
        for lang in langs.iter().filter(|l| l.as_str() != "lang-es") {
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
    assert!(checked > 0, "no plugin with [i18n.it] found: is the folder layout changed?");
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

/// The texts inside the pages of the plugins (`lang/ui/<plugin id>.json`): the plugins that read their texts through
/// `msk.t` must have a file in every language plugin, with the same phrases, a translation for each and the same
/// placeholders. The language packs must also pass the check the kernel makes when it installs them.
#[test]
fn language_plugins_have_the_page_texts_of_every_adopted_plugin() {
    const ADOPTED: [&str; 4] =
        ["com.mosaikit.files", "com.mosaikit.maps", "com.mosaikit.static-site", "com.mosaikit.note-review"];
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../mosaikit-plugins");
    let mut langs: Vec<String> = std::fs::read_dir(&root)
        .map(|d| {
            d.flatten()
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| n.starts_with("lang-") && root.join(n).join("lang/host.json").is_file())
                .collect()
        })
        .unwrap_or_default();
    langs.sort();
    if langs.is_empty() {
        eprintln!("mosaikit-plugins not found next to this repository: skipped");
        return;
    }
    // the platform may land before the language plugins that carry the files (the two repositories check each other out)
    if !langs.iter().any(|l| root.join(l).join("lang/ui").is_dir()) {
        eprintln!("no language plugin has lang/ui yet: skipped");
        return;
    }
    let read = |lang: &str, id: &str| -> Option<serde_json::Map<String, Value>> {
        let t = std::fs::read_to_string(root.join(lang).join(format!("lang/ui/{id}.json"))).ok()?;
        serde_json::from_str(&t).ok()
    };
    let placeholders = |s: &str| {
        let mut v: Vec<String> = s
            .match_indices('{')
            .filter_map(|(i, _)| s[i..].find('}').map(|j| s[i..=i + j].to_string()))
            .collect();
        v.sort();
        v
    };
    let mut problems = Vec::new();
    for id in ADOPTED {
        // the phrases are the ones of the first language: every other one must have the same
        let Some(base) = read(&langs[0], id) else {
            problems.push(format!("{}: lang/ui/{id}.json is missing", langs[0]));
            continue;
        };
        for lang in &langs {
            let Some(m) = read(lang, id) else {
                problems.push(format!("{lang}: lang/ui/{id}.json is missing or is not a JSON object"));
                continue;
            };
            for k in base.keys().filter(|k| !m.contains_key(*k)) {
                problems.push(format!("{lang}: {id}: lacks: {k}"));
            }
            for k in m.keys().filter(|k| !base.contains_key(*k)) {
                problems.push(format!("{lang}: {id}: unknown phrase: {k}"));
            }
            for (k, v) in &m {
                match v.as_str() {
                    Some(t) if !t.trim().is_empty() => {
                        if placeholders(k) != placeholders(t) {
                            problems.push(format!("{lang}: {id}: placeholders differ: {k}"));
                        }
                    }
                    _ => problems.push(format!("{lang}: {id}: no translation: {k}")),
                }
            }
        }
    }
    // the pack as the kernel reads it
    for lang in &langs {
        let dir = root.join(lang).join("lang");
        let mut files = std::collections::BTreeMap::new();
        for sub in ["ui", "plugins"] {
            for e in std::fs::read_dir(dir.join(sub)).into_iter().flatten().flatten() {
                files.insert(
                    format!("{sub}/{}", e.file_name().to_string_lossy()),
                    std::fs::read(e.path()).unwrap(),
                );
            }
        }
        files.insert("host.json".into(), std::fs::read(dir.join("host.json")).unwrap());
        let code = lang.trim_start_matches("lang-");
        match mosaikit_mskp::language::load_language(code, "x", &files) {
            Ok(p) => {
                for id in ADOPTED {
                    if !p.ui.contains_key(id) {
                        problems.push(format!("{lang}: the pack has no page texts for {id}"));
                    }
                }
            }
            Err(e) => problems.push(format!("{lang}: the pack does not load: {e}")),
        }
    }
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

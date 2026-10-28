//! The Spanish language plugin must translate the manifest texts of every shipped plugin that has `[i18n.it]`
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
fn lang_es_translates_every_plugin_that_has_italian() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../mosaikit-plugins");
    let es_dir = root.join("lang-es/lang/plugins");
    if !es_dir.is_dir() {
        eprintln!("mosaikit-plugins not found next to this repository: skipped");
        return;
    }
    let mut problems = Vec::new();
    let mut checked = 0;
    for entry in std::fs::read_dir(&root).unwrap().flatten() {
        let Ok(text) = std::fs::read_to_string(entry.path().join("plugin.toml")) else { continue };
        let Ok(m) = Manifest::from_toml(&text) else { continue };
        // the language plugin itself is not translated by another language plugin
        if m.kind == Some(mosaikit_mskp::PluginKind::Language) {
            continue;
        }
        let Some(it) = m.i18n.get("it") else { continue };
        checked += 1;
        let file = es_dir.join(format!("{}.toml", m.id));
        let Ok(es_text) = std::fs::read_to_string(&file) else {
            problems.push(format!("{}: lang-es/lang/plugins/{}.toml is missing", m.id, m.id));
            continue;
        };
        let es: Translation = toml::from_str(&es_text).unwrap_or_else(|e| panic!("{}: {e}", file.display()));
        let (want, got) = (shape(it), shape(&es));
        for p in want.iter().filter(|p| !got.contains(p)) {
            problems.push(format!("{}: missing in Spanish: {p}", m.id));
        }
    }
    assert!(checked > 0, "no plugin with [i18n.it] found: is the folder layout changed?");
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

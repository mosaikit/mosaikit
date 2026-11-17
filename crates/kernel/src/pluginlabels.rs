//! Names a distribution gives to the official apps it includes (`[[plugin_labels]]` of `distribution.toml`, read
//! from the file named by `plugin_settings_file`, like `[[nav_groups]]`).
//!
//! ```toml
//! [[plugin_labels]]
//! plugin = "com.mosaikit.files"
//! label = "Files"                     # sidebar, page title and search, in every language
//! [plugin_labels.i18n.it]
//! label = "File"                      # optional: another name for a language
//! ```
//!
//! A product does not change the manifest of an official plugin; the kernel applies the name when it loads the
//! plugin (`Manifest::display`), over the English text, the translations of the manifest and the ones of a language
//! plugin. A problem is a warning, never a failure to start.

use std::collections::{BTreeMap, HashSet};

use mosaikit_mskp::DisplayOverride;
use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginLabelDef {
    pub plugin: String,
    #[serde(default)]
    pub label: String,
    /// page that replaces the share dialog for the resources of the plugin: `<place>` of the plugin, or
    /// `<plugin id>/<place>` of another one
    #[serde(default)]
    pub share_page: Option<String>,
    #[serde(default)]
    pub i18n: BTreeMap<String, PluginLabelText>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PluginLabelText {
    #[serde(default)]
    pub label: Option<String>,
}

/// The validated names, by plugin id; `warn` receives one message per problem.
pub fn normalize(defs: &[PluginLabelDef], warn: &mut dyn FnMut(String)) -> BTreeMap<String, DisplayOverride> {
    let mut out = BTreeMap::new();
    let mut seen = HashSet::new();
    let clean = |s: &str| s.trim().to_string();
    for d in defs {
        let id = clean(&d.plugin);
        if id.is_empty() {
            warn("plugin_labels: an entry without a plugin is ignored".into());
            continue;
        }
        if !seen.insert(id.clone()) {
            warn(format!("plugin_labels: the plugin {id} is listed twice, the first one wins"));
            continue;
        }
        let i18n: BTreeMap<String, String> = d
            .i18n
            .iter()
            .filter_map(|(l, t)| {
                let v = clean(t.label.as_deref().unwrap_or(""));
                (!v.is_empty()).then(|| (l.split(['-', '_']).next().unwrap_or(l).to_ascii_lowercase(), v))
            })
            .collect();
        let share_page = d.share_page.as_deref().map(clean).filter(|s| !s.is_empty());
        if share_page.as_deref().is_some_and(|s| s.len() > 200 || s.chars().any(char::is_control)) {
            warn(format!("plugin_labels: the share_page of {id} is not valid, it is ignored"));
            continue;
        }
        let label = clean(&d.label);
        if label.is_empty() && share_page.is_none() {
            warn(format!(
                "plugin_labels: the plugin {id} has no label and no share_page, it keeps its own name"
            ));
            continue;
        }
        if label.chars().count() > 60 || i18n.values().any(|v| v.chars().count() > 60) {
            warn(format!("plugin_labels: a name of {id} is longer than 60 characters, it is ignored"));
            continue;
        }
        out.insert(id, DisplayOverride { label, share_page, i18n });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct F {
        #[serde(default)]
        plugin_labels: Vec<PluginLabelDef>,
    }

    fn run(text: &str) -> (BTreeMap<String, DisplayOverride>, Vec<String>) {
        let f: F = toml::from_str(text).unwrap();
        let mut w = Vec::new();
        let m = normalize(&f.plugin_labels, &mut |x| w.push(x));
        (m, w)
    }

    #[test]
    fn a_label_with_a_translation() {
        let (m, w) = run("[[plugin_labels]]\nplugin = \"com.mosaikit.files\"\nlabel = \"Files\"\n[plugin_labels.i18n.it]\nlabel = \"File\"\n");
        assert!(w.is_empty());
        let d = &m["com.mosaikit.files"];
        assert_eq!((d.label.as_str(), d.i18n["it"].as_str()), ("Files", "File"));
    }

    #[test]
    fn a_share_page_alone_is_enough_and_the_name_stays_the_plugins_own() {
        let (m, w) = run("[[plugin_labels]]
plugin = \"com.mosaikit.files\"
share_page = \" com.geo/sharing \"
");
        assert!(w.is_empty(), "{w:?}");
        let d = &m["com.mosaikit.files"];
        assert_eq!((d.label.as_str(), d.share_page.as_deref()), ("", Some("com.geo/sharing")));
    }

    #[test]
    fn problems_are_warnings() {
        let (m, w) = run("[[plugin_labels]]\nplugin = \"a\"\nlabel = \"A\"\n[[plugin_labels]]\nplugin = \"a\"\nlabel = \"Again\"\n\
             [[plugin_labels]]\nplugin = \"b\"\nlabel = \" \"\n[[plugin_labels]]\nplugin = \" \"\nlabel = \"X\"\n");
        assert_eq!(m.keys().collect::<Vec<_>>(), ["a"]);
        assert_eq!(m["a"].label, "A");
        assert_eq!(w.len(), 3, "{w:?}");
    }

    #[test]
    fn unknown_keys_are_refused() {
        assert!(
            toml::from_str::<F>("[[plugin_labels]]\nplugin=\"a\"\nlabel=\"A\"\ncolour=\"red\"\n").is_err()
        );
    }
}

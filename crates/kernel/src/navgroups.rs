//! Groups of the navigation declared by a distribution (`[[nav_groups]]` of `distribution.toml`, read from
//! the file named by `plugin_settings_file`, like the seeds in `seed.rs`).
//!
//! ```toml
//! [[nav_groups]]
//! id = "data"
//! label = "Data"
//! icon = "database"                  # a Lucide name of the shell; unknown: a default icon
//! plugins = ["docs", "geo", "links"] # plugin ids, in the order shown
//! [nav_groups.i18n.it]
//! label = "Dati"
//! ```
//!
//! The kernel only validates and forwards the groups (`/api/brand`); it knows nothing of what they hold.
//! Plugins not listed stay at the bottom of the sidebar, flat. A group with no plugin is dropped, a duplicate
//! group id and a plugin already in an earlier group are ignored (first wins), always with a warning.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

/// One group as written in the file.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NavGroupDef {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub plugins: Vec<String>,
    /// texts in other languages: `[nav_groups.i18n.it] label = "..."`
    #[serde(default)]
    pub i18n: BTreeMap<String, NavGroupText>,
    /// subgroups, one level only: `[[nav_groups.children]]` (set in Settings › Navigation, or in the file)
    #[serde(default)]
    pub children: Vec<NavGroupDef>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct NavGroupText {
    #[serde(default)]
    pub label: Option<String>,
}

/// A validated group, as sent to the shell.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NavGroup {
    pub id: String,
    pub label: String,
    pub icon: Option<String>,
    pub plugins: Vec<String>,
    pub i18n: BTreeMap<String, NavGroupText>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<NavGroup>,
}

/// Validates the groups; `warn` receives one message per problem. Never fails.
pub fn normalize(defs: &[NavGroupDef], warn: &mut dyn FnMut(String)) -> Vec<NavGroup> {
    let mut ids = HashSet::new();
    let mut used: BTreeMap<String, String> = BTreeMap::new();
    norm(defs, 0, &mut ids, &mut used, warn)
}

fn norm(
    defs: &[NavGroupDef],
    depth: usize,
    ids: &mut HashSet<String>,
    used: &mut BTreeMap<String, String>,
    warn: &mut dyn FnMut(String),
) -> Vec<NavGroup> {
    let mut out = Vec::new();
    for d in defs {
        let id = d.id.trim().to_string();
        if id.is_empty() {
            warn("nav_groups: a group without an id is ignored".into());
            continue;
        }
        if !ids.insert(id.clone()) {
            warn(format!("nav_groups: the group id \"{id}\" is listed twice, the first one wins"));
            continue;
        }
        let mut plugins = Vec::new();
        for p in d.plugins.iter().map(|p| p.trim()).filter(|p| !p.is_empty()) {
            match used.get(p) {
                Some(first) if *first == id => {}
                Some(first) => warn(format!(
                    "nav_groups: plugin {p} is in \"{first}\" and \"{id}\", it stays in \"{first}\""
                )),
                None => {
                    used.insert(p.to_string(), id.clone());
                    plugins.push(p.to_string());
                }
            }
        }
        let children = if depth == 0 {
            norm(&d.children, 1, ids, used, warn)
        } else {
            if !d.children.is_empty() {
                warn(format!("nav_groups: the subgroup \"{id}\" has subgroups, only one level is allowed"));
            }
            Vec::new()
        };
        if plugins.is_empty() && children.is_empty() {
            warn(format!("nav_groups: the group \"{id}\" has no plugin, it is hidden"));
            continue;
        }
        let label = Some(d.label.trim()).filter(|l| !l.is_empty()).unwrap_or(&id).to_string();
        let icon = d.icon.as_ref().map(|i| i.trim().to_string()).filter(|i| !i.is_empty());
        out.push(NavGroup { id, label, icon, plugins, i18n: d.i18n.clone(), children });
    }
    out
}

/// A layout saved in the settings (`nav.layout`): groups with optional subgroups, checked before it is stored.
pub fn check_layout(v: &serde_json::Value) -> Result<(), String> {
    let defs: Vec<NavGroupDef> =
        serde_json::from_value(v.clone()).map_err(|e| format!("the navigation is a list of groups: {e}"))?;
    let count = |g: &NavGroupDef| 1 + g.children.len();
    if defs.iter().map(count).sum::<usize>() > 60 || defs.iter().any(|g| g.plugins.len() > 200) {
        return Err("too many groups or apps in the navigation".into());
    }
    let long = |s: &str| s.chars().count() > 60;
    let bad = |g: &NavGroupDef| {
        long(&g.id) || long(&g.label) || g.i18n.values().any(|t| t.label.as_deref().is_some_and(long))
    };
    if defs.iter().any(|g| bad(g) || g.children.iter().any(bad)) {
        return Err("a name of a group is longer than 60 characters".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct F {
        #[serde(default)]
        nav_groups: Vec<NavGroupDef>,
    }

    fn run(text: &str) -> (Vec<NavGroup>, Vec<String>) {
        let f: F = toml::from_str(text).unwrap();
        let mut w = Vec::new();
        let g = normalize(&f.nav_groups, &mut |m| w.push(m));
        (g, w)
    }

    #[test]
    fn parses_groups_with_translations() {
        let (g, w) = run(
            "[[nav_groups]]\nid = \"data\"\nlabel = \"Data\"\nicon = \"database\"\nplugins = [\"docs\", \"geo\"]\n\
             [nav_groups.i18n.it]\nlabel = \"Dati\"\n",
        );
        assert!(w.is_empty());
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].plugins, ["docs", "geo"]);
        assert_eq!(g[0].i18n["it"].label.as_deref(), Some("Dati"));
    }

    #[test]
    fn unknown_keys_are_refused() {
        assert!(toml::from_str::<F>("[[nav_groups]]\nid=\"a\"\nlabel=\"A\"\ncolour=\"red\"\n").is_err());
    }

    #[test]
    fn duplicates_empty_groups_and_shared_plugins_are_handled() {
        let (g, w) = run("[[nav_groups]]\nid = \"a\"\nlabel = \"A\"\nplugins = [\"x\", \"y\", \"x\"]\n\
             [[nav_groups]]\nid = \"a\"\nlabel = \"Again\"\nplugins = [\"z\"]\n\
             [[nav_groups]]\nid = \"b\"\nlabel = \"\"\nplugins = [\"y\", \"w\"]\n\
             [[nav_groups]]\nid = \"empty\"\nlabel = \"Empty\"\nplugins = []\n\
             [[nav_groups]]\nid = \"  \"\nlabel = \"No id\"\nplugins = [\"q\"]\n");
        assert_eq!(g.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(g[0].plugins, ["x", "y"]);
        assert_eq!(g[1].plugins, ["w"]);
        assert_eq!(g[1].label, "b", "an empty label falls back to the id");
        assert_eq!(w.len(), 4, "{w:?}");
    }

    #[test]
    fn subgroups_are_one_level_and_share_the_plugin_rules() {
        let (g, w) = run("[[nav_groups]]
id = \"a\"
label = \"A\"
plugins = [\"x\"]
             [[nav_groups.children]]
id = \"b\"
label = \"B\"
plugins = [\"y\", \"x\"]
             [[nav_groups.children.children]]
id = \"c\"
label = \"C\"
plugins = [\"z\"]
");
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].children.len(), 1);
        assert_eq!(g[0].children[0].plugins, ["y"]);
        assert!(g[0].children[0].children.is_empty());
        assert!(w.iter().any(|m| m.contains("only one level")), "{w:?}");
        // a group with only subgroups stays
        let (g, _) = run("[[nav_groups]]
id = \"a\"
label = \"A\"
[[nav_groups.children]]
id = \"b\"
label = \"B\"
plugins = [\"y\"]
");
        assert_eq!(g.len(), 1);
    }

    #[test]
    fn a_saved_layout_is_checked() {
        let ok = serde_json::json!([{ "id": "a", "label": "A", "plugins": ["x"], "children": [{ "id": "b", "label": "B", "plugins": ["y"] }] }]);
        assert!(check_layout(&ok).is_ok());
        assert!(check_layout(&serde_json::json!([])).is_ok());
        assert!(check_layout(&serde_json::json!("x")).is_err());
        assert!(check_layout(&serde_json::json!([{ "id": "a", "label": "A", "colour": "red" }])).is_err());
        let long = "x".repeat(61);
        assert!(check_layout(&serde_json::json!([{ "id": "a", "label": long }])).is_err());
    }
}

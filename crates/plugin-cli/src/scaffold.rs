//! `new`: a plugin from the template, standalone or inside the Cargo / npm workspaces of a plugin folder.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

use crate::util::{npm, run};

/// The template, inside the executable: (relative path, content).
const TEMPLATE: &[(&str, &str)] = &[
    ("Cargo.toml", include_str!("../templates/plugin/Cargo.toml")),
    ("migrations/001_kpi.sql", include_str!("../templates/plugin/migrations/001_kpi.sql")),
    ("plugin.toml", include_str!("../templates/plugin/plugin.toml")),
    ("src/lib.rs", include_str!("../templates/plugin/src/lib.rs")),
    ("ui/index.html", include_str!("../templates/plugin/ui/index.html")),
    ("ui/package.json", include_str!("../templates/plugin/ui/package.json")),
    ("ui/src/main.ts", include_str!("../templates/plugin/ui/src/main.ts")),
    ("ui/tsconfig.json", include_str!("../templates/plugin/ui/tsconfig.json")),
    ("ui/vite.config.ts", include_str!("../templates/plugin/ui/vite.config.ts")),
];

/// tsconfig of a standalone UI (inside a workspace it extends the one of `@mosaikit/plugin-api`).
const STANDALONE_TSCONFIG: &str = r#"{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
"#;

const STANDALONE_GITIGNORE: &str = "target/\nnode_modules/\nui/dist/\ndist/\n";

#[derive(Debug, Clone, Default)]
pub struct NewOptions {
    pub name: String,
    /// default `com.example.<name>`
    pub id: Option<String>,
    /// no WASM logic: manifest, migrations and UI only
    pub no_logic: bool,
    /// no UI: manifest, migrations and logic only (a service)
    pub no_ui: bool,
    /// folder that will contain the plugin folder
    pub into: PathBuf,
    /// the SDK from this folder (default: the version published for plugin API 1)
    pub sdk_path: Option<PathBuf>,
    /// `@mosaikit/plugin-api` from this folder (default: the version published for plugin API 1)
    pub plugin_api_path: Option<PathBuf>,
    /// run `npm install` in the npm workspace of the folder after adding the UI to it
    pub install: bool,
}

fn replace_all(s: &str, vars: &[(&str, &str)]) -> String {
    vars.iter().fold(s.to_string(), |acc, (k, v)| acc.replace(&format!("{{{{{k}}}}}"), v))
}

fn normalize(p: &Path) -> Vec<String> {
    let abs = std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf());
    let mut v: Vec<String> = Vec::new();
    for c in abs.components() {
        match c {
            std::path::Component::ParentDir => {
                v.pop();
            }
            std::path::Component::CurDir => {}
            other => v.push(other.as_os_str().to_string_lossy().to_string()),
        }
    }
    v
}

/// Relative path from `from` (folder) to `to`, with `/`.
pub fn relative(from: &Path, to: &Path) -> String {
    let (a, b) = (normalize(from), normalize(to));
    let common = a.iter().zip(&b).take_while(|(x, y)| x.to_lowercase() == y.to_lowercase()).count();
    let mut parts: Vec<String> = std::iter::repeat_n("..".to_string(), a.len() - common).collect();
    parts.extend(b[common..].iter().cloned());
    parts.join("/")
}

/// Path of a folder as TOML and JSON like it: absolute, with `/`.
fn slashed(p: &Path) -> String {
    let abs = std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf());
    abs.to_string_lossy().replace('\\', "/").trim_start_matches("//?/").to_string()
}

/// Creates the plugin folder. Returns it.
pub fn new_plugin(o: &NewOptions) -> Result<PathBuf> {
    let name = o.name.as_str();
    if !mosaikit_mskp::is_identifier(&name.replace('-', "_")) || name.contains('_') {
        bail!("invalid name: lower case, digits and '-' (e.g. weather, road-registry)");
    }
    let base = o.into.as_path();
    let dir = base.join(name);
    if dir.exists() {
        bail!("{} already exists", dir.display());
    }
    let id = o.id.clone().unwrap_or_else(|| format!("com.example.{name}"));
    if !mosaikit_mskp::is_plugin_id(&id) {
        bail!("invalid id: {id} (e.g. com.company.{name})");
    }
    let label = {
        let mut c = name.chars();
        c.next()
            .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
            .unwrap_or_default()
            .replace('-', " ")
    };
    let table = name.replace('-', "_");

    // inside a plugin folder with a Cargo workspace (that has the SDK) and an npm workspace, the plugin
    // joins them; anywhere else it is a project of its own
    let cargo_ws = !o.no_logic
        && std::fs::read_to_string(base.join("Cargo.toml"))
            .is_ok_and(|t| t.contains("[workspace]") && t.contains("mosaikit-plugin-sdk"));
    let npm_ws = !o.no_ui
        && std::fs::read_to_string(base.join("package.json")).is_ok_and(|t| t.contains("\"workspaces\""));
    let standalone = !cargo_ws && !npm_ws;

    let cargo_edition =
        if cargo_ws { "edition.workspace = true".to_string() } else { "edition = \"2021\"".to_string() };
    let cargo_sdk = match (&o.sdk_path, cargo_ws) {
        (_, true) => "mosaikit-plugin-sdk.workspace = true".to_string(),
        (Some(p), false) => format!("mosaikit-plugin-sdk = {{ path = \"{}\" }}", slashed(p)),
        (None, false) => format!("mosaikit-plugin-sdk = \"{}\"", mosaikit_mskp::API_VERSION),
    };
    let cargo_tail = if cargo_ws { "\n[lints]\nworkspace = true\n" } else { "\n[workspace]\n" };
    let ui_dir = dir.join("ui");
    let plugin_api = o.plugin_api_path.as_ref().map(|p| relative(&ui_dir, p)).unwrap_or_default();
    let plugin_api_dep = match &o.plugin_api_path {
        Some(_) => format!("file:{plugin_api}"),
        None => format!("^{}.0.0", mosaikit_mskp::API_VERSION),
    };
    // a UI alone brings its build tools; in an npm workspace the root has them
    let ui_dev_deps = if npm_ws {
        String::new()
    } else {
        ",\n  \"devDependencies\": {\n    \"typescript\": \"^5.9.0\",\n    \"vite\": \"^7.0.0\"\n  }"
            .to_string()
    };
    let vars = [
        ("id", id.as_str()),
        ("name", name),
        ("label", label.as_str()),
        ("table", table.as_str()),
        ("plugin_api", plugin_api.as_str()),
        ("plugin_api_dep", plugin_api_dep.as_str()),
        ("cargo_edition", cargo_edition.as_str()),
        ("cargo_sdk", cargo_sdk.as_str()),
        ("cargo_tail", cargo_tail),
        ("ui_dev_deps", ui_dev_deps.as_str()),
    ];
    for (rel, template) in TEMPLATE {
        if (o.no_logic && (*rel == "Cargo.toml" || rel.starts_with("src/")))
            || (o.no_ui && rel.starts_with("ui/"))
        {
            continue;
        }
        let mut text = replace_all(template, &vars);
        if *rel == "plugin.toml" {
            if o.no_logic {
                text = text.replace(&format!("hooks = [\"{table}\"]"), "hooks = []");
            }
            if o.no_ui {
                text = text.replace("[ui]\nentry = \"index.html\"\n\n", "");
            }
        }
        if *rel == "ui/tsconfig.json" && !npm_ws {
            text = STANDALONE_TSCONFIG.to_string();
        }
        let dest = dir.join(rel);
        std::fs::create_dir_all(dest.parent().expect("folder"))?;
        std::fs::write(dest, text)?;
    }
    if standalone {
        std::fs::write(dir.join(".gitignore"), STANDALONE_GITIGNORE)?;
    }
    // Cargo workspace of the plugin folder
    if cargo_ws {
        let cargo = base.join("Cargo.toml");
        let text = std::fs::read_to_string(&cargo).with_context(|| cargo.display().to_string())?;
        if !text.contains(&format!("\"{name}\"")) {
            match text.find("members = [") {
                Some(i) => {
                    let at = i + "members = [".len();
                    std::fs::write(&cargo, format!("{}\n    \"{name}\",{}", &text[..at], &text[at..]))?;
                }
                None => eprintln!("add \"{name}\" by hand to the members of {}", cargo.display()),
            }
        }
    }
    // npm workspace of the plugin folder
    if npm_ws {
        let pkg = base.join("package.json");
        let mut v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&pkg)?)?;
        if let Some(ws) = v.get_mut("workspaces").and_then(|w| w.as_array_mut()) {
            let entry = serde_json::Value::String(format!("{name}/ui"));
            if !ws.contains(&entry) {
                ws.push(entry);
            }
        }
        std::fs::write(&pkg, serde_json::to_string_pretty(&v)? + "\n")?;
        if o.install {
            run(npm().current_dir(base).args(["install", "--no-audit", "--no-fund"]))?;
        }
    }
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths() {
        let base = std::env::temp_dir();
        assert_eq!(relative(&base.join("a").join("ui"), &base.join("b").join("api")), "../../b/api");
        assert_eq!(relative(&base.join("a"), &base.join("a").join("x")), "x");
    }

    #[test]
    fn inside_a_plugin_folder_the_plugin_joins_its_workspaces() {
        let d = tempfile::tempdir().unwrap();
        let base = d.path();
        std::fs::write(
            base.join("Cargo.toml"),
            "[workspace]\nmembers = [\n    \"notes\",\n]\n[workspace.dependencies]\nmosaikit-plugin-sdk = \"1\"\n",
        )
        .unwrap();
        std::fs::write(base.join("package.json"), "{\n  \"workspaces\": [\"notes/ui\"]\n}\n").unwrap();
        let api = base.join("api");
        let o = NewOptions {
            name: "tasks-two".into(),
            into: base.into(),
            plugin_api_path: Some(api),
            ..Default::default()
        };
        let dir = new_plugin(&o).unwrap();
        let cargo = std::fs::read_to_string(dir.join("Cargo.toml")).unwrap();
        assert!(cargo.contains("mosaikit-plugin-sdk.workspace = true") && cargo.contains("workspace = true"));
        assert!(!cargo.contains("[workspace]") && !dir.join(".gitignore").exists());
        assert!(std::fs::read_to_string(base.join("Cargo.toml")).unwrap().contains("\"tasks-two\""));
        assert!(std::fs::read_to_string(base.join("package.json")).unwrap().contains("tasks-two/ui"));
        let ui = std::fs::read_to_string(dir.join("ui").join("package.json")).unwrap();
        assert!(ui.contains("\"file:../../api\"") && !ui.contains("devDependencies"));
        assert!(std::fs::read_to_string(dir.join("ui").join("tsconfig.json")).unwrap().contains("extends"));
    }

    #[test]
    fn names_and_ids_are_checked() {
        let dir = tempfile::tempdir().unwrap();
        let mut o = NewOptions { name: "Bad_Name".into(), into: dir.path().into(), ..Default::default() };
        assert!(new_plugin(&o).is_err());
        o.name = "weather".into();
        o.id = Some("nodots".into());
        assert!(new_plugin(&o).is_err());
        o.id = None;
        let made = new_plugin(&NewOptions { no_logic: true, no_ui: true, ..o.clone() }).unwrap();
        assert!(made.join("plugin.toml").is_file());
        assert!(!made.join("ui").exists() && !made.join("Cargo.toml").exists());
        let text = std::fs::read_to_string(made.join("plugin.toml")).unwrap();
        assert!(text.contains("id = \"com.example.weather\"") && !text.contains("[ui]"));
        // never over an existing folder
        assert!(new_plugin(&o).is_err());
    }
}

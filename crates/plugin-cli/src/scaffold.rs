//! `new`: a plugin from the template, standalone or inside the Cargo / npm workspaces of a plugin folder.
//!
//! The templates are inside the executable. A plugin is one of six variants (logic and UI, UI only, logic only,
//! extension of another plugin, language pack, layout), or one of three complete examples with a walkthrough.
//! A standalone folder gets its own `Cargo.toml`, `ui/package.json`, `ui/tsconfig.json`, `.oxlintrc.json`,
//! `.gitignore`, README and CI file, and needs no checkout of Mosaikit.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

use crate::util::{npm, run};

/// A template file inside the executable: (relative path, content).
type File = (&'static str, &'static str);

/// Plugin with logic and UI: the base of the variants `app`, `ui`, `service` and of the examples with logic.
const APP: &[File] = &[
    ("Cargo.toml", include_str!("../templates/plugin/Cargo.toml")),
    ("migrations/001_kpi.sql", include_str!("../templates/plugin/migrations/001_kpi.sql")),
    ("plugin.toml", include_str!("../templates/plugin/plugin.toml")),
    ("src/lib.rs", include_str!("../templates/plugin/src/lib.rs")),
    ("ui/index.html", include_str!("../templates/plugin/ui/index.html")),
    ("ui/package.json", include_str!("../templates/plugin/ui/package.json")),
    ("ui/src/i18n.test.ts", include_str!("../templates/plugin/ui/src/i18n.test.ts")),
    ("ui/src/i18n.ts", include_str!("../templates/plugin/ui/src/i18n.ts")),
    ("ui/src/main.ts", include_str!("../templates/plugin/ui/src/main.ts")),
    ("ui/tsconfig.json", include_str!("../templates/plugin/ui/tsconfig.json")),
    ("ui/vite.config.ts", include_str!("../templates/plugin/ui/vite.config.ts")),
];

/// Files of the base that an example replaces with tests of its own.
const EXAMPLE_DROPS: &[&str] = &["ui/src/i18n.test.ts"];

const EXTENSION: &[File] = &[("plugin.toml", include_str!("../templates/extension/plugin.toml"))];

const LANGUAGE: &[File] = &[
    ("plugin.toml", include_str!("../templates/language/plugin.toml")),
    ("lang/host.json", include_str!("../templates/language/lang/host.json")),
    (
        "lang/plugins/com.mosaikit.notes.toml",
        include_str!("../templates/language/lang/plugins/com.mosaikit.notes.toml"),
    ),
];

const LAYOUT: &[File] = &[
    ("plugin.toml", include_str!("../templates/layout/plugin.toml")),
    ("layout/layout.toml", include_str!("../templates/layout/layout/layout.toml")),
    ("layout/layout.css", include_str!("../templates/layout/layout/layout.css")),
];

const TODO: &[File] = &[
    ("plugin.toml", include_str!("../templates/examples/todo/plugin.toml")),
    ("migrations/001_kpi.sql", include_str!("../templates/examples/todo/migrations/001_kpi.sql")),
    ("src/lib.rs", include_str!("../templates/examples/todo/src/lib.rs")),
    ("ui/src/i18n.ts", include_str!("../templates/examples/todo/ui/src/i18n.ts")),
    ("ui/src/main.ts", include_str!("../templates/examples/todo/ui/src/main.ts")),
    ("ui/src/tasks.test.ts", include_str!("../templates/examples/todo/ui/src/tasks.test.ts")),
    ("ui/src/tasks.ts", include_str!("../templates/examples/todo/ui/src/tasks.ts")),
    ("WALKTHROUGH.md", include_str!("../templates/examples/todo/WALKTHROUGH.md")),
];

const INSIGHTS: &[File] = &[
    ("plugin.toml", include_str!("../templates/examples/insights/plugin.toml")),
    ("migrations/001_kpi.sql", include_str!("../templates/examples/insights/migrations/001_kpi.sql")),
    ("src/lib.rs", include_str!("../templates/examples/insights/src/lib.rs")),
    ("ui/src/chart.test.ts", include_str!("../templates/examples/insights/ui/src/chart.test.ts")),
    ("ui/src/chart.ts", include_str!("../templates/examples/insights/ui/src/chart.ts")),
    ("ui/src/i18n.ts", include_str!("../templates/examples/insights/ui/src/i18n.ts")),
    ("ui/src/main.ts", include_str!("../templates/examples/insights/ui/src/main.ts")),
    ("WALKTHROUGH.md", include_str!("../templates/examples/insights/WALKTHROUGH.md")),
];

const NOTE_PRIORITY: &[File] = &[
    ("plugin.toml", include_str!("../templates/examples/note-priority/plugin.toml")),
    ("WALKTHROUGH.md", include_str!("../templates/examples/note-priority/WALKTHROUGH.md")),
];

const COMMON_GITIGNORE: &str = include_str!("../templates/common/gitignore");
const COMMON_OXLINTRC: &str = include_str!("../templates/common/oxlintrc.json");
const COMMON_README: &str = include_str!("../templates/common/README.md");
const COMMON_CI: &str = include_str!("../templates/common/ci.yml");
const COMMON_CI_LOGIC: &str = include_str!("../templates/common/ci-logic.yml");
const COMMON_CI_UI: &str = include_str!("../templates/common/ci-ui.yml");

/// What a new plugin is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Variant {
    /// logic (WASM) and UI
    App,
    /// UI only
    Ui,
    /// logic only (a service)
    Service,
    /// extends another plugin: fields and actions, a manifest only
    Extension,
    /// a language of the interface: texts only
    Language,
    /// how the shell arranges its slots: a declarative layout
    Layout,
}

impl Variant {
    pub const NAMES: [&'static str; 6] = ["app", "ui", "service", "extension", "language", "layout"];

    pub fn parse(s: &str) -> Result<Variant> {
        Ok(match s {
            "app" => Variant::App,
            "ui" => Variant::Ui,
            "service" => Variant::Service,
            "extension" => Variant::Extension,
            "language" => Variant::Language,
            "layout" => Variant::Layout,
            other => bail!("unknown variant '{other}': one of {}", Variant::NAMES.join(", ")),
        })
    }
}

/// A complete, commented plugin with a walkthrough (`--example`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Example {
    /// a to-do list: `mountCrud`, views, pages, KPI, hooks
    Todo,
    /// an own page with a chart, a search command and a KPI
    Insights,
    /// an extension of Notes: fields and actions
    NotePriority,
}

impl Example {
    pub const NAMES: [&'static str; 3] = ["todo", "insights", "note-priority"];

    pub fn parse(s: &str) -> Result<Example> {
        Ok(match s {
            "todo" => Example::Todo,
            "insights" => Example::Insights,
            "note-priority" => Example::NotePriority,
            other => bail!("unknown example '{other}': one of {}", Example::NAMES.join(", ")),
        })
    }

    fn variant(self) -> Variant {
        match self {
            Example::Todo | Example::Insights => Variant::App,
            Example::NotePriority => Variant::Extension,
        }
    }

    fn files(self) -> &'static [File] {
        match self {
            Example::Todo => TODO,
            Example::Insights => INSIGHTS,
            Example::NotePriority => NOTE_PRIORITY,
        }
    }
}

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

/// Versions of the build tools of a standalone UI: the ones `mosaikit` and `mosaikit-plugins` use.
pub const TYPESCRIPT: &str = "~7.0.2";
pub const VITE: &str = "^8.3.4";
pub const VITEST: &str = "^5.0.5";
pub const OXLINT: &str = "^1.89.0";

#[derive(Debug, Clone, Default)]
pub struct NewOptions {
    pub name: String,
    /// default `com.example.<name>`
    pub id: Option<String>,
    /// what the plugin is (default `app`; `no_logic` and `no_ui` narrow `app`)
    pub variant: Option<Variant>,
    /// a complete example instead of the plain template
    pub example: Option<Example>,
    /// language code of a language plugin (default: the part of the name after `lang-`)
    pub lang: Option<String>,
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
    /// folder of an unpacked Mosaikit kit: its `sdk/` and `plugin-api/` stand for the two paths above
    pub kit: Option<PathBuf>,
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

fn language_code(o: &NewOptions) -> Result<String> {
    let code =
        o.lang.clone().or_else(|| o.name.strip_prefix("lang-").map(str::to_string)).unwrap_or_default();
    if !(2..=3).contains(&code.len()) || !code.bytes().all(|b| b.is_ascii_lowercase()) {
        bail!("a language plugin needs the code of its language (two or three lower case letters): --lang fr, or a name like lang-fr");
    }
    Ok(code)
}

/// The commands of the README of a plugin, by what the plugin is.
fn readme_commands(logic: bool, ui: bool, buildable: bool) -> &'static str {
    match (buildable, logic, ui) {
        (false, ..) => "mosaikit-plugin validate               # manifest, texts, permissions\nmosaikit-plugin pack --no-build        # a signed .mskp in dist/",
        (true, true, true) => "mosaikit-plugin test                   # validate, the tests of the logic, the type check and tests of the UI\nmosaikit-plugin build                  # the logic (WASM) and the UI\nmosaikit-plugin pack                   # build, validate and sign a .mskp in dist/",
        (true, true, false) => "mosaikit-plugin test                   # validate and the tests of the logic\nmosaikit-plugin build                  # the logic (WASM)\nmosaikit-plugin pack                   # build, validate and sign a .mskp in dist/",
        (true, false, _) => "mosaikit-plugin test                   # validate, the type check and tests of the UI\nmosaikit-plugin build                  # the UI\nmosaikit-plugin pack                   # build, validate and sign a .mskp in dist/",
    }
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
    if let (Some(v), Some(e)) = (o.variant, o.example) {
        if v != e.variant() {
            bail!("the example is an {:?}, not a {v:?}", e.variant());
        }
    }
    let variant = o.variant.or(o.example.map(Example::variant)).unwrap_or(Variant::App);
    let (mut no_logic, mut no_ui) = (o.no_logic, o.no_ui);
    match variant {
        Variant::App => {}
        Variant::Ui => no_logic = true,
        Variant::Service => no_ui = true,
        Variant::Extension | Variant::Language | Variant::Layout => (no_logic, no_ui) = (true, true),
    }
    if o.example.is_some() && variant == Variant::App && (no_logic || no_ui) {
        bail!("an example has both logic and UI");
    }
    let label = {
        let mut c = name.chars();
        c.next()
            .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
            .unwrap_or_default()
            .replace('-', " ")
    };
    let table = name.replace('-', "_");
    let lang = if variant == Variant::Language { language_code(o)? } else { String::new() };

    // an app inside a plugin folder with a Cargo workspace (that has the SDK) and an npm workspace joins them;
    // anywhere else, and every other variant, it is a project of its own
    let app_like = matches!(variant, Variant::App | Variant::Ui | Variant::Service);
    let cargo_ws = app_like
        && !no_logic
        && std::fs::read_to_string(base.join("Cargo.toml"))
            .is_ok_and(|t| t.contains("[workspace]") && t.contains("mosaikit-plugin-sdk"));
    let npm_ws = app_like
        && !no_ui
        && std::fs::read_to_string(base.join("package.json")).is_ok_and(|t| t.contains("\"workspaces\""));
    let standalone = !cargo_ws && !npm_ws;

    // where the SDK and the UI package come from: the paths, else the folder of the kit, else the published ones
    let sdk_path = o.sdk_path.clone().or_else(|| o.kit.as_ref().map(|k| k.join("sdk")));
    let api_path = o.plugin_api_path.clone().or_else(|| o.kit.as_ref().map(|k| k.join("plugin-api")));

    let cargo_edition =
        if cargo_ws { "edition.workspace = true".to_string() } else { "edition = \"2021\"".to_string() };
    let cargo_sdk = match (&sdk_path, cargo_ws) {
        (_, true) => "mosaikit-plugin-sdk.workspace = true".to_string(),
        (Some(p), false) => format!("mosaikit-plugin-sdk = {{ path = \"{}\" }}", slashed(p)),
        (None, false) => format!("mosaikit-plugin-sdk = \"{}\"", mosaikit_mskp::API_VERSION),
    };
    let cargo_tail = if cargo_ws { "\n[lints]\nworkspace = true\n" } else { "\n[workspace]\n" };
    let ui_dir = dir.join("ui");
    let plugin_api = api_path.as_ref().map(|p| relative(&ui_dir, p)).unwrap_or_default();
    let plugin_api_dep = match &api_path {
        Some(_) => format!("file:{plugin_api}"),
        None => format!("^{}.0.0", mosaikit_mskp::API_VERSION),
    };
    // a UI alone brings its build tools and its lint; in an npm workspace the root has them
    let ui_dev_deps = if npm_ws {
        String::new()
    } else {
        format!(
            ",\n  \"devDependencies\": {{\n    \"oxlint\": \"{OXLINT}\",\n    \"typescript\": \"{TYPESCRIPT}\",\n    \"vite\": \"{VITE}\",\n    \"vitest\": \"{VITEST}\"\n  }}"
        )
    };
    // the fonts of the UI package: npm does not install the dependencies of a package linked from a folder, and the
    // build resolves them from the plugin (the same dependency is in the root of `mosaikit-plugins`)
    let ui_fonts = if npm_ws {
        ""
    } else {
        ",
    \"@fontsource-variable/bricolage-grotesque\": \"^5.3.0\",
    \"@fontsource-variable/jetbrains-mono\": \"^5.3.0\""
    };
    let ui_lint_script =
        if npm_ws { "" } else { ",\n    \"lint\": \"oxlint src --deny-warnings -c ../.oxlintrc.json\"" };
    let lang_name = lang.clone();
    let vars = [
        ("id", id.as_str()),
        ("name", name),
        ("label", label.as_str()),
        ("table", table.as_str()),
        ("lang", lang.as_str()),
        ("lang_name", lang_name.as_str()),
        ("plugin_api", plugin_api.as_str()),
        ("plugin_api_dep", plugin_api_dep.as_str()),
        ("cargo_edition", cargo_edition.as_str()),
        ("cargo_sdk", cargo_sdk.as_str()),
        ("cargo_tail", cargo_tail),
        ("ui_dev_deps", ui_dev_deps.as_str()),
        ("ui_lint_script", ui_lint_script),
        ("ui_fonts", ui_fonts),
    ];

    // the files: the template of the variant, then what the example puts over it
    let mut files: BTreeMap<&str, String> = BTreeMap::new();
    let base_files: &[File] = match variant {
        Variant::App | Variant::Ui | Variant::Service => APP,
        Variant::Extension => EXTENSION,
        Variant::Language => LANGUAGE,
        Variant::Layout => LAYOUT,
    };
    for (rel, template) in base_files {
        if (no_logic && (*rel == "Cargo.toml" || rel.starts_with("src/")))
            || (no_ui && rel.starts_with("ui/"))
            || (o.example.is_some() && EXAMPLE_DROPS.contains(rel))
        {
            continue;
        }
        let mut text = replace_all(template, &vars);
        if *rel == "plugin.toml" && app_like {
            if no_logic {
                text = text.replace(&format!("hooks = [\"{table}\"]"), "hooks = []");
            }
            if no_ui {
                text = text.replace("[ui]\nentry = \"index.html\"\n\n", "");
            }
        }
        if *rel == "ui/tsconfig.json" && !npm_ws {
            text = STANDALONE_TSCONFIG.to_string();
        }
        files.insert(rel, text);
    }
    if let Some(e) = o.example {
        for (rel, template) in e.files() {
            files.insert(rel, replace_all(template, &vars));
        }
    }

    if standalone {
        let (logic, ui) = (!no_logic, !no_ui);
        let buildable = logic || ui;
        files.insert(".gitignore", COMMON_GITIGNORE.to_string());
        if ui {
            files.insert(".oxlintrc.json", COMMON_OXLINTRC.to_string());
        }
        let mut steps = String::new();
        if logic {
            steps.push_str(COMMON_CI_LOGIC);
        }
        if ui {
            steps.push_str(COMMON_CI_UI);
        }
        files.insert(".github/workflows/ci.yml", COMMON_CI.replace("{{ci_steps}}", &steps));
        files
            .insert("README.md", readme(&label, variant, &files, logic, ui, buildable, &sdk_path, &api_path));
    }

    for (rel, text) in &files {
        let dest = dir.join(rel);
        std::fs::create_dir_all(dest.parent().expect("folder"))?;
        std::fs::write(dest, text)?;
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

/// The README of a standalone plugin: what is in the folder, the commands, where the SDK comes from.
#[allow(clippy::too_many_arguments)]
fn readme(
    label: &str,
    variant: Variant,
    files: &BTreeMap<&str, String>,
    logic: bool,
    ui: bool,
    buildable: bool,
    sdk_path: &Option<PathBuf>,
    api_path: &Option<PathBuf>,
) -> String {
    let kind_text = match variant {
        Variant::Extension => "an extension of another plugin",
        Variant::Language => "a language pack",
        Variant::Layout => "a layout",
        _ => match (logic, ui) {
            (true, true) => "logic and UI",
            (false, true) => "UI only",
            (true, false) => "logic only, a service",
            (false, false) => "a manifest only",
        },
    };
    let known: [(&str, &str); 14] = [
        ("plugin.toml", "the manifest: what the plugin is, its data, permissions, KPIs and the translations of its texts"),
        ("migrations/", "SQL of the plugin's tables and views (PostgreSQL and SQLite)"),
        ("src/lib.rs", "the logic (WASM): hooks, commands and their tests"),
        ("Cargo.toml", "the crate of the logic; it depends on `mosaikit-plugin-sdk`"),
        ("ui/", "the UI: `src/` (TypeScript), `package.json`, `tsconfig.json`, `vite.config.ts`; it depends on `@mosaikit/plugin-api`"),
        ("lang/", "the texts: `host.json` for the shell, `plugins/<plugin id>.toml` for each app"),
        ("layout/", "the arrangement of the shell (`layout.toml`) and its style (`layout.css`)"),
        ("WALKTHROUGH.md", "the walkthrough of this example"),
        (".oxlintrc.json", "the lint rules of the UI"),
        (".github/workflows/ci.yml", "CI: tests, build and validation"),
        (".gitignore", "build products and keys stay out of Git"),
        ("dist/", "the `.mskp` that `pack` makes"),
        ("target/", "the build of the logic"),
        ("README.md", "this file"),
    ];
    let mut list = String::new();
    for (path, what) in known {
        let present = files.keys().any(|k| k.starts_with(path.trim_end_matches('/')));
        if present && !matches!(path, "dist/" | "target/") {
            list.push_str(&format!("- `{path}`: {what}\n"));
        }
    }
    let deps = match (sdk_path, api_path, logic, ui) {
        (None, None, false, false) => {
            "This plugin has no code, so it depends on neither package.\n".to_string()
        }
        _ => {
            let mut t = String::new();
            if logic {
                match sdk_path {
                    Some(p) => t.push_str(&format!("- `Cargo.toml` takes `mosaikit-plugin-sdk` from `{}`: a path of this machine. Do not commit it; before sharing the folder use the published version (`mosaikit-plugin-sdk = \"{}\"`).\n", slashed(p), mosaikit_mskp::API_VERSION)),
                    None => t.push_str(&format!("- `Cargo.toml` asks for the published `mosaikit-plugin-sdk = \"{}\"`.\n", mosaikit_mskp::API_VERSION)),
                }
            }
            if ui {
                match api_path {
                    Some(_) => t.push_str("- `ui/package.json` takes `@mosaikit/plugin-api` from a folder (`file:`). Use the published version (`^1.0.0`) before sharing the folder.\n"),
                    None => t.push_str("- `ui/package.json` asks for the published `@mosaikit/plugin-api` (`^1.0.0`).\n"),
                }
            }
            t.push_str("\nUntil the two packages are in a public registry they come with the Mosaikit kit (folders `sdk/` and `plugin-api/`). Make the plugin with `mosaikit-plugin new <name> --kit <folder of the kit>` (or the variable `MOSAIKIT_KIT`), or point at each one with `--sdk-path` and `--plugin-api-path`. In CI the repository variable `MOSAIKIT_KIT` does the same (see `.github/workflows/ci.yml`).\n");
            t
        }
    };
    let i18n = if logic || ui || matches!(variant, Variant::Extension | Variant::Layout) {
        "The texts of the manifest are translated in `plugin.toml`, in `[i18n.it]` and `[i18n.es]` (English is the default and the fallback)."
            .to_string()
            + if ui { " The texts of the UI are in `ui/src/i18n.ts`; the language comes from the host." } else { "" }
    } else {
        "This is a language pack: the texts are the translation. Add the keys of each app you translate under `lang/plugins/`.".to_string()
    };
    replace_all(
        COMMON_README,
        &[
            ("label", label),
            ("kind_text", kind_text),
            ("files", &(list + "\n")),
            ("commands", readme_commands(logic, ui, buildable)),
            ("deps", &deps),
            ("i18n", &i18n),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make(into: &Path, name: &str, f: impl FnOnce(&mut NewOptions)) -> PathBuf {
        let mut o = NewOptions { name: name.into(), into: into.into(), ..Default::default() };
        f(&mut o);
        new_plugin(&o).unwrap()
    }

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
        let dir = make(base, "tasks-two", |o| o.plugin_api_path = Some(api));
        let cargo = std::fs::read_to_string(dir.join("Cargo.toml")).unwrap();
        assert!(cargo.contains("mosaikit-plugin-sdk.workspace = true") && cargo.contains("workspace = true"));
        assert!(!cargo.contains("[workspace]") && !dir.join(".gitignore").exists());
        assert!(std::fs::read_to_string(base.join("Cargo.toml")).unwrap().contains("\"tasks-two\""));
        assert!(std::fs::read_to_string(base.join("package.json")).unwrap().contains("tasks-two/ui"));
        let ui = std::fs::read_to_string(dir.join("ui").join("package.json")).unwrap();
        assert!(
            ui.contains("\"file:../../api\"") && !ui.contains("devDependencies") && !ui.contains("\"lint\"")
        );
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

    /// Every variant and example makes a standalone folder with the files of its kind, and a manifest that reads.
    #[test]
    fn every_variant_makes_a_standalone_folder_that_validates() {
        let d = tempfile::tempdir().unwrap();
        let w = d.path();
        let sdk = w.join("sdk");
        let api = w.join("plugin-api");
        let cases: Vec<(&str, Option<Variant>, Option<Example>)> = vec![
            ("v-app", Some(Variant::App), None),
            ("v-ui", Some(Variant::Ui), None),
            ("v-service", Some(Variant::Service), None),
            ("v-extension", Some(Variant::Extension), None),
            ("lang-fr", Some(Variant::Language), None),
            ("v-layout", Some(Variant::Layout), None),
            ("e-todo", None, Some(Example::Todo)),
            ("e-insights", None, Some(Example::Insights)),
            ("e-priority", None, Some(Example::NotePriority)),
        ];
        for (name, variant, example) in cases {
            let dir = make(w, name, |o| {
                o.variant = variant;
                o.example = example;
                o.sdk_path = Some(sdk.clone());
                o.plugin_api_path = Some(api.clone());
            });
            for f in ["plugin.toml", ".gitignore", "README.md", ".github/workflows/ci.yml"] {
                assert!(dir.join(f).is_file(), "{name}: {f}");
            }
            let report = crate::validate::validate(&dir).unwrap();
            assert!(report.ok(), "{name} does not validate");
            // no placeholder is left in any file
            for f in walk(&dir).into_iter().filter(|f| !f.components().any(|c| c.as_os_str() == ".github")) {
                let t = std::fs::read_to_string(&f).unwrap();
                assert!(!t.contains("{{"), "{name}: placeholder left in {}", f.display());
            }
            let ui = dir.join("ui");
            let kind = variant.or(example.map(Example::variant)).unwrap();
            assert_eq!(ui.is_dir(), matches!(kind, Variant::App | Variant::Ui), "{name}: ui");
            assert_eq!(
                dir.join("Cargo.toml").is_file(),
                matches!(kind, Variant::App | Variant::Service),
                "{name}: Cargo.toml"
            );
            assert_eq!(dir.join(".oxlintrc.json").is_file(), ui.is_dir(), "{name}: lint config");
            if example.is_some() {
                assert!(dir.join("WALKTHROUGH.md").is_file());
            }
        }
        // the standalone UI has i18n tests, a lint script and the versions of this repository
        let ui = std::fs::read_to_string(w.join("v-app/ui/package.json")).unwrap();
        for needle in [TYPESCRIPT, VITE, VITEST, OXLINT, "\"lint\"", "\"test\""] {
            assert!(ui.contains(needle), "{needle}");
        }
        assert!(w.join("v-app/ui/src/i18n.test.ts").is_file());
        assert!(
            !w.join("e-todo/ui/src/i18n.test.ts").exists() && w.join("e-todo/ui/src/tasks.test.ts").is_file()
        );
        // a language pack and a layout carry their own files
        assert!(
            w.join("lang-fr/lang/host.json").is_file() && w.join("v-layout/layout/layout.toml").is_file()
        );
        assert!(std::fs::read_to_string(w.join("lang-fr/plugin.toml")).unwrap().contains("code = \"fr\""));
        // the CI of a service has the logic steps and none of the UI
        let ci = std::fs::read_to_string(w.join("v-service/.github/workflows/ci.yml")).unwrap();
        assert!(ci.contains("cargo test") && !ci.contains("setup-node"));
        let ci = std::fs::read_to_string(w.join("v-ui/.github/workflows/ci.yml")).unwrap();
        assert!(!ci.contains("cargo test") && ci.contains("npm run typecheck"));
    }

    fn walk(dir: &Path) -> Vec<PathBuf> {
        let mut out = Vec::new();
        for e in std::fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                out.extend(walk(&p));
            } else {
                out.push(p);
            }
        }
        out
    }

    #[test]
    fn a_language_needs_its_code_and_an_example_its_own_kind() {
        let d = tempfile::tempdir().unwrap();
        let mut o = NewOptions {
            name: "french".into(),
            into: d.path().into(),
            variant: Some(Variant::Language),
            ..Default::default()
        };
        assert!(new_plugin(&o).is_err());
        o.lang = Some("fr".into());
        assert!(new_plugin(&o).is_ok());
        let o = NewOptions {
            name: "mixed".into(),
            into: d.path().into(),
            variant: Some(Variant::Layout),
            example: Some(Example::Todo),
            ..Default::default()
        };
        assert!(new_plugin(&o).is_err());
        assert!(Variant::parse("nothing").is_err() && Example::parse("nothing").is_err());
    }

    /// The SDK and the UI package come from the paths, from the kit, or from the registry.
    #[test]
    fn the_sdk_and_the_ui_package_come_from_paths_the_kit_or_the_registry() {
        let d = tempfile::tempdir().unwrap();
        let w = d.path();
        let published = make(w, "published", |_| {});
        let cargo = std::fs::read_to_string(published.join("Cargo.toml")).unwrap();
        assert!(cargo.contains("mosaikit-plugin-sdk = \"1\""));
        let ui = std::fs::read_to_string(published.join("ui/package.json")).unwrap();
        assert!(ui.contains("\"^1.0.0\""));

        let kit = w.join("kit");
        let from_kit = make(w, "from-kit", |o| o.kit = Some(kit.clone()));
        let cargo = std::fs::read_to_string(from_kit.join("Cargo.toml")).unwrap();
        assert!(cargo.contains(&format!("path = \"{}\"", slashed(&kit.join("sdk")))), "{cargo}");
        let ui = std::fs::read_to_string(from_kit.join("ui/package.json")).unwrap();
        assert!(ui.contains("plugin-api\"") && ui.contains("file:"), "{ui}");

        // a path beats the kit
        let own = w.join("own-sdk");
        let mixed = make(w, "mixed", |o| {
            o.kit = Some(kit.clone());
            o.sdk_path = Some(own.clone());
        });
        let cargo = std::fs::read_to_string(mixed.join("Cargo.toml")).unwrap();
        assert!(cargo.contains(&slashed(&own)));
    }
}

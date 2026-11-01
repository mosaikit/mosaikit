//! `validate --strict`: the conformance checks a plugin must pass before it is proposed to an Administrator.
//!
//! Everything here is static (no server, no browser):
//!
//! * permissions against the host operations the logic calls. In a folder the Rust source of the logic
//!   (`src/**/*.rs`, the part before `#[cfg(test)]`) is scanned for the calls of the SDK (`.files()`,
//!   `.notify(`, `.call_plugin(`, `.http()`, `.service_key(`) and for the literal names of host operations;
//!   in a package the `logic.wasm` is scanned for the literal names the SDK embeds when a call is linked in
//!   (`plugin.call`, `http.fetch`, `key.get`, `files.*`), which says what the compiled logic really does;
//! * migrations: numbering, names, irreversible statements and the SQL as the SQLite translation accepts it;
//! * the UI (built, else its source): size, requests to outside origins, what the CSP of plugin pages blocks;
//! * i18n coverage of the declared translations;
//! * the layout contract of the pages built with `mountCrud` (best effort, on the source).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use mosaikit_mskp::{Manifest, PluginKind};

use crate::validate::Report;

/// Above this a UI is refused; above half of it a warning says so.
pub const UI_MAX_BYTES: usize = 10 * 1024 * 1024;

// ------------------------------------------------------------------ permissions

/// Host operations (and SDK calls) found in the logic.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct HostUse {
    pub files: bool,
    pub notify: bool,
    pub http: bool,
    pub service_key: bool,
    pub call_plugin: bool,
    /// plugin ids passed as literals to `call_plugin`
    pub called: BTreeSet<String>,
}

/// The source of the logic without comments and without the test module.
fn production_source(text: &str) -> String {
    let cut = text.find("#[cfg(test)]").unwrap_or(text.len());
    text[..cut].lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n")
}

/// What the Rust source of a logic calls.
pub fn host_use_in_source(text: &str) -> HostUse {
    let s = production_source(text);
    let mut u = HostUse {
        files: s.contains(".files()")
            || ["files.list", "files.describe", "files.read"].iter().any(|o| s.contains(&format!("\"{o}\""))),
        notify: s.contains(".notify(") || s.contains("\"notify\""),
        http: s.contains(".http()") || s.contains("\"http.fetch\""),
        service_key: s.contains(".service_key(") || s.contains("\"key.get\""),
        call_plugin: s.contains(".call_plugin(") || s.contains("\"plugin.call\""),
        called: BTreeSet::new(),
    };
    let mut rest = s.as_str();
    while let Some(i) = rest.find(".call_plugin(") {
        rest = &rest[i + ".call_plugin(".len()..];
        let t = rest.trim_start();
        if let Some(lit) = t.strip_prefix('"') {
            if let Some(end) = lit.find('"') {
                u.called.insert(lit[..end].to_string());
            }
        }
    }
    u
}

/// What a compiled logic calls: the literal names of the host operations the SDK links in. The
/// notification has no literal of its own that is safe to look for, so it is not reported here.
pub fn host_use_in_wasm(wasm: &[u8]) -> HostUse {
    let has = |needle: &str| wasm.windows(needle.len()).any(|w| w == needle.as_bytes());
    HostUse {
        files: ["files.list", "files.describe", "files.read"].iter().any(|o| has(o)),
        notify: false,
        http: has("http.fetch"),
        service_key: has("key.get"),
        call_plugin: has("plugin.call"),
        called: BTreeSet::new(),
    }
}

fn permission_checks(m: &Manifest, used: &HostUse, from_source: bool, r: &mut Report) {
    let p = &m.permissions;
    let origin = if from_source { "src/" } else { "logic.wasm" };
    if used.files && !p.files_read {
        r.error(format!("the logic reads the Files area ({origin}) but [permissions] files_read is not set"));
    }
    if used.http && p.network.is_empty() && m.service_keys.is_empty() {
        r.error(format!(
            "the logic calls the web ({origin}) but [permissions] network and [[service_keys]] are empty"
        ));
    }
    if used.service_key && m.service_keys.is_empty() {
        r.error(format!("the logic asks for a service key ({origin}) but there is no [[service_keys]]"));
    }
    if used.call_plugin && p.calls.is_empty() {
        r.error(format!("the logic calls another plugin ({origin}) but [permissions] calls is empty"));
    }
    for c in &used.called {
        if !p.calls.contains(c) {
            r.error(format!("the logic calls the plugin '{c}' but it is not in [permissions] calls"));
        }
    }
    if from_source {
        if used.notify && !p.notify {
            r.error("the logic sends notifications (src/) but [permissions] notify is not set");
        }
        if p.notify && !used.notify {
            r.error(
                "[permissions] notify is set but the logic never notifies (src/): ask only for what is used",
            );
        }
    }
    // the permissions of the logic that the Administrator reads as sensitive: asked for and unused is an error
    if p.files_read && !used.files {
        r.error(format!(
            "[permissions] files_read is set but the logic never reads the Files area ({origin})"
        ));
    }
    if !p.calls.is_empty() && !used.call_plugin {
        r.error(format!("[permissions] calls lists plugins but the logic never calls one ({origin})"));
    }
    if !p.network.is_empty() && !used.http {
        // the UI may use the origins too (images, connections): only the logic is checked here
        r.warn(format!("[permissions] network lists origins but the logic never calls the web ({origin}): fine if only the UI uses them"));
    }
}

/// Every `.rs` file of a folder (not `target`), joined.
fn read_sources(dir: &Path) -> String {
    fn walk(d: &Path, out: &mut String) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(&p, out);
            } else if p.extension().is_some_and(|x| x == "rs") {
                if let Ok(t) = std::fs::read_to_string(&p) {
                    out.push_str(&t);
                    out.push('\n');
                }
            }
        }
    }
    let mut s = String::new();
    walk(dir, &mut s);
    s
}

// ------------------------------------------------------------------ migrations

fn strip_sql_comments(sql: &str) -> String {
    let mut out = String::new();
    let mut chars = sql.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '-' && chars.peek() == Some(&'-') {
            for n in chars.by_ref() {
                if n == '\n' {
                    out.push('\n');
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Numbering, names, irreversible statements and the translation for SQLite of the migrations.
pub fn migration_checks(m: &Manifest, migrations: &[(String, String)], r: &mut Report) {
    let mut numbers: Vec<u32> = Vec::new();
    for (name, sql) in migrations {
        if let Some(n) = mosaikit_mskp::parse_migration_name(name) {
            numbers.push(n);
        }
        let stem = name.trim_end_matches(".sql").split_once('_').map(|(_, s)| s).unwrap_or("");
        if !stem.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
            r.error(format!(
                "migrations/{name}: the name after the number is lower case, digits and `_` only"
            ));
        }
        let clean = strip_sql_comments(sql).to_lowercase();
        let words: Vec<&str> =
            clean.split(|c: char| !c.is_alphanumeric() && c != '_').filter(|w| !w.is_empty()).collect();
        for pair in words.windows(2) {
            let bad = matches!(pair, ["drop", "table"] | ["drop", "column"]) || pair[0] == "truncate";
            if bad {
                r.error(format!(
                    "migrations/{name}: `{} {}` is irreversible (it loses data); migrations only add: change the data in a new one",
                    pair[0], pair[1]
                ));
            }
        }
    }
    numbers.sort_unstable();
    for (i, n) in numbers.iter().enumerate() {
        let want = i as u32 + 1;
        if *n != want {
            r.error(format!(
                "migrations are numbered {n:03} where {want:03} is expected (no gap, no duplicate)"
            ));
            break;
        }
    }
    sqlite_checks(m, migrations, r);
}

/// The migrations as the SQLite translation of the server takes them (the guard has accepted them already).
fn sqlite_checks(m: &Manifest, migrations: &[(String, String)], r: &mut Report) {
    use mosaikit_sql_guard::sqlite::{translate, Mode, Scope, Translated};
    let schema = m.schema_name();
    let mut scope = Scope { schema: schema.clone(), ..Scope::default() };
    for (name, sql) in migrations {
        // a statement refused by the PostgreSQL guard is reported already
        let Ok(stmts) = mosaikit_sql_guard::check_migration(sql, &schema) else { continue };
        for stmt in stmts {
            let lower = stmt.to_lowercase();
            match translate(&stmt, Mode::Migration(&scope)) {
                Err(e) => r.error(format!("migrations/{name}: not accepted on SQLite: {e}")),
                Ok(out) => {
                    for t in out {
                        match t {
                            Translated::StoreView { name, sql } => {
                                scope.views.insert(name, sql);
                            }
                            Translated::DropView { name } => {
                                scope.views.remove(&name);
                            }
                            _ => {}
                        }
                    }
                }
            }
            if let Some(i) = lower.find("create table") {
                let after = lower[i + 12..].trim_start().trim_start_matches("if not exists").trim_start();
                let table: String = after
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '.' || *c == '"')
                    .collect();
                let table = table.rsplit('.').next().unwrap_or("").trim_matches('"').to_string();
                if !table.is_empty() {
                    scope.tables.insert(table, lower.contains("resource_id"));
                }
            }
        }
    }
    if !migrations.is_empty() {
        r.info("migrations checked for PostgreSQL and for SQLite (desktop)");
    }
}

// ------------------------------------------------------------------ UI

fn origin_allowed(url: &str, allowed: &[String]) -> bool {
    allowed.iter().any(|o| url.starts_with(o.trim_end_matches('/')))
}

fn is_external(v: &str) -> bool {
    let v = v.trim();
    v.starts_with("http://")
        || v.starts_with("https://")
        || v.starts_with("//")
        || v.starts_with("ws://")
        || v.starts_with("wss://")
}

/// Value of an attribute inside a tag (quoted or not).
fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let lower = tag.to_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find(name) {
        let at = from + i;
        from = at + name.len();
        let before_ok = at == 0 || lower.as_bytes()[at - 1].is_ascii_whitespace();
        let rest = tag[at + name.len()..].trim_start();
        if before_ok && rest.starts_with('=') {
            let v = rest[1..].trim_start();
            return Some(match v.chars().next() {
                Some(q @ ('"' | '\'')) => v[1..].split(q).next().unwrap_or(""),
                _ => v.split(|c: char| c.is_whitespace() || c == '>').next().unwrap_or(""),
            });
        }
    }
    None
}

fn html_checks(file: &str, html: &str, allowed: &[String], r: &mut Report) {
    let lower = html.to_lowercase();
    if lower.contains("javascript:") {
        r.error(format!("ui/{file}: a `javascript:` address (blocked by the CSP of plugin pages)"));
    }
    let mut i = 0;
    while let Some(open) = html[i..].find('<') {
        let start = i + open;
        let Some(end) = html[start..].find('>') else { break };
        let tag = &html[start..start + end + 1];
        i = start + end + 1;
        let name: String =
            tag[1..].chars().take_while(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase();
        if name.is_empty() {
            continue;
        }
        for h in tag.to_lowercase().split_whitespace().skip(1) {
            if h.starts_with("on")
                && h.contains('=')
                && h[2..].chars().take_while(|c| *c != '=').all(|c| c.is_ascii_lowercase())
            {
                r.error(format!(
                    "ui/{file}: an inline event handler `{}` (blocked by the CSP of plugin pages)",
                    h.split('=').next().unwrap_or("")
                ));
            }
        }
        if name == "script" {
            let src = attr(tag, "src");
            if let Some(s) = src.filter(|s| is_external(s) && !origin_allowed(s, allowed)) {
                r.error(format!("ui/{file}: a script from an outside origin ({s}); plugin pages run their own scripts only"));
            }
            if src.is_none() {
                let ty = attr(tag, "type").unwrap_or("").to_lowercase();
                let body = html[i..]
                    .to_lowercase()
                    .find("</script")
                    .map(|e| html[i..i + e].trim().len())
                    .unwrap_or(0);
                if body > 0 && ty != "application/ld+json" {
                    r.error(format!(
                        "ui/{file}: an inline script (blocked by the CSP of plugin pages): move it to a file"
                    ));
                }
            }
        }
        if matches!(
            name.as_str(),
            "link" | "img" | "iframe" | "source" | "video" | "audio" | "embed" | "object"
        ) {
            for a in ["src", "href", "data", "poster"] {
                if let Some(v) = attr(tag, a) {
                    if is_external(v) && !origin_allowed(v, allowed) {
                        r.error(format!("ui/{file}: <{name}> loads an outside address ({v}); declare the origin in [permissions] network or frame_src, or ship the file"));
                    }
                }
            }
        }
    }
}

fn css_checks(file: &str, css: &str, allowed: &[String], r: &mut Report) {
    let mut rest = css;
    while let Some(i) = rest.find("url(") {
        rest = &rest[i + 4..];
        let v = rest.trim_start().trim_start_matches(['"', '\'']);
        if is_external(v) && !origin_allowed(v, allowed) {
            r.error(format!(
                "ui/{file}: url() loads an outside address ({}); ship the file",
                v.split([')', '"', '\'']).next().unwrap_or("")
            ));
        }
    }
    let mut rest = css;
    while let Some(i) = rest.find("@import") {
        rest = &rest[i + 7..];
        let v = rest.trim_start().trim_start_matches("url(").trim_start_matches(['"', '\'']);
        if is_external(v) && !origin_allowed(v, allowed) {
            r.error(format!("ui/{file}: @import of an outside address; ship the file"));
        }
    }
}

fn js_checks(file: &str, js: &str, m: &Manifest, allowed: &[String], r: &mut Report) {
    for needle in ["fetch(", "import(", "importScripts(", "sendBeacon(", "WebSocket(", "EventSource("] {
        let mut rest = js;
        while let Some(i) = rest.find(needle) {
            rest = &rest[i + needle.len()..];
            let v = rest.trim_start().trim_start_matches(['"', '\'', '`']);
            if is_external(v) && !origin_allowed(v, allowed) {
                let shown: String = v.chars().take_while(|c| !matches!(c, '"' | '\'' | '`')).collect();
                r.error(format!("ui/{file}: {needle}…) towards an outside address ({shown}); declare the origin in [permissions] network"));
            }
        }
    }
    if !m.permissions.script_eval {
        let compiles = js.contains("new Function(")
            || js.match_indices("eval(").any(|(i, _)| {
                i == 0
                    || !js.as_bytes()[i - 1].is_ascii_alphanumeric()
                        && !matches!(js.as_bytes()[i - 1], b'_' | b'$' | b'.')
            });
        if compiles {
            r.warn(format!("ui/{file}: compiles code at run time (eval, new Function): the CSP of plugin pages blocks it without [permissions] script_eval"));
        }
    }
}

/// Checks the files of the UI (path relative to `ui/` or `ui/dist/` -> content).
pub fn ui_checks(m: &Manifest, files: &BTreeMap<String, Vec<u8>>, built: bool, r: &mut Report) {
    let total: usize = files.values().map(Vec::len).sum();
    if total > UI_MAX_BYTES {
        r.error(format!("the UI is {} KB: over the limit of {} KB", total / 1024, UI_MAX_BYTES / 1024));
    } else if total > UI_MAX_BYTES / 2 {
        r.warn(format!(
            "the UI is {} KB: more than half of the limit of {} KB",
            total / 1024,
            UI_MAX_BYTES / 1024
        ));
    }
    let mut allowed: Vec<String> = m.permissions.network.clone();
    allowed.extend(m.permissions.frame_src.iter().cloned());
    for (name, data) in files {
        let Ok(text) = std::str::from_utf8(data) else { continue };
        let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
        match ext.as_str() {
            "html" | "htm" => html_checks(name, text, &allowed, r),
            "css" => css_checks(name, text, &allowed, r),
            "js" | "mjs" => js_checks(name, text, m, &allowed, r),
            "ts" if !built && !name.ends_with(".test.ts") => js_checks(name, text, m, &allowed, r),
            _ => {}
        }
    }
    if let Some(ui) = &m.ui {
        for page in std::iter::once(&ui.entry).chain(ui.public_view.iter()) {
            let Some(Ok(h)) = files.get(page).map(|d| std::str::from_utf8(d)) else { continue };
            let l = h.to_lowercase();
            if !l.contains("<title") {
                r.warn(format!("ui/{page}: no <title>"));
            }
            if !l.contains("charset") {
                r.warn(format!("ui/{page}: no <meta charset=\"utf-8\">"));
            }
            if !l.contains("viewport") {
                r.warn(format!("ui/{page}: no viewport meta (the page must work at phone width)"));
            }
        }
    }
    r.info(format!(
        "UI checked: {} file(s), {} KB{}",
        files.len(),
        total / 1024,
        if built { "" } else { " (source, not built)" }
    ));
}

/// The files of a folder, relative paths with `/`.
fn read_tree(root: &Path, skip: &[&str]) -> BTreeMap<String, Vec<u8>> {
    fn walk(root: &Path, d: &Path, skip: &[&str], out: &mut BTreeMap<String, Vec<u8>>) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if skip.contains(&name.as_str()) {
                continue;
            }
            if p.is_dir() {
                walk(root, &p, skip, out);
            } else if let (Ok(rel), Ok(data)) = (p.strip_prefix(root), std::fs::read(&p)) {
                out.insert(rel.to_string_lossy().replace('\\', "/"), data);
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, skip, &mut out);
    out
}

// ------------------------------------------------------------------ i18n

fn filled(s: &str) -> bool {
    !s.trim().is_empty()
}

/// Every declared translation must cover the texts the English manifest has.
pub fn i18n_checks(m: &Manifest, r: &mut Report) {
    for (lang, t) in &m.i18n {
        let mut missing: Vec<String> = Vec::new();
        let mut need = |ok: bool, what: String| {
            if !ok {
                missing.push(what);
            }
        };
        if m.effective_kind() == PluginKind::Language {
            continue;
        }
        need(!filled(&m.description) || t.description.as_deref().is_some_and(filled), "description".into());
        need(
            m.details.as_deref().is_none_or(|d| !filled(d)) || t.details.as_deref().is_some_and(filled),
            "details".into(),
        );
        need(!filled(&m.contribution.label) || t.label.as_deref().is_some_and(filled), "label".into());
        for res in &m.resources {
            let tr = t.resources.get(&res.name);
            need(
                !filled(&res.label) || tr.and_then(|x| x.label.as_deref()).is_some_and(filled),
                format!("resources.{}.label", res.name),
            );
            for f in res.fields.iter().filter(|f| !f.hidden && filled(&f.label)) {
                need(
                    tr.and_then(|x| x.fields.get(&f.key)).is_some_and(|l| filled(l)),
                    format!("resources.{}.fields.{}", res.name, f.key),
                );
            }
        }
        for n in &m.nav {
            need(t.nav.get(&n.id).is_some_and(|l| filled(l)), format!("nav.{}", n.id));
        }
        for k in &m.kpi {
            need(
                t.kpi.get(&k.view).and_then(|x| x.label.as_deref()).is_some_and(filled),
                format!("kpi.{}.label", k.view),
            );
        }
        for p in &m.user_permissions {
            need(t.permissions.contains_key(&p.key), format!("permissions.{}", p.key));
        }
        if !missing.is_empty() {
            r.error(format!("[i18n.{lang}] is incomplete (English is the fallback, but a declared language covers everything): {}", missing.join(", ")));
        }
    }
}

// ------------------------------------------------------------------ the layout contract of mountCrud pages

/// Static checks of the pages built with `mountCrud` (best effort: the source of the UI is read, not run).
pub fn layout_checks(m: &Manifest, ui_src: &BTreeMap<String, Vec<u8>>, r: &mut Report) {
    let sources: Vec<(&String, &str)> = ui_src
        .iter()
        .filter(|(n, _)| {
            n.starts_with("src/") && (n.ends_with(".ts") || n.ends_with(".js")) && !n.ends_with(".test.ts")
        })
        .filter_map(|(n, d)| std::str::from_utf8(d).ok().map(|t| (n, t)))
        .collect();
    let all: String = sources.iter().map(|(_, t)| *t).collect::<Vec<_>>().join("\n");
    let mut calls = 0;
    let mut rest = all.as_str();
    while let Some(i) = rest.find("mountCrud(") {
        rest = &rest[i + "mountCrud(".len()..];
        calls += 1;
        // mountCrud(app, msk, 'resource', { options })
        let args: Vec<&str> = rest.splitn(4, ',').collect();
        if let Some(res) = args.get(2).map(|a| a.trim().trim_matches(['"', '\'', '`'])) {
            let plain = res.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
            if plain && !res.is_empty() && !m.resources.iter().any(|d| d.name == res) {
                r.error(format!(
                    "mountCrud lists the resource '{res}', which [[resources]] does not declare"
                ));
            }
        }
        let window: String = rest.chars().take(900).collect();
        let call: &str = window.split("mountCrud(").next().unwrap_or(&window);
        if !call.contains("title") {
            r.warn("a mountCrud page has no `title` option: the header of the page (title and action) is the shell pattern");
        }
    }
    if calls == 0 {
        return;
    }
    if !all.contains("@mosaikit/plugin-api/style.css")
        && !ui_src
            .get("index.html")
            .and_then(|d| std::str::from_utf8(d).ok())
            .is_some_and(|h| h.contains("style.css"))
    {
        r.error("the pages use mountCrud but the UI never imports '@mosaikit/plugin-api/style.css': header, table and empty state would be unstyled");
    }
    if !all.contains("connect(") {
        r.error("the pages use mountCrud but the UI never calls connect(): the handshake with the shell is missing");
    }
    if all.contains("<table") && !all.contains("gridTable") {
        r.warn("the UI writes its own <table>: the table pattern of the shell is gridTable (docs/refactoring-ui.md)");
    }
    r.info(format!("layout contract: {calls} mountCrud page(s) checked on the source"));
}

// ------------------------------------------------------------------ entry points

/// Strict checks of a plugin folder.
pub fn folder(dir: &Path, m: &Manifest, migrations: &[(String, String)], r: &mut Report) {
    if dir.join("Cargo.toml").is_file() {
        let used = host_use_in_source(&read_sources(&dir.join("src")));
        permission_checks(m, &used, true, r);
        let src = production_source(&read_sources(&dir.join("src")));
        for h in &m.permissions.hooks {
            if !src.contains(&format!("\"{h}.")) {
                r.error(format!("[permissions] hooks lists '{h}' but the logic registers no hook of it (\"{h}.before_create\"...)"));
            }
        }
    } else {
        let p = &m.permissions;
        if p.files_read || p.notify || !p.calls.is_empty() {
            r.error("[permissions] files_read, notify or calls are set but the plugin has no logic (no Cargo.toml)");
        }
    }
    migration_checks(m, migrations, r);
    i18n_checks(m, r);
    if m.ui.is_some() && dir.join("ui").is_dir() {
        let dist = dir.join("ui").join("dist");
        if dist.is_dir() {
            ui_checks(m, &read_tree(&dist, &[]), true, r);
        } else {
            let tree = read_tree(&dir.join("ui"), &["node_modules", "dist", "target", ".git"]);
            ui_checks(m, &tree, false, r);
        }
        let tree = read_tree(&dir.join("ui"), &["node_modules", "dist", "target", ".git"]);
        layout_checks(m, &tree, r);
    }
}

/// Strict checks of a package.
pub fn package(pkg: &mosaikit_mskp::Package, migrations: &[(String, String)], r: &mut Report) {
    let m = &pkg.manifest;
    if let Some(w) = pkg.wasm() {
        permission_checks(m, &host_use_in_wasm(w), false, r);
    }
    migration_checks(m, migrations, r);
    i18n_checks(m, r);
    if m.ui.is_some() {
        let files: BTreeMap<String, Vec<u8>> =
            pkg.ui_files().map(|(p, d)| (p.to_string(), d.to_vec())).collect();
        ui_checks(m, &files, true, r);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(extra: &str) -> Manifest {
        Manifest::from_toml(&format!(
            "id = \"com.test.demo\"\nname = \"Demo\"\nversion = \"0.1.0\"\n[requires]\nmosaikit = \">=1.0, <2\"\napi = 1\n{extra}"
        ))
        .unwrap()
    }

    #[test]
    fn the_source_is_read_for_host_calls() {
        let u = host_use_in_source(
            "fn a(ctx:&Ctx){ ctx.files().list(None); ctx.call_plugin(\"com.x.y\", \"c\", v); }\n// ctx.notify(\n#[cfg(test)] mod t { fn b(){ ctx.http() } }",
        );
        assert!(u.files && u.call_plugin && !u.notify && !u.http);
        assert!(u.called.contains("com.x.y"));
    }

    #[test]
    fn permissions_and_calls_must_agree() {
        let m = manifest("[permissions]\nnotify = true\n");
        let mut r = Report::default();
        permission_checks(&m, &HostUse::default(), true, &mut r);
        assert_eq!(r.errors(), 1, "{:?}", r.findings);
        let mut r = Report::default();
        let used = HostUse { files: true, http: true, ..HostUse::default() };
        permission_checks(&manifest(""), &used, true, &mut r);
        assert_eq!(r.errors(), 2, "{:?}", r.findings);
    }

    #[test]
    fn wasm_literals_are_found() {
        let u = host_use_in_wasm(b"\0asm....plugin.call....files.read");
        assert!(u.call_plugin && u.files && !u.http);
    }

    #[test]
    fn migrations_are_checked_for_sequence_and_loss() {
        let m = manifest("");
        let s = m.schema_name();
        let mig = |n: &str, sql: &str| (n.to_string(), sql.to_string());
        let mut r = Report::default();
        migration_checks(
            &m,
            &[mig("001_a.sql", &format!("create table {s}.t (id int);")), mig("003_b.sql", "select 1;")],
            &mut r,
        );
        assert!(r.errors() == 1 && r.findings.iter().any(|f| f.message.contains("002")), "{:?}", r.findings);
        let mut r = Report::default();
        migration_checks(
            &m,
            &[
                mig("001_a.sql", &format!("create table {s}.t (id int);")),
                mig("002_Bad.sql", &format!("drop table {s}.t;")),
            ],
            &mut r,
        );
        assert_eq!(r.errors(), 2, "{:?}", r.findings);
        let mut r = Report::default();
        migration_checks(
            &m,
            &[mig("001_a.sql", &format!("create table {s}.t (id int);\ncreate index on {s}.t (id);"))],
            &mut r,
        );
        assert_eq!(r.errors(), 0, "{:?}", r.findings);
    }

    #[test]
    fn the_ui_is_checked() {
        let m = manifest("[ui]\nentry = \"index.html\"\n");
        let mut files = BTreeMap::new();
        files.insert("index.html".to_string(), b"<!doctype html><meta charset=utf-8><meta name=viewport content=x><title>t</title><script src=\"https://cdn.example/x.js\"></script><script>alert(1)</script><img src=a.png onerror=\"x()\">".to_vec());
        files.insert(
            "a.css".to_string(),
            b"a{background:url(https://x.example/a.png)} @import url('https://f.example/f.css');".to_vec(),
        );
        files.insert(
            "a.js".to_string(),
            b"fetch(\"https://api.example/x\"); const f = new Function('return 1')".to_vec(),
        );
        let mut r = Report::default();
        ui_checks(&m, &files, true, &mut r);
        assert_eq!(r.errors(), 7, "{:?}", r.findings);
        assert_eq!(r.warnings(), 1);
        // an origin the manifest declares is allowed; local files and data: are not external
        let m =
            manifest("[ui]\nentry = \"index.html\"\n[permissions]\nnetwork = [\"https://api.example\"]\n");
        let mut files = BTreeMap::new();
        files.insert("index.html".to_string(), b"<!doctype html><meta charset=utf-8><meta name=viewport content=x><title>t</title><script type=module src=\"./a.js\"></script>".to_vec());
        files.insert("a.js".to_string(), b"fetch('https://api.example/x'); fetch('/api/x')".to_vec());
        files.insert("a.css".to_string(), b"a{background:url(data:image/png;base64,AA)}".to_vec());
        let mut r = Report::default();
        ui_checks(&m, &files, true, &mut r);
        assert!(r.errors() == 0 && r.warnings() == 0, "{:?}", r.findings);
    }

    #[test]
    fn i18n_must_cover_the_english_texts() {
        let m = Manifest::from_toml(
            "id = \"com.test.demo\"\nname = \"Demo\"\nversion = \"0.1.0\"\ndescription = \"D\"\n[contribution]\nlabel = \"L\"\n[i18n.it]\nname = \"Demo\"\ndescription = \"D\"\n",
        )
        .unwrap();
        let mut r = Report::default();
        i18n_checks(&m, &mut r);
        assert_eq!(r.errors(), 1, "{:?}", r.findings);
        assert!(r.findings[0].message.contains("label"));
    }

    #[test]
    fn mountcrud_pages_follow_the_contract() {
        let m = manifest("[[resources]]\nname = \"notes\"\nlabel = \"N\"\nfields = [{ key = \"t\", label = \"T\", kind = \"text\" }]\n");
        let mut src = BTreeMap::new();
        src.insert("src/main.ts".to_string(), b"mountCrud(app, msk, 'tasks', { newLabel: 'x' })".to_vec());
        let mut r = Report::default();
        layout_checks(&m, &src, &mut r);
        // unknown resource, no style, no connect
        assert_eq!(r.errors(), 3, "{:?}", r.findings);
        src.insert(
            "src/main.ts".to_string(),
            b"import '@mosaikit/plugin-api/style.css'
const msk = await connect()
mountCrud(app, msk, 'notes', { title: 'N' })"
                .to_vec(),
        );
        let mut r = Report::default();
        layout_checks(&m, &src, &mut r);
        assert!(r.errors() == 0 && r.warnings() == 0, "{:?}", r.findings);
    }
}

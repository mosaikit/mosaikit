//! Mosaikit kernel — demo CLI end-to-end:
//!   login (con controllo ruoli) -> installazione .mskp -> attivazione
//!   -> CRUD sulle risorse dei plugin -> disattivazione -> persistenza.
//!
//! Uso:
//!   cargo run -p mosaikit-kernel            # cerca i .mskp nei sibling plugin-*/dist,
//!                                           # altrimenti sintetizza i pacchetti (wasm minimale)
//!   cargo run -p mosaikit-kernel -- file1.mskp file2.mskp ...

use std::collections::BTreeMap;
use std::path::Path;
use mosaikit_kernel::auth::Auth;
use mosaikit_kernel::engine::HeadlessEngine;
use mosaikit_kernel::model::ContentArea;
use mosaikit_kernel::validate::minimal_guest_module;
use mosaikit_kernel::{package, MosaikitApp, Registry};

const PLUGINS: [(&str, &str); 5] = [
    ("plugin-notes", "com.mosaikit.notes"),
    ("plugin-tasks", "com.mosaikit.tasks"),
    ("plugin-contacts", "com.mosaikit.contacts"),
    ("plugin-maps", "com.mosaikit.maps"),
    ("plugin-static-site", "com.mosaikit.static-site"),
];

/// Raccoglie i pacchetti .mskp: da argomenti, dai sibling plugin-*/dist,
/// oppure sintetizzati da plugin.json + wasm minimale (se i plugin non
/// sono ancora stati compilati per wasm32-unknown-unknown).
fn collect_packages(args: &[String]) -> Vec<(String, Vec<u8>, &'static str)> {
    let mut out = Vec::new();
    if !args.is_empty() {
        for a in args {
            let bytes = std::fs::read(a).unwrap_or_else(|e| panic!("lettura {a}: {e}"));
            out.push((a.clone(), bytes, "file"));
        }
        return out;
    }
    for (dir, id) in PLUGINS {
        let dist = format!("../{dir}/dist/{id}.mskp");
        if Path::new(&dist).exists() {
            out.push((id.to_string(), std::fs::read(&dist).unwrap(), "wasm"));
        } else {
            let json = std::fs::read_to_string(format!("../{dir}/plugin.json"))
                .unwrap_or_else(|e| panic!("{dir}/plugin.json: {e} (esegui dalla dir del kernel)"));
            out.push((id.to_string(), package::pack(&json, &minimal_guest_module()), "sintetico"));
        }
    }
    out
}

fn draft(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

fn print_rows(app: &MosaikitApp<HeadlessEngine>) {
    if let ContentArea::Crud(v) = &app.content {
        println!("  [{}] {} righe (filtro: '{}')", v.resource.name, v.rows.len(), v.filter);
        for r in &v.rows {
            let cells: Vec<String> = v.resource.fields.iter()
                .map(|f| r.values.get(&f.key).map(|x| x.display()).unwrap_or_default())
                .collect();
            println!("    #{} {}", r.id, cells.join(" | "));
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut app = MosaikitApp::new(Auth::seeded_persisted(std::path::Path::new("../mosaikit-data")), Registry::new("../mosaikit-data"), HeadlessEngine);

    println!("== Login ==");
    match app.login("admin", "password-sbagliata") {
        Ok(_) => println!("ERRORE: login riuscito con password errata!"),
        Err(e) => println!("password errata rifiutata -> {e}"),
    }
    let admin = app.login("admin", "mosaikit2026!").unwrap();
    println!("admin autenticato");

    println!("\n== Installazione plugin (Admin only) ==");
    for (id, bytes, mode) in collect_packages(&args) {
        match app.install_plugin(&admin, &bytes) {
            Ok(m) => println!("installato {:<28} v{} [{}]", m.id, m.version, mode),
            Err(e) => println!("FALLITO {id}: {e}"),
        }
    }

    println!("\n== Controllo autorizzazioni ==");
    let user = app.login("user", "demo1234").unwrap();
    let fake = package::pack(
        r#"{"id":"com.evil.x","name":"X","version":"0.1.0","min_kernel":"0.1.0","permissions":[],"contribution":{"icon":"X","label":"X","resource":{"name":"xs","fields":[]}}}"#,
        &minimal_guest_module(),
    );
    println!("user tenta installazione -> {}", app.install_plugin(&user, &fake).err().unwrap());

    println!("\n== Attivazione (User puo' attivare) ==");
    for (_, id) in PLUGINS {
        if let Err(e) = app.activate_plugin(&user, id) { println!("  attivazione {id}: {e}"); }
    }
    println!("IconBar:");
    for b in &app.icon_bar {
        println!("  {} {:<10} -> vista '{}'", b.icon, b.label, b.view_id);
    }

    println!("\n== CRUD Note ==");
    app.open_view(&user, "notes").unwrap();
    app.crud_create(&user, &draft(&[("title", "Comprare latte")])).unwrap(); // hook: tag=personale
    app.crud_create(&user, &draft(&[("title", "Roadmap Mosaikit"), ("body", "kernel + wasm"), ("tag", "lavoro")])).unwrap();
    print_rows(&app);
    app.crud_update(&user, 1, &draft(&[("title", "Comprare latte e pane"), ("tag", "personale")])).unwrap();
    app.set_filter("roadmap".into()).unwrap();
    println!("dopo filtro 'roadmap':");
    print_rows(&app);
    app.set_filter(String::new()).unwrap();

    println!("\n== CRUD Attivita' ==");
    app.open_view(&user, "tasks").unwrap();
    app.crud_create(&user, &draft(&[("title", "Scrivere README"), ("priority", "alta")])).unwrap();
    app.crud_create(&user, &draft(&[("title", "Chiudere PoC"), ("due", "2026-10-20"), ("done", "true")])).unwrap();
    print_rows(&app);

    println!("\n== CRUD Contatti ==");
    app.open_view(&user, "contacts").unwrap();
    app.crud_create(&user, &draft(&[("name", "Ada Lovelace"), ("email", "ADA@EXAMPLE.COM")])).unwrap(); // hook: email -> minuscolo
    print_rows(&app);

    println!("\n== CRUD Mappe (integrazione GeoLibre) ==");
    app.open_view(&user, "maps").unwrap();
    app.crud_create(&user, &draft(&[("name", "Centro storico"), ("basemap", "OpenStreetMap"), ("crs", "EPSG:3857")])).unwrap(); // hook: compila geolibre_url
    print_rows(&app);

    println!("\n== CRUD Siti statici (zip) ==");
    // zip di esempio STORED, come se fosse stato uploadato
    let zip = mosaikit_kernel::ziputil::write_stored_zip(&[
        ("index.html".to_string(), b"<h1>Ciao da Mosaikit</h1><p>sito statico nel plugin</p>".to_vec()),
        ("assets/info.txt".to_string(), b"poC mskp+wasm".to_vec()),
    ]);
    // come fa il server su POST /plugins/{id}/storage/unzip: estrazione nello
    // storage del plugin, poi il record punta a cartella + pagina iniziale
    let storage = mosaikit_kernel::vfs::Vfs::for_plugin(&app.registry.data_dir, "com.mosaikit.static-site").unwrap();
    let files = storage.unzip("site-demo", &zip).unwrap();
    app.open_view(&user, "sites").unwrap();
    app.crud_create(&user, &draft(&[
        ("name", "Sito demo"), ("storage", "site-demo"), ("entry", "index.html"),
        ("files", &files.len().to_string()),
    ])).unwrap();
    print_rows(&app);
    // con runtime WASM e' il PLUGIN ad ispezionare lo zip (sandbox) via msk_action;
    // in headless la demo usa le utility generiche del kernel (stesso algoritmo).
    println!("  plugin_action (headless) -> {}",
        app.plugin_action(&user, "com.mosaikit.static-site",
            &format!("{{\"cmd\":\"inspect\",\"zip_b64\":\"{}\"}}",
                mosaikit_kernel::ziputil::base64_encode(&zip))).err().unwrap());
    println!("  ispezione zip (kernel):");
    for e in mosaikit_kernel::ziputil::list_entries(&zip).unwrap() {
        println!("    {} (method {}, {} byte)", e.name, e.method, e.size);
    }
    let html = String::from_utf8(mosaikit_kernel::ziputil::extract_stored(&zip, "index.html").unwrap()).unwrap();
    println!("  contenuto index.html: {}", html);

    println!("\n== Disattivazione ==");
    app.deactivate_plugin(&user, "com.mosaikit.tasks").unwrap();
    for b in &app.icon_bar { println!("  {} {}", b.icon, b.label); }

    app.logout(&user);
    println!("\n== Persistenza (riavvio) ==");
    let mut app2 = MosaikitApp::new(Auth::seeded_persisted(std::path::Path::new("../mosaikit-data")), Registry::new("../mosaikit-data"), HeadlessEngine);
    for m in app2.registry.list() { println!("  installato: {} v{} ({})", m.id, m.version, m.name); }
    // i dati CRUD sopravvivono al riavvio grazie al backend (SQLite/JSON)
    let u2 = app2.login("user", "demo1234").unwrap();
    app2.activate_plugin(&u2, "com.mosaikit.notes").unwrap();
    app2.open_view(&u2, "notes").unwrap();
    println!("  note ricaricate dal DB:");
    print_rows(&app2);
    println!("\nDemo completata.");
}

//! Release: bundle (server + plugin firmati + registry), desktop (zip con
//! PostgreSQL embedded), immagine Docker.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};

use crate::plugins;
use crate::util::{copy_dir, exe, npm, pg_bin, root, run, walk_files, which};

#[derive(Clone, Copy, PartialEq, Eq, clap::ValueEnum, Debug)]
pub enum Flavor {
    /// server (Docker o installazione con PostgreSQL esterno)
    Server,
    /// desktop (PostgreSQL embedded, apre il browser)
    Desktop,
}

fn platform() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

/// `mosaikit.toml` della release, con una descrizione per ogni proprieta'.
fn config(flavor: Flavor, trusted: &str, brand: bool) -> String {
    let d = crate::dist::current();
    let name = &d.product.name;
    let mut l: Vec<String> = Vec::new();
    let mut push = |s: &str| l.push(s.to_string());
    match flavor {
        Flavor::Desktop => {
            push(&format!("# {name} desktop: tutto su questo computer."));
            push("# Tutte le proprieta' disponibili sono descritte in mosaikit.example.toml.");
            push("");
            push("# indirizzo dell'app (UI dei plugin e link pubblici sulla porta successiva)");
            push(&format!("url = \"http://127.0.0.1:{}\"", d.desktop.port));
            push("# cartella dei dati: database, file caricati, log");
            push("data_dir = \"data\"");
            push("# apre il browser all'avvio");
            push("open_browser = true");
        }
        Flavor::Server => {
            push(&format!("# {name} server. Tutte le proprieta' sono descritte in mosaikit.example.toml;"));
            push("# si possono impostare anche con le variabili d'ambiente MOSAIKIT_* (vedi README):");
            push("# MOSAIKIT_URL, MOSAIKIT_PLUGIN_URL, MOSAIKIT_DATABASE_URL, MOSAIKIT_ADMIN_PASSWORD.");
            push("");
            push("# indirizzo pubblico dell'app (in Docker arriva da MOSAIKIT_URL)");
            push("url = \"http://127.0.0.1:8080\"");
            push("# in un container si ascolta su tutte le interfacce, porte interne fisse");
            push("listen = \"0.0.0.0:8080\"");
            push("plugin_listen = \"0.0.0.0:8081\"");
            push("# cartella dei dati (volume)");
            push("data_dir = \"/data\"");
        }
    }
    push("# catalogo dei plugin inclusi nella release (pacchetti firmati)");
    push("registry = \"registry/index.json\"");
    push("# al primo avvio installa e attiva i plugin del catalogo");
    push("preinstall = true");
    push("# chiavi degli editori fidati: si installano solo plugin firmati con queste");
    push(&format!("trusted_keys = [\"{trusted}\"]"));
    if brand {
        push("# cartella del marchio (nome, logo, colori, testi)");
        push("brand = \"branding\"");
    }
    if flavor == Flavor::Desktop {
        push("");
        push("[database]");
        if d.desktop.database == "postgres" {
            push(&format!("# PostgreSQL embedded in data/pg (avviato e fermato da {name})"));
            push("embedded = true");
        } else {
            push("# SQLite: un solo file, data/mosaikit.db");
            push("backend = \"sqlite\"");
        }
    }
    l.join("\n") + "\n"
}

/// Server release + plugin firmati + registry + configurazione in `out`.
pub fn bundle(out: &Path, skip_ui: bool, flavor: Flavor) -> Result<()> {
    let all = plugins::discover()?;
    if !skip_ui {
        plugins::ensure_npm()?;
        run(npm().current_dir(root()).args(["run", "build"]))?;
        plugins::build_ui(&all)?;
    }
    if !root().join("ui").join("host").join("dist").join("index.html").is_file() {
        bail!("UI host non compilata (ui/host/dist): esegui npm run build");
    }
    plugins::build_wasm(&all, true)?;
    let mut build = Command::new("cargo");
    build.current_dir(root()).args(["build", "--release"]);
    if flavor == Flavor::Server {
        build.args(["-p", "mosaikit-server"]);
    } else {
        // un solo eseguibile: app senza console con icona nell'area di notifica,
        // con nome, versione e icona del marchio; da terminale anche i comandi
        // di amministrazione (migrate, reset-password, config)
        let d = crate::dist::current();
        build.args(["-p", "mosaikit-desktop"]);
        build
            .env("MOSAIKIT_PRODUCT_NAME", &d.product.name)
            .env("MOSAIKIT_PRODUCT_VERSION", &d.product.version);
        if let Some(ico) = brand_icon(d) {
            build.env("MOSAIKIT_BRAND_ICON", ico);
        }
    }
    run(&mut build)?;
    std::fs::create_dir_all(out)?;
    let (bin, dest) = match flavor {
        Flavor::Server => (exe("mosaikit-server"), exe("mosaikit-server")),
        Flavor::Desktop => (exe("mosaikit"), exe(&crate::dist::current().executable())),
    };
    {
        std::fs::copy(plugins::target_dir().join("release").join(&bin), out.join(&dest))
            .with_context(|| format!("copia di {bin}"))?;
    }
    plugins::pack_all(&all, true, &out.join("registry"))?;
    let brand = crate::dist::current().brand.dir.clone().filter(|b| b.is_dir());
    if let Some(b) = &brand {
        copy_dir(b, &out.join("branding"))?;
    }
    let trusted = std::fs::read_to_string(out.join("registry").join("trusted_key.txt"))?;
    std::fs::write(out.join("mosaikit.toml"), config(flavor, trusted.trim(), brand.is_some()))?;
    std::fs::copy(root().join("mosaikit.example.toml"), out.join("mosaikit.example.toml"))?;
    eprintln!("bundle pronto in {}", out.display());
    Ok(())
}

/// File .ico del marchio della distribuzione (proprieta' `icon` di brand.toml).
fn brand_icon(d: &crate::dist::Distribution) -> Option<PathBuf> {
    let dir = d.brand.dir.as_ref()?;
    let text = std::fs::read_to_string(dir.join("brand.toml")).ok()?;
    let v: toml::Value = toml::from_str(&text).ok()?;
    let ico = dir.join(v.get("icon")?.as_str()?);
    ico.is_file().then_some(ico)
}

fn avvio(postgres: bool) -> String {
    let d = crate::dist::current();
    let (name, version, exe) = (&d.product.name, &d.product.version, d.executable());
    let port = d.desktop.port;
    let title = format!("{name} {version} - versione desktop");
    let db = if postgres {
        "Al primo avvio crea il database PostgreSQL in data\\pg e installa i plugin inclusi."
    } else {
        "Al primo avvio crea il database (SQLite, data\\mosaikit.db) e installa i plugin inclusi."
    };
    let stop = if postgres { " (ferma anche PostgreSQL)" } else { "" };
    format!(
        "{title}\n{}\n\n\
         1. Avvia {name} (doppio clic su {exe}.exe). Non apre finestre: compare\n   \
            l'icona di {name} nell'area di notifica (accanto all'orologio).\n   \
            {db}\n\
         2. Il browser si apre su http://127.0.0.1:{port} (clic sull'icona per riaprirlo).\n\
         3. Primo accesso: tenant \"system\", utente \"admin\". La password e' in\n   \
            data\\initial-admin-password.txt (menu dell'icona > Credenziali iniziali):\n   \
            cambiala (Account) ed elimina il file.\n\
         4. Per fermare: menu dell'icona > Esci{stop}.\n\n\
         Log: data\\logs\\mosaikit.log (menu dell'icona > Log).\n\
         Backup: a programma fermo copia l'intera cartella data\\.\n\
         Configurazione: mosaikit.toml (ogni proprieta' e' descritta in mosaikit.example.toml).\n\
         Amministrazione, da un terminale nella cartella del programma (a programma fermo):\n   \
            .\\{exe}.exe --help\n   \
            .\\{exe}.exe reset-password --tenant system --user admin\n   \
            .\\{exe}.exe config\n",
        "=".repeat(title.chars().count())
    )
}

/// Zip desktop. Il database e' quello della distribuzione (`[desktop] database`):
/// con "sqlite" non serve altro, con "postgres" si include PostgreSQL (`--pg-dir`).
pub fn desktop(pg_dir: Option<PathBuf>, no_pg: bool) -> Result<()> {
    let d = crate::dist::current();
    let postgres = d.desktop.database == "postgres";
    let name = format!("{}-{}-desktop-{}", d.product.id, d.product.version, platform());
    let dist = dist_dir(d);
    let out = dist.join(&name);
    if out.exists() {
        std::fs::remove_dir_all(&out)?;
    }
    bundle(&out, false, Flavor::Desktop)?;
    std::fs::write(out.join("AVVIO.txt"), avvio(postgres))?;
    if postgres && !no_pg {
        let src = match pg_dir {
            Some(d) => d,
            None => pg_bin().and_then(|b| b.parent().map(Path::to_path_buf)).context(
                "PostgreSQL non trovato: indica --pg-dir (cartella con bin/, lib/, share/) o usa --no-pg",
            )?,
        };
        eprintln!("copio PostgreSQL da {}", src.display());
        for sub in ["bin", "lib", "share"] {
            copy_dir(&src.join(sub), &out.join("pgsql").join(sub))?;
        }
    }
    let zip_path = dist.join(format!("{name}.zip"));
    zip_dir(&out, &name, &zip_path)?;
    checksums(&dist)?;
    println!("\nrelease desktop: {}\n                 {}", out.display(), zip_path.display());
    Ok(())
}

fn zip_dir(dir: &Path, prefix: &str, dest: &Path) -> Result<()> {
    eprintln!("creo {}", dest.display());
    let f = std::fs::File::create(dest)?;
    let mut w = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .large_file(true);
    for (rel, path) in walk_files(dir)? {
        w.start_file(format!("{prefix}/{rel}"), opts)?;
        let mut src = std::fs::File::open(&path)?;
        std::io::copy(&mut src, &mut w)?;
    }
    w.finish()?.flush()?;
    Ok(())
}

/// Cartella delle release della distribuzione: `<distribuzione>/dist`
/// (mosaikit/dist per Mosaikit, geoportal/dist per Geoportal).
fn dist_dir(d: &crate::dist::Distribution) -> PathBuf {
    d.dir.join("dist")
}

/// Immagini Docker salvate nelle cartelle `*-docker` della dist.
fn walk_tars(dist: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(dist)?.flatten() {
        if e.path().is_dir() && e.file_name().to_string_lossy().ends_with("-docker") {
            for f in std::fs::read_dir(e.path())?.flatten() {
                if f.path().extension().is_some_and(|x| x == "tar") {
                    out.push(f.path());
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

fn checksums(dist: &Path) -> Result<()> {
    let mut lines = String::new();
    let mut files: Vec<PathBuf> = std::fs::read_dir(dist)?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "zip" || e == "tar"))
        .collect();
    files.sort();
    for p in files.iter().chain(walk_tars(dist)?.iter()) {
        let mut h = Sha256::new();
        let mut f = std::fs::File::open(p)?;
        std::io::copy(&mut f, &mut h)?;
        lines.push_str(&format!(
            "{}  {}\n",
            hex::encode(h.finalize()),
            p.strip_prefix(dist).unwrap_or(p).to_string_lossy().replace('\\', "/")
        ));
    }
    std::fs::write(dist.join("SHA256SUMS"), lines)?;
    Ok(())
}

/// Immagine Docker della distribuzione attiva (build multi-stage). Il contesto e' la
/// cartella che contiene mosaikit, mosaikit-plugins e le distribuzioni; la chiave di
/// firma arriva come secret di BuildKit.
pub fn docker(tag: Option<String>) -> Result<()> {
    if which("docker").is_none() {
        bail!("docker non trovato");
    }
    let d = crate::dist::current();
    let context = root().parent().context("cartella superiore di mosaikit")?.to_path_buf();
    let rel = |p: &Path| -> Result<String> {
        let abs = std::path::absolute(p)?;
        let base = std::path::absolute(&context)?;
        let r = abs.strip_prefix(&base).map_err(|_| {
            anyhow::anyhow!("{} deve stare accanto a mosaikit ({})", p.display(), base.display())
        })?;
        Ok(r.to_string_lossy().replace('\\', "/"))
    };
    let dist_rel = rel(&d.dir)?;
    for r in &d.plugins.roots {
        rel(r)?;
    }
    let image = d.docker.image.clone().unwrap_or_else(|| d.product.id.clone());
    let tag = tag.unwrap_or_else(|| format!("{image}:{}", d.product.version));
    let (key, source) = plugins::signing_key()?;
    let key_file = root().join(".dev").join("docker-signing.key");
    std::fs::create_dir_all(key_file.parent().expect("cartella .dev"))?;
    std::fs::write(&key_file, mosaikit_mskp::signing_key_to_b64(&key))?;
    eprintln!("firma dei plugin nell'immagine con: {source}");
    let res = run(Command::new("docker")
        .current_dir(&context)
        .env("DOCKER_BUILDKIT", "1")
        .args(["build", "-f", "mosaikit/deploy/Dockerfile", "--build-arg"])
        .arg(format!("DIST={dist_rel}"))
        .args(["-t", &tag, "--secret"])
        .arg(format!("id=signing_key,src={}", key_file.display()))
        .arg("."));
    let _ = std::fs::remove_file(&key_file);
    res?;

    // distribuzione Docker pronta all'uso in <distribuzione>/dist/<id>-<versione>-docker
    let pg = d.docker.postgres_image.clone().unwrap_or_else(|| "postgres:17-alpine".into());
    let (img, ver) = tag.rsplit_once(':').unwrap_or((tag.as_str(), "latest"));
    let dist = dist_dir(d);
    let name = format!("{}-{}-docker", d.product.id, d.product.version);
    let out = dist.join(&name);
    if out.exists() {
        std::fs::remove_dir_all(&out)?;
    }
    std::fs::create_dir_all(&out)?;
    std::fs::copy(root().join("deploy").join("compose.yml"), out.join("compose.yml"))?;
    copy_dir(&root().join("deploy").join("initdb"), &out.join("initdb"))?;
    std::fs::write(out.join(".env"), docker_env(img, ver, &pg))?;
    let tar = format!("{}-{}-image.tar", d.product.id, d.product.version);
    eprintln!("salvo l'immagine in {}", out.join(&tar).display());
    run(Command::new("docker").args(["save", "-o"]).arg(out.join(&tar)).arg(&tag))?;
    std::fs::write(out.join("AVVIO.txt"), docker_avvio(&tar, &pg))?;
    checksums(&dist)?;
    println!("\nimmagine pronta: {tag}\ndistribuzione Docker: {}", out.display());
    Ok(())
}

/// Variabili del compose (lette da `.env` accanto a compose.yml).
fn docker_env(image: &str, version: &str, pg: &str) -> String {
    let name = &crate::dist::current().product.name;
    format!(
        "# {name} con Docker: valori usati da compose.yml (modificali prima del primo avvio)\n\
         MOSAIKIT_IMAGE={image}\n\
         MOSAIKIT_VERSION={version}\n\
         # PostgreSQL (con PostGIS per le distribuzioni geografiche)\n\
         POSTGRES_IMAGE={pg}\n\
         POSTGRES_PASSWORD=cambia-questa-password\n\
         MOSAIKIT_DB_PASSWORD=cambia-anche-questa\n\
         # password iniziale di admin (tenant system), solo al primo avvio\n\
         MOSAIKIT_ADMIN_PASSWORD=cambiami-subito\n\
         # indirizzi pubblici: app (anche con percorso base) e plugin (origine diversa)\n\
         MOSAIKIT_URL=http://localhost:8080\n\
         MOSAIKIT_PLUGIN_URL=http://localhost:8081\n\
         # porte pubblicate sull'host\n\
         MOSAIKIT_HTTP_PORT=8080\n\
         MOSAIKIT_PLUGIN_PORT=8081\n\
         # true solo dietro un reverse proxy che imposta X-Forwarded-For\n\
         MOSAIKIT_TRUST_PROXY=false\n"
    )
}

fn docker_avvio(tar: &str, pg: &str) -> String {
    let d = crate::dist::current();
    let title = format!("{} {} - distribuzione Docker", d.product.name, d.product.version);
    format!(
        "{title}\n{}\n\n\
         1. Carica l'immagine:            docker load -i {tar}\n\
         2. Modifica .env: password, indirizzi (MOSAIKIT_URL, MOSAIKIT_PLUGIN_URL) e porte.\n\
         3. Avvia:                         docker compose up -d\n\
            (PostgreSQL: {pg}, scaricato da Docker Hub al primo avvio)\n\
         4. Apri MOSAIKIT_URL: tenant \"system\", utente \"admin\", password MOSAIKIT_ADMIN_PASSWORD.\n\n\
         Produzione: un reverse proxy HTTPS con due hostname, uno per l'app (porta\n\
         MOSAIKIT_HTTP_PORT) e uno per plugin e contenuti (MOSAIKIT_PLUGIN_PORT).\n\
         Dati: volumi pgdata (database) e appdata (file caricati, plugin).\n\
         Aggiornamento: docker load della nuova immagine, MOSAIKIT_VERSION in .env,\n\
         docker compose up -d (le migrazioni si applicano all'avvio).\n",
        "=".repeat(title.chars().count())
    )
}

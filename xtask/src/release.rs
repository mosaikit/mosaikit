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
         1. Avvia {name} (doppio clic su {exe}.exe). Compare l'icona di {name}\n   \
            nell'area di notifica (accanto all'orologio); se l'avvio richiede qualche\n   \
            secondo, una finestrella ne mostra versione e avanzamento.\n   \
            {db}\n\
         2. Al primo avvio il browser si apre su http://127.0.0.1:{port}; dai successivi\n   \
            compare una notifica di Windows con l'indirizzo (clic per aprirlo).\n   \
            Per riaprire l'app: clic sull'icona.\n\
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
/// (mosaikit/dist per Mosaikit).
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
    // contesto di build: mosaikit, le cartelle dei plugin e la distribuzione, copiati
    // (senza build, dipendenze e dati) in una cartella temporanea con la stessa
    // disposizione relativa che hanno in locale
    let parent = root().parent().context("cartella superiore di mosaikit")?.to_path_buf();
    let rel = |p: &Path| -> Result<PathBuf> {
        let abs = std::path::absolute(p)?;
        let base = std::path::absolute(&parent)?;
        Ok(abs
            .strip_prefix(&base)
            .map_err(|_| {
                anyhow::anyhow!("{} deve stare accanto a mosaikit ({})", p.display(), base.display())
            })?
            .to_path_buf())
    };
    let mut dirs: Vec<PathBuf> = vec![rel(&root())?, rel(&d.dir)?];
    for r in &d.plugins.roots {
        dirs.push(rel(r)?);
    }
    dirs.sort();
    dirs.dedup();
    // una cartella gia' dentro un'altra della lista si copia con quella
    let tops: Vec<PathBuf> =
        dirs.iter().filter(|x| !dirs.iter().any(|y| y != *x && x.starts_with(y))).cloned().collect();
    let context = std::env::temp_dir().join(format!("mosaikit-docker-{}", d.product.id));
    if context.exists() {
        std::fs::remove_dir_all(&context)?;
    }
    for t in &tops {
        copy_sources(&parent.join(t), &context.join(t))?;
    }
    let dist_rel = rel(&d.dir)?.to_string_lossy().replace('\\', "/");
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
    let _ = std::fs::remove_dir_all(&context);
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
    let vars = deploy_vars(img, ver, &pg);
    std::fs::write(
        out.join("README.md"),
        render(&std::fs::read_to_string(root().join("deploy").join("README.docker.md"))?, &vars),
    )?;
    // la stessa immagine anche per Kubernetes
    let k = k8s_dir(img, ver)?;
    checksums(&dist)?;
    println!(
        "\nimmagine pronta: {tag}\ndistribuzione Docker:     {}\ndistribuzione Kubernetes: {}",
        out.display(),
        k.display()
    );
    Ok(())
}

/// Segnaposto dei modelli di deploy (`{{id}}`, `{{image}}`...).
fn deploy_vars(image: &str, version: &str, pg: &str) -> Vec<(&'static str, String)> {
    let d = crate::dist::current();
    let (pg_repo, pg_tag) = pg.rsplit_once(':').unwrap_or((pg, "latest"));
    vec![
        ("id", d.product.id.clone()),
        ("name", d.product.name.clone()),
        ("version", version.to_string()),
        ("image", image.to_string()),
        ("postgres_image", pg.to_string()),
        ("postgres_repo", pg_repo.to_string()),
        ("postgres_tag", pg_tag.to_string()),
    ]
}

fn render(text: &str, vars: &[(&str, String)]) -> String {
    vars.iter().fold(text.to_string(), |acc, (k, v)| acc.replace(&format!("{{{{{k}}}}}"), v))
}

/// Manifest Kubernetes (kustomize) in `<distribuzione>/dist/<id>-<versione>-k8s`,
/// dai modelli di `deploy/k8s`.
fn k8s_dir(image: &str, version: &str) -> Result<PathBuf> {
    let d = crate::dist::current();
    let pg = d.docker.postgres_image.clone().unwrap_or_else(|| "postgres:17-alpine".into());
    let vars = deploy_vars(image, version, &pg);
    let out = dist_dir(d).join(format!("{}-{}-k8s", d.product.id, d.product.version));
    if out.exists() {
        std::fs::remove_dir_all(&out)?;
    }
    std::fs::create_dir_all(&out)?;
    for (rel, path) in walk_files(&root().join("deploy").join("k8s"))? {
        let dest = out.join(&rel);
        std::fs::create_dir_all(dest.parent().expect("cartella"))?;
        std::fs::write(&dest, render(&std::fs::read_to_string(&path)?, &vars))?;
    }
    copy_dir(&root().join("deploy").join("initdb"), &out.join("initdb"))?;
    // verifica dei manifest, se kubectl c'e' (kustomize incluso, nessun cluster richiesto)
    if which("kubectl").is_some() {
        let o = Command::new("kubectl").arg("kustomize").arg(&out).output()?;
        if !o.status.success() {
            bail!("manifest Kubernetes non validi: {}", String::from_utf8_lossy(&o.stderr));
        }
        eprintln!("manifest Kubernetes verificati con kubectl kustomize");
    }
    Ok(out)
}

/// Solo i manifest Kubernetes (senza costruire l'immagine).
pub fn k8s(tag: Option<String>) -> Result<()> {
    let d = crate::dist::current();
    let image = d.docker.image.clone().unwrap_or_else(|| d.product.id.clone());
    let tag = tag.unwrap_or_else(|| format!("{image}:{}", d.product.version));
    let (img, ver) = tag.rsplit_once(':').unwrap_or((tag.as_str(), "latest"));
    let out = k8s_dir(img, ver)?;
    println!(
        "\ndistribuzione Kubernetes: {}\n(l'immagine {tag} si costruisce con `release docker`)",
        out.display()
    );
    Ok(())
}

/// Tutte le release della distribuzione: desktop, Docker e Kubernetes. Senza Docker
/// attivo si generano solo i manifest Kubernetes (l'immagine va costruita dopo).
pub fn all(pg_dir: Option<PathBuf>, no_pg: bool) -> Result<()> {
    desktop(pg_dir, no_pg)?;
    let docker_ok = which("docker").is_some()
        && Command::new("docker").arg("info").output().map(|o| o.status.success()).unwrap_or(false);
    if docker_ok {
        docker(None)
    } else {
        eprintln!(
            "Docker non disponibile: salto l'immagine e la cartella Docker, genero i manifest Kubernetes"
        );
        k8s(None)
    }
}

/// Copia i sorgenti di un progetto per il contesto Docker: niente build, dipendenze,
/// release, dati di sviluppo ne' repository git.
fn copy_sources(from: &Path, to: &Path) -> Result<()> {
    const SKIP: &[&str] =
        &["target", "node_modules", "dist", ".dev", ".git", "test-results", "playwright-report"];
    std::fs::create_dir_all(to)?;
    for e in std::fs::read_dir(from).with_context(|| format!("lettura {}", from.display()))? {
        let e = e?;
        let name = e.file_name();
        if e.file_type()?.is_dir() {
            if !SKIP.contains(&name.to_string_lossy().as_ref()) {
                copy_sources(&e.path(), &to.join(&name))?;
            }
        } else if !name.to_string_lossy().ends_with(".key") {
            std::fs::copy(e.path(), to.join(&name))
                .with_context(|| format!("copia {}", e.path().display()))?;
        }
    }
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

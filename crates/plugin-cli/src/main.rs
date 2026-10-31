//! `mosaikit-plugin` executable.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use anyhow::{bail, Result};
use clap::{Parser, Subcommand};
use mosaikit_plugin_cli::{install, package, project, scaffold, toolchain, validate, Plugin};

#[derive(Parser)]
#[command(name = "mosaikit-plugin", version, about = "Tool of Mosaikit plugin developers")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// New plugin from the template (a folder of its own, or a member of the workspaces of the folder)
    New {
        name: String,
        /// id of the plugin (default com.example.<name>)
        #[arg(long)]
        id: Option<String>,
        /// what the plugin is: app (logic and UI, the default), ui, service, extension, language, layout
        #[arg(long, value_parser = parse_variant)]
        variant: Option<scaffold::Variant>,
        /// a complete commented example with a walkthrough: todo, insights, note-priority
        #[arg(long, value_parser = parse_example)]
        example: Option<scaffold::Example>,
        /// language code of a language plugin (default: the part of the name after `lang-`)
        #[arg(long)]
        lang: Option<String>,
        /// without WASM logic (manifest, migrations and UI only)
        #[arg(long)]
        no_logic: bool,
        /// without UI (manifest, migrations and logic only)
        #[arg(long)]
        no_ui: bool,
        /// folder to create the plugin folder in (default: the current one)
        #[arg(long)]
        into: Option<PathBuf>,
        /// use the plugin SDK from this folder instead of the published one
        #[arg(long, env = "MOSAIKIT_SDK_PATH")]
        sdk_path: Option<PathBuf>,
        /// use @mosaikit/plugin-api from this folder instead of the published one
        #[arg(long, env = "MOSAIKIT_PLUGIN_API_PATH")]
        plugin_api_path: Option<PathBuf>,
        /// folder of an unpacked Mosaikit kit: its sdk/ and plugin-api/ stand for the two paths above
        #[arg(long, env = "MOSAIKIT_KIT")]
        kit: Option<PathBuf>,
        /// run `npm install` after adding the UI to an npm workspace
        #[arg(long)]
        install: bool,
    },
    /// Builds the logic (WASM) and the UI of a plugin
    Build {
        #[arg(default_value = ".")]
        dir: PathBuf,
        #[arg(long)]
        release: bool,
    },
    /// Builds, validates and packs a plugin into a signed .mskp
    Pack {
        #[arg(default_value = ".")]
        dir: PathBuf,
        #[arg(long)]
        release: bool,
        /// folder of the package (default: dist in the plugin folder)
        #[arg(long)]
        out: Option<PathBuf>,
        /// private key file (default: MOSAIKIT_SIGNING_KEY, MOSAIKIT_SIGNING_KEY_FILE, then the development key)
        #[arg(long)]
        key: Option<PathBuf>,
        /// pack what is already built
        #[arg(long)]
        no_build: bool,
    },
    /// Validates the plugin, runs the tests of its logic and the type check of its UI
    Test {
        #[arg(default_value = ".")]
        dir: PathBuf,
    },
    /// Signs a .mskp again with another key (or signs an unsigned one)
    Sign {
        package: PathBuf,
        #[arg(long)]
        key: Option<PathBuf>,
        /// write the signed package here (default: over the original)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Generates an ed25519 key pair to sign packages
    Keygen {
        /// file for the private key (it is never overwritten)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Checks the manifest, migrations and permissions of a plugin folder or a .mskp
    Validate {
        #[arg(default_value = ".")]
        path: PathBuf,
    },
    /// Uploads a .mskp to a test server (as an Administrator would from the shell)
    Install {
        package: PathBuf,
        /// address of the server, with its base path if it has one (http://localhost:8080)
        #[arg(long)]
        server: String,
        #[arg(long, env = "MOSAIKIT_ADMIN_USER")]
        user: Option<String>,
        #[arg(long, env = "MOSAIKIT_ADMIN_PASSWORD", hide_env_values = true)]
        password: Option<String>,
        /// current code of the second factor, if the Administrator has one
        #[arg(long)]
        totp: Option<String>,
    },
    /// Checks the toolchain: Rust, the wasm32 target, Node
    Doctor {
        /// install what is missing and can be installed (the wasm32 target)
        #[arg(long)]
        fix: bool,
    },
    /// Development server with hot reload (arrives with phase 4 of the dev kit)
    Dev,
}

fn parse_variant(s: &str) -> Result<scaffold::Variant, String> {
    scaffold::Variant::parse(s).map_err(|e| e.to_string())
}

fn parse_example(s: &str) -> Result<scaffold::Example, String> {
    scaffold::Example::parse(s).map_err(|e| e.to_string())
}

fn plugin(dir: &Path) -> Result<Plugin> {
    Plugin::load(dir)
}

fn run(cli: Cli) -> Result<ExitCode> {
    match cli.cmd {
        Cmd::New {
            name,
            id,
            variant,
            example,
            lang,
            no_logic,
            no_ui,
            into,
            sdk_path,
            plugin_api_path,
            kit,
            install,
        } => {
            let dir = scaffold::new_plugin(&scaffold::NewOptions {
                name,
                id,
                variant,
                example,
                lang,
                no_logic,
                no_ui,
                into: into.unwrap_or_else(|| PathBuf::from(".")),
                sdk_path,
                plugin_api_path,
                kit,
                install,
            })?;
            println!("plugin created in {}", dir.display());
            println!("  next: cd {} && mosaikit-plugin build && mosaikit-plugin pack", dir.display());
        }
        Cmd::Build { dir, release } => {
            let p = plugin(&dir)?;
            project::build_wasm(std::slice::from_ref(&p), release)?;
            project::build_ui(std::slice::from_ref(&p))?;
        }
        Cmd::Pack { dir, release, out, key, no_build } => {
            let p = plugin(&dir)?;
            let report = validate::validate(&p.dir)?;
            if !report.ok() {
                report.print();
                bail!("{}: the plugin does not validate, nothing was packed", p.id);
            }
            if !no_build {
                project::build_wasm(std::slice::from_ref(&p), release)?;
                project::build_ui(std::slice::from_ref(&p))?;
            }
            let (k, source) = package::signing_key(key.as_deref(), &package::default_key_path())?;
            eprintln!("signing with: {source}");
            let out = out.unwrap_or_else(|| p.dir.join("dist"));
            let (path, sha) = package::pack(&p, release, &k, &out)?;
            let after = validate::validate(&path)?;
            if !after.ok() {
                after.print();
                bail!("the package does not validate");
            }
            println!("{}\nsha256 {sha}\npublisher key {}", path.display(), mosaikit_mskp::public_key_b64(&k));
        }
        Cmd::Test { dir } => mosaikit_plugin_cli::test(&plugin(&dir)?)?,
        Cmd::Sign { package: file, key, out } => {
            let (k, source) = package::signing_key(key.as_deref(), &package::default_key_path())?;
            eprintln!("signing with: {source}");
            let (path, sha, public) = package::sign(&file, &k, out.as_deref())?;
            println!("{}\nsha256 {sha}\npublisher key {public}", path.display());
        }
        Cmd::Keygen { out } => {
            let (private, public) = package::keygen(out.as_deref())?;
            match &out {
                Some(p) => println!("private key saved in {}", p.display()),
                None => println!("private key (MOSAIKIT_SIGNING_KEY): {private}"),
            }
            println!("public key (trusted_keys):            {public}");
        }
        Cmd::Validate { path } => {
            let report = validate::validate(&path)?;
            report.print();
            if !report.ok() {
                return Ok(ExitCode::from(1));
            }
        }
        Cmd::Install { package: file, server, user, password, totp } => {
            let done = install::install(
                &server,
                &file,
                &install::Login {
                    user: user.unwrap_or_default(),
                    password: password.unwrap_or_default(),
                    totp,
                },
            )?;
            println!("installed {} {} ({})", done.id, done.version, done.status);
            match done.signed_by {
                Some(k) => println!("signed by {k}"),
                None => println!("unsigned"),
            }
        }
        Cmd::Doctor { fix } => {
            let checks = toolchain::doctor(fix);
            toolchain::print(&checks);
            if !toolchain::all_good(&checks) {
                return Ok(ExitCode::from(1));
            }
        }
        Cmd::Dev => {
            eprintln!("`dev` arrives with phase 4 of the dev kit (docs/plugin-devkit-plan.md): the bundled development server.");
            eprintln!("Until then: mosaikit-plugin build --release, mosaikit-plugin pack and mosaikit-plugin install --server <url>.");
            return Ok(ExitCode::from(2));
        }
    }
    Ok(ExitCode::SUCCESS)
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("error: {e:#}");
            ExitCode::from(1)
        }
    }
}

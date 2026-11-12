//! `mosaikit-product` executable.

use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::Result;
use clap::{Parser, Subcommand};
use mosaikit_plugin_cli::package;
use mosaikit_product_cli::{build, dev, scaffold, validate, Distribution};

#[derive(Parser)]
#[command(name = "mosaikit-product", version, about = "Tool of the publishers of products built on Mosaikit")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// A new product folder: distribution.toml, brand, plugins, shared code, tests, CI file, README
    New {
        /// the id of the product (lower case, digits, '-')
        name: String,
        /// folder to create the product folder in (default: the current one)
        #[arg(long)]
        into: Option<PathBuf>,
    },
    /// Checks the product: distribution.toml, brand, its plugins (strict) and the policy tables (by the server of the base)
    Validate {
        #[arg(default_value = ".")]
        dir: PathBuf,
        /// the mosaikit-server of the base (default: MOSAIKIT_SERVER_BIN, then next to this tool)
        #[arg(long, env = "MOSAIKIT_SERVER_BIN")]
        server: Option<PathBuf>,
        /// the desktop kit (folder, .zip or a released version such as 1.0.1, downloaded once): warns when an official plugin of `include` is not in its registry
        #[arg(long, env = "MOSAIKIT_BASE")]
        base: Option<PathBuf>,
    },
    /// Starts the base in the developer profile with the brand, the policy and the plugins of the product
    Dev {
        #[arg(default_value = ".")]
        dir: PathBuf,
        /// the desktop kit (folder, .zip or a released version such as 1.0.1): its registry gives the official plugins (default: the version of this tool, when the product keeps official plugins)
        #[arg(long, env = "MOSAIKIT_BASE")]
        base: Option<PathBuf>,
        #[arg(long, env = "MOSAIKIT_SERVER_BIN")]
        server: Option<PathBuf>,
        #[arg(long)]
        port: Option<u16>,
        #[arg(long)]
        data: Option<PathBuf>,
        #[arg(long)]
        no_open: bool,
        #[arg(long)]
        no_build: bool,
        /// start from an empty database
        #[arg(long)]
        fresh: bool,
        /// run on a PostgreSQL database of this computer instead of SQLite (for plugins with `[requires] database = "postgres"`,
        /// PostGIS...): `postgres://user:password@localhost:5432/name`, an empty database prepared as the section on PostgreSQL
        /// of docs/devkit/data.md says. Not read from the environment of the shell, on purpose
        #[arg(long, env = "MOSAIKIT_DEV_DATABASE_URL")]
        database: Option<String>,
    },
    /// Proves the product: validation, then it starts on the base and is checked (brand, About, test users, plugins)
    Test {
        #[arg(default_value = ".")]
        dir: PathBuf,
        #[arg(long, env = "MOSAIKIT_BASE")]
        base: Option<PathBuf>,
        #[arg(long, env = "MOSAIKIT_SERVER_BIN")]
        server: Option<PathBuf>,
        /// an older mosaikit-server: the product runs on it first, then on the new one with the same data (upgrade test)
        #[arg(long)]
        upgrade_from: Option<PathBuf>,
        #[arg(long)]
        no_build: bool,
        /// also check the shell with the brand of the product in a browser (layout slice, accessibility); needs
        /// Playwright installed in the product folder
        #[arg(long)]
        browser: bool,
        /// a command of the product to run against the running product, for its own tests (HTTP, browser, a script):
        /// it gets MOSAIKIT_APP, MOSAIKIT_TENANT, MOSAIKIT_TEST_USERS, MOSAIKIT_TEST_PASSWORD and MOSAIKIT_BRAND_NAME and
        /// passes when it exits with 0. More than one is allowed
        #[arg(long = "run")]
        run: Vec<String>,
        /// run on a PostgreSQL database of this computer instead of SQLite, as `dev --database`
        #[arg(long, env = "MOSAIKIT_DEV_DATABASE_URL")]
        database: Option<String>,
    },
    /// A release of the product from a compiled base
    Build {
        #[command(subcommand)]
        target: Target,
    },
    /// Signs a package again with the key of the product
    Sign {
        file: PathBuf,
        #[arg(long)]
        key: Option<PathBuf>,
    },
    /// What the tool needs, and what is missing
    Doctor,
}

#[derive(Subcommand)]
enum Target {
    /// The folder of the desktop release: the executable of the base renamed, plugins, registry, brand, configuration
    Desktop {
        #[arg(default_value = ".")]
        dir: PathBuf,
        /// the desktop kit of the base: its folder, its .zip or a released version such as 1.0.1 (downloaded once,
        /// checked). Optional: the version of this tool, which is the version of the Mosaikit it came with
        #[arg(long, env = "MOSAIKIT_BASE")]
        base: Option<PathBuf>,
        #[command(flatten)]
        common: Common,
    },
    /// The folder of the Docker release: Dockerfile on the base image, registry, brand, configuration, compose file
    Docker {
        #[arg(default_value = ".")]
        dir: PathBuf,
        /// the base image (default: ghcr.io/mosaikit/mosaikit:v<version of the base>)
        #[arg(long)]
        base_image: Option<String>,
        /// the desktop kit of the base (folder, .zip or a version such as 1.0.1), for the registry of the official plugins.
        /// Optional: the version of this tool
        #[arg(long, env = "MOSAIKIT_BASE")]
        base: Option<PathBuf>,
        /// run `docker build` too
        #[arg(long)]
        build: bool,
        #[command(flatten)]
        common: Common,
    },
    /// The kustomize overlay of the product over the k8s folder of the base kit
    K8s {
        #[arg(default_value = ".")]
        dir: PathBuf,
        /// a k8s folder to use instead of the manifests built into this kit (the same version as the kit)
        #[arg(long)]
        base_k8s: Option<PathBuf>,
        #[command(flatten)]
        common: Common,
    },
}

#[derive(clap::Args)]
struct Common {
    /// folder of the release (default: dist/<id>-<version>-<target>)
    #[arg(long)]
    out: Option<PathBuf>,
    /// the signing key of the product (default: MOSAIKIT_SIGNING_KEY, MOSAIKIT_SIGNING_KEY_FILE, then the development key)
    #[arg(long)]
    key: Option<PathBuf>,
    #[arg(long)]
    release: bool,
    /// pack what is already built
    #[arg(long)]
    no_build: bool,
}

impl Common {
    fn options(self) -> build::Options {
        build::Options { out: self.out, key: self.key, release: self.release, no_build: self.no_build }
    }
}

fn run(cli: Cli) -> Result<ExitCode> {
    match cli.cmd {
        Cmd::New { name, into } => {
            let root = scaffold::new_product(&name, &into.unwrap_or_else(|| PathBuf::from(".")))?;
            println!("created {}\nnext: cd {} && mosaikit-product validate", root.display(), root.display());
        }
        Cmd::Validate { dir, server, base } => {
            let base = mosaikit_product_cli::basefetch::for_product(&dir, base)?;
            let r = validate::validate(&dir, &validate::Options { server, base })?;
            r.print();
            if !r.ok() {
                return Ok(ExitCode::from(1));
            }
        }
        Cmd::Dev { dir, base, server, port, data, no_open, no_build, fresh, database } => {
            let base = mosaikit_product_cli::basefetch::for_product(&dir, base)?;
            dev::dev(&dev::Options { dir, base, server, port, data, no_open, no_build, fresh, database })?;
        }
        Cmd::Test { dir, base, server, upgrade_from, no_build, browser, run, database } => {
            let base = mosaikit_product_cli::basefetch::for_product(&dir, base)?;
            let r = mosaikit_product_cli::test::test(&mosaikit_product_cli::test::Options {
                dir,
                base,
                server,
                upgrade_from,
                no_build,
                browser,
                run,
                database,
            })?;
            r.print();
            if !r.ok() {
                return Ok(ExitCode::from(1));
            }
        }
        Cmd::Build { target } => match target {
            Target::Desktop { dir, base, common } => {
                let base = mosaikit_product_cli::basefetch::resolve(
                    base.unwrap_or_else(mosaikit_product_cli::basefetch::this_version),
                )?;
                build::desktop(&Distribution::load(&dir)?, &base, &common.options())?;
            }
            Target::Docker { dir, base_image, base, build: run_build, common } => {
                let base = base.unwrap_or_else(mosaikit_product_cli::basefetch::this_version);
                let image = match (base_image, mosaikit_product_cli::basefetch::version_of(&base)) {
                    (Some(i), _) => i,
                    (None, Some(v)) => format!("ghcr.io/mosaikit/mosaikit:v{v}"),
                    (None, None) => anyhow::bail!(
                        "give --base-image: the image of the base, for example ghcr.io/mosaikit/mosaikit:v<version>"
                    ),
                };
                let base = mosaikit_product_cli::basefetch::resolve(base)?;
                build::docker(&Distribution::load(&dir)?, &base, &image, run_build, &common.options())?;
            }
            Target::K8s { dir, base_k8s, common } => {
                build::k8s(&Distribution::load(&dir)?, base_k8s.as_deref(), &common.options())?;
            }
        },
        Cmd::Sign { file, key } => {
            let (k, source) = package::signing_key(key.as_deref(), &package::default_key_path())?;
            let (path, sha, public) = package::sign(&file, &k, None)?;
            println!("signed {} with {source}\nsha256 {sha}\npublic key {public}", path.display());
        }
        Cmd::Doctor => return doctor(),
    }
    Ok(ExitCode::SUCCESS)
}

fn doctor() -> Result<ExitCode> {
    let mut bad = false;
    let mut line = |name: &str, found: Option<String>, hint: &str| match found {
        Some(w) => println!("  ok       {name}: {w}"),
        None => {
            bad = bad || !hint.starts_with("optional");
            println!("  missing  {name}: {hint}");
        }
    };
    line(
        "mosaikit-server",
        mosaikit_plugin_cli::dev::find_server(None).ok().map(|p| p.display().to_string()),
        "the server of the base: --server, MOSAIKIT_SERVER_BIN, or next to this tool (needed by dev and by the policy check)",
    );
    line(
        "mosaikit-plugin",
        mosaikit_plugin_cli::util::which("mosaikit-plugin").map(|p| p.display().to_string()),
        "optional: the tool of the plugins, to make the own plugins of the product",
    );
    line(
        "docker",
        mosaikit_plugin_cli::util::which("docker").map(|p| p.display().to_string()),
        "optional: only for `build docker --build`",
    );
    if cfg!(windows) {
        line(
            "rcedit",
            mosaikit_plugin_cli::util::which("rcedit").map(|p| p.display().to_string()),
            "optional: sets the name, version and icon of the desktop executable",
        );
    }
    let key = package::default_key_path();
    line(
        "signing key",
        key.is_file().then(|| key.display().to_string()),
        "optional: made at the first build, or give --key / MOSAIKIT_SIGNING_KEY",
    );
    Ok(if bad { ExitCode::from(1) } else { ExitCode::SUCCESS })
}

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: {e:#}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_takes_the_browser_flag_and_runs_without_it_by_default() {
        let c = Cli::try_parse_from(["mosaikit-product", "test"]).unwrap();
        assert!(matches!(c.cmd, Cmd::Test { browser: false, .. }));
        let c = Cli::try_parse_from(["mosaikit-product", "test", "--browser", "--no-build"]).unwrap();
        assert!(matches!(c.cmd, Cmd::Test { browser: true, no_build: true, .. }));
    }
}

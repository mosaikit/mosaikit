//! Administration commands from the command line, shared by `mosaikit-server` and
//! the desktop executable: migrations, reset of password and second factor, configuration.

use clap::Subcommand;
use mosaikit_kernel::{identity, Config, Kernel};

#[derive(Subcommand, Clone, Debug)]
pub enum AdminCmd {
    /// Applies the database migrations and exits
    Migrate,
    /// Resets the password of a user (the new password is read from MOSAIKIT_NEW_PASSWORD or from stdin)
    ResetPassword {
        /// tenant of the user (default: the system tenant, that is an Administrator)
        #[arg(long, default_value = "system")]
        tenant: String,
        #[arg(long)]
        user: String,
    },
    /// Removes the second factor of an Administrator (lost phone, no recovery code)
    ResetTotp {
        #[arg(long)]
        user: String,
    },
    /// Prints the resolved configuration (without secrets)
    Config,
    /// Checks the product policy of a distribution.toml (base range, defaults, locked settings, languages,
    /// first start, database extensions) against this base, and prints what it sets; exits with 1 on a mistake
    CheckDistribution {
        /// the distribution.toml (or the folder that has it)
        file: std::path::PathBuf,
    },
}

/// Runs a command; returns the exit code.
pub async fn run(cfg: Config, cmd: AdminCmd) -> i32 {
    if let AdminCmd::CheckDistribution { file } = &cmd {
        return check_distribution(file);
    }
    if let AdminCmd::Config = cmd {
        println!("data_dir       = {}", cfg.data_dir.display());
        println!("url            = {}  (listening on {})", cfg.app_url, cfg.bind);
        println!("plugin_url     = {}  (listening on {})", cfg.plugin_url, cfg.untrusted_bind);
        let db = match cfg.backend() {
            mosaikit_kernel::config::Backend::Sqlite => format!("sqlite ({})", cfg.sqlite_file().display()),
            _ if cfg.database.embedded => "postgres embedded".to_string(),
            _ => "postgres".to_string(),
        };
        println!("database       = {db}");
        println!(
            "brand          = {}",
            cfg.brand.as_ref().map(|b| b.display().to_string()).unwrap_or_default()
        );
        println!("allow_unsigned = {}", cfg.allow_unsigned);
        println!("admin_totp     = {}", cfg.admin_totp);
        println!("dev            = {}", cfg.dev.enabled);
        println!("developer      = {}", cfg.developer_profile);
        return 0;
    }
    let k = match Kernel::start(cfg).await {
        Ok(k) => k,
        Err(e) => {
            eprintln!("start failed: {e}");
            return 1;
        }
    };
    let code = match cmd {
        AdminCmd::Migrate => {
            println!("database updated");
            0
        }
        AdminCmd::ResetPassword { tenant, user } => {
            let pw = std::env::var("MOSAIKIT_NEW_PASSWORD").unwrap_or_else(|_| {
                eprintln!("new password:");
                let mut s = String::new();
                let _ = std::io::stdin().read_line(&mut s);
                s.trim().to_string()
            });
            match identity::reset_password(&k, &tenant, &user, &pw).await {
                Ok(()) => {
                    println!("password updated, sessions closed");
                    0
                }
                Err(e) => {
                    eprintln!("{e}");
                    1
                }
            }
        }
        AdminCmd::ResetTotp { user } => match identity::reset_admin_totp(&k, &user).await {
            Ok(()) => {
                println!("second factor removed: at the next sign-in {user} registers the app again");
                0
            }
            Err(e) => {
                eprintln!("{e}");
                1
            }
        },
        AdminCmd::Config | AdminCmd::CheckDistribution { .. } => 0,
    };
    k.shutdown().await;
    code
}

/// `check-distribution`: the same checks the kernel makes at start, without starting it.
fn check_distribution(file: &std::path::Path) -> i32 {
    let path = if file.is_dir() { file.join("distribution.toml") } else { file.to_path_buf() };
    let f = match mosaikit_kernel::seed::SeedFile::load(&path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("{}: {}", path.display(), e.message);
            return 1;
        }
    };
    match mosaikit_kernel::product::ProductPolicy::from_seed(&f, mosaikit_kernel::product::BASE_VERSION) {
        Ok(p) => {
            println!("base           = Mosaikit {}", mosaikit_kernel::product::BASE_VERSION);
            println!("product base   = {}", p.base.as_deref().unwrap_or("any"));
            println!("defaults       = {}", p.defaults.keys().cloned().collect::<Vec<_>>().join(", "));
            println!("locked         = {}", p.locked.join(", "));
            println!("first tenant   = {}", p.bootstrap.tenant.as_deref().unwrap_or("-"));
            println!("extensions     = {}", p.extensions.join(", "));
            0
        }
        Err(e) => {
            eprintln!("{}: {}", path.display(), e.message);
            1
        }
    }
}

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
}

/// Runs a command; returns the exit code.
pub async fn run(cfg: Config, cmd: AdminCmd) -> i32 {
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
        AdminCmd::Config => 0,
    };
    k.shutdown().await;
    code
}

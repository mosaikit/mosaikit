//! Comandi di amministrazione da riga di comando, comuni a `mosaikit-server` e
//! all'eseguibile desktop: migrazioni, reset di password e secondo fattore, configurazione.

use clap::Subcommand;
use mosaikit_kernel::{identity, Config, Kernel};

#[derive(Subcommand, Clone, Debug)]
pub enum AdminCmd {
    /// Applica le migrazioni del database ed esce
    Migrate,
    /// Reimposta la password di un utente (la nuova password e' letta da MOSAIKIT_NEW_PASSWORD o da stdin)
    ResetPassword {
        /// tenant dell'utente (default: il tenant di sistema, cioe' un Administrator)
        #[arg(long, default_value = "system")]
        tenant: String,
        #[arg(long)]
        user: String,
    },
    /// Toglie il secondo fattore di un Administrator (telefono perso, nessun codice di recupero)
    ResetTotp {
        #[arg(long)]
        user: String,
    },
    /// Stampa la configurazione risolta (senza segreti)
    Config,
}

/// Esegue un comando; ritorna il codice di uscita.
pub async fn run(cfg: Config, cmd: AdminCmd) -> i32 {
    if let AdminCmd::Config = cmd {
        println!("data_dir       = {}", cfg.data_dir.display());
        println!("url            = {}  (in ascolto su {})", cfg.app_url, cfg.bind);
        println!("plugin_url     = {}  (in ascolto su {})", cfg.plugin_url, cfg.untrusted_bind);
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
            eprintln!("avvio non riuscito: {e}");
            return 1;
        }
    };
    let code = match cmd {
        AdminCmd::Migrate => {
            println!("database aggiornato");
            0
        }
        AdminCmd::ResetPassword { tenant, user } => {
            let pw = std::env::var("MOSAIKIT_NEW_PASSWORD").unwrap_or_else(|_| {
                eprintln!("nuova password:");
                let mut s = String::new();
                let _ = std::io::stdin().read_line(&mut s);
                s.trim().to_string()
            });
            match identity::reset_password(&k, &tenant, &user, &pw).await {
                Ok(()) => {
                    println!("password aggiornata, sessioni chiuse");
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
                println!("secondo fattore rimosso: al prossimo accesso {user} registra di nuovo l'app");
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

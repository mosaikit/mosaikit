//! Kernel Mosaikit: domain-agnostic.
//!
//! Conosce tenant, utenti, risorse, permessi, link pubblici, KPI e plugin; ogni
//! dominio vive nei plugin. L'accesso ai dati dei plugin passa sempre da una
//! transazione con il ruolo del plugin e il contesto dell'utente (RLS).
//! Vedi `docs/architettura.md`.

pub mod acl;
pub mod blobs;
pub mod brand;
pub mod config;
pub mod content;
pub mod crud;
pub mod embedded;
mod error;
pub mod events;
pub mod files;
mod host;
pub mod identity;
pub mod kpi;
pub mod links;
pub mod overview;
pub mod plugins;
pub mod tenancy;
pub mod testing;
mod util;

use std::sync::Arc;

use mosaikit_db::{Ctx, Db};
use serde::Serialize;
use tokio::sync::{broadcast, Semaphore};
use uuid::Uuid;

pub use config::Config;
pub use error::{Error, Kind, Result};

pub const KERNEL_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Utente autenticato (dalla sessione).
#[derive(Debug, Clone, Serialize)]
pub struct SessionUser {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: String,
    pub home_tenant_id: Uuid,
    pub home_tenant_slug: String,
    pub is_system_admin: bool,
    #[serde(skip)]
    pub csrf: String,
    #[serde(skip)]
    pub token_hash: Vec<u8>,
}

/// Ruolo in un tenant. Il terzo ruolo, Administrator, e' di sistema
/// (`SessionUser::is_system_admin`) e non dipende dal tenant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    /// Tenant Manager: membri, gruppi, impostazioni, KPI e riassegnazione delle risorse del tenant
    TenantManager,
    /// User: le proprie risorse e quelle condivise con lui
    User,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::TenantManager => "tenant_manager",
            Role::User => "user",
        }
    }
    pub fn parse(s: &str) -> Result<Role> {
        match s {
            "tenant_manager" => Ok(Role::TenantManager),
            "user" => Ok(Role::User),
            _ => Err(Error::bad(format!("ruolo non valido: {s} (tenant_manager o user)"))),
        }
    }
    pub fn label(self) -> &'static str {
        match self {
            Role::TenantManager => "Tenant Manager",
            Role::User => "User",
        }
    }
}

/// Policy di un tenant.
#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq)]
pub struct TenantSettings {
    #[serde(default = "yes")]
    pub public_links_enabled: bool,
    /// durata massima dei link pubblici in giorni (0 = nessun limite)
    #[serde(default = "d_link_days")]
    pub public_link_max_days: u32,
    #[serde(default = "yes")]
    pub managers_see_titles: bool,
}

fn yes() -> bool {
    true
}
fn d_link_days() -> u32 {
    30
}

impl Default for TenantSettings {
    fn default() -> TenantSettings {
        serde_json::from_str("{}").expect("settings di default")
    }
}

/// Tenant attivo della richiesta, con il ruolo dell'utente.
#[derive(Debug, Clone, Serialize)]
pub struct TenantCtx {
    pub tenant_id: Uuid,
    pub slug: String,
    pub name: String,
    pub role: Role,
    pub settings: TenantSettings,
}

/// Chi esegue un'operazione nel tenant attivo.
#[derive(Debug, Clone)]
pub struct Caller {
    pub user: SessionUser,
    pub tenant: TenantCtx,
}

impl Caller {
    pub fn ctx(&self) -> Ctx {
        Ctx::user(self.user.user_id, self.tenant.tenant_id)
    }
    pub fn is_manager(&self) -> bool {
        self.tenant.role == Role::TenantManager
    }
    pub fn require_manager(&self) -> Result<()> {
        if self.is_manager() {
            Ok(())
        } else {
            Err(Error::forbidden("operazione riservata al Tenant Manager"))
        }
    }
}

/// Notifiche per la UI in modalita' sviluppo (hot reload).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DevEvent {
    PluginChanged { id: String, what: String },
    PluginError { id: String, error: String },
}

pub struct Kernel {
    pub cfg: Config,
    pub db: Db,
    pub plugins: plugins::Plugins,
    pub engine: Arc<mosaikit_runtime::Engine>,
    pub blobs: blobs::Blobs,
    /// marchio del prodotto (nome, logo, colori)
    pub brand: brand::Brand,
    pub(crate) trusted: mosaikit_mskp::TrustedKeys,
    pub(crate) limiter: identity::LoginLimiter,
    pub(crate) argon: Arc<Semaphore>,
    pub http: reqwest::Client,
    pub dev_events: broadcast::Sender<DevEvent>,
    /// segreto per i cookie firmati (sblocco dei link con password)
    pub(crate) cookie_secret: Vec<u8>,
    embedded: tokio::sync::Mutex<Option<embedded::EmbeddedPg>>,
    /// riferimento a se stesso (chiamate tra plugin dalla logica WASM)
    me: std::sync::OnceLock<std::sync::Weak<Kernel>>,
}

impl Kernel {
    /// Avvio completo: database (o PostgreSQL embedded), bootstrap, plugin.
    pub async fn start(cfg: Config) -> Result<Arc<Kernel>> {
        Kernel::start_with_progress(cfg, &|_| {}).await
    }

    /// Come `start`, comunicando le fasi dell'avvio (es. alla finestra di avvio desktop).
    pub async fn start_with_progress(
        mut cfg: Config,
        progress: &(dyn Fn(&str) + Send + Sync),
    ) -> Result<Arc<Kernel>> {
        cfg.derive()?;
        std::fs::create_dir_all(&cfg.data_dir)?;
        let mut embedded = None;
        let max = cfg.database.max_connections.max(2);
        progress("Preparazione del database");
        let db = if cfg.backend() == config::Backend::Sqlite {
            let file = cfg.sqlite_file();
            tracing::info!("database SQLite: {}", file.display());
            Db::open_sqlite(&file, max).await?
        } else {
            let url = if cfg.database.embedded {
                progress("Avvio di PostgreSQL");
                let pg = embedded::EmbeddedPg::start(&cfg).await?;
                progress("Preparazione del database");
                let url = pg.url.clone();
                embedded = Some(pg);
                url
            } else {
                cfg.database.url.clone().ok_or_else(|| Error::bad("database.url mancante"))?
            };
            Db::connect(&url, max).await?
        };
        mosaikit_db::query(
            "insert into core.secrets (name, value) values ('cookie', $1) on conflict do nothing",
        )
        .bind(rand::random::<[u8; 32]>().to_vec())
        .execute(&db)
        .await?;
        let cookie_secret: Vec<u8> =
            mosaikit_db::query_scalar("select value from core.secrets where name = 'cookie'")
                .fetch_one(&db)
                .await?;
        let brand = match &cfg.brand {
            Some(dir) => brand::Brand::load(dir)?,
            None => brand::Brand::default(),
        };
        let trusted = mosaikit_mskp::TrustedKeys::from_b64(&cfg.trusted_keys)?;
        let (dev_events, _) = broadcast::channel(64);
        let kernel = Arc::new(Kernel {
            blobs: blobs::Blobs::new(cfg.data_dir.join("blobs")),
            brand,
            plugins: plugins::Plugins::default(),
            engine: Arc::new(mosaikit_runtime::Engine::new(mosaikit_runtime::Limits::default())),
            trusted,
            limiter: identity::LoginLimiter::default(),
            argon: Arc::new(Semaphore::new(4)),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|e| Error::internal(e.to_string()))?,
            dev_events,
            cookie_secret,
            embedded: tokio::sync::Mutex::new(embedded),
            me: std::sync::OnceLock::new(),
            cfg,
            db,
        });
        let _ = kernel.me.set(Arc::downgrade(&kernel));
        identity::bootstrap(&kernel).await?;
        progress("Caricamento dei plugin");
        plugins::load_installed(&kernel).await?;
        if kernel.cfg.dev.enabled {
            plugins::dev::load_all(&kernel).await;
            plugins::dev::watch(kernel.clone());
        }
        if kernel.cfg.preinstall {
            progress("Installazione dei plugin");
            plugins::registry::preinstall(&kernel).await?;
        }
        blobs::gc(&kernel).await;
        Ok(kernel)
    }

    pub(crate) fn arc(&self) -> Option<Arc<Kernel>> {
        self.me.get().and_then(std::sync::Weak::upgrade)
    }

    /// Ferma il PostgreSQL embedded (se presente).
    pub async fn shutdown(&self) {
        self.db.close().await;
        if let Some(pg) = self.embedded.lock().await.take() {
            pg.stop();
        }
    }

    pub(crate) fn emit(&self, e: DevEvent) {
        let _ = self.dev_events.send(e);
    }
}

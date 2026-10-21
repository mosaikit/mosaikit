//! Database usa e getta per i test.
//!
//! Serve `MOSAIKIT_TEST_DATABASE_URL`: un ruolo con CREATEDB e CREATEROLE
//! (con `cargo xtask db up` e' `mosaikit_dev` sul cluster di sviluppo).
//! Ogni test crea il proprio database `msk_t_<casuale>`; alla fine database e
//! ruoli con quel prefisso vengono rimossi.

use std::str::FromStr;

use sqlx::postgres::PgConnectOptions;
use sqlx::{ConnectOptions, Connection};

pub const ENV: &str = "MOSAIKIT_TEST_DATABASE_URL";

/// URL di default: il cluster di `cargo xtask db up`.
pub const DEFAULT_URL: &str = "postgres://mosaikit_dev:mosaikit_dev@127.0.0.1:55432/postgres";

pub struct TestDb {
    pub name: String,
    pub url: String,
    admin: PgConnectOptions,
}

impl TestDb {
    pub async fn create() -> TestDb {
        let admin_url = std::env::var(ENV).unwrap_or_else(|_| DEFAULT_URL.to_string());
        let admin = PgConnectOptions::from_str(&admin_url).expect("MOSAIKIT_TEST_DATABASE_URL non valido");
        let name = format!("msk_t_{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);
        let mut conn = admin.connect().await.unwrap_or_else(|e| {
            panic!("PostgreSQL di test non raggiungibile ({e}): avvia `cargo xtask db up` o imposta {ENV}")
        });
        sqlx::raw_sql(&format!("create database {name}")).execute(&mut conn).await.expect("create database");
        conn.close().await.ok();
        let url = admin.clone().database(&name).to_url_lossy().to_string();
        TestDb { name, url, admin }
    }

    async fn cleanup(admin: PgConnectOptions, name: String) {
        let Ok(mut conn) = admin.connect().await else { return };
        let _ =
            sqlx::raw_sql(&format!("drop database if exists {name} with (force)")).execute(&mut conn).await;
        let roles: Vec<String> =
            sqlx::query_scalar("select rolname::text from pg_roles where rolname like $1")
                .bind(format!("{name}\\_%"))
                .fetch_all(&mut conn)
                .await
                .unwrap_or_default();
        for r in roles {
            let _ = sqlx::raw_sql(&format!("drop role if exists \"{r}\"")).execute(&mut conn).await;
        }
        conn.close().await.ok();
    }
}

impl Drop for TestDb {
    fn drop(&mut self) {
        let admin = self.admin.clone();
        let name = self.name.clone();
        // runtime dedicato: Drop puo' avvenire dentro o fuori da tokio
        let _ = std::thread::spawn(move || {
            if let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() {
                rt.block_on(Self::cleanup(admin, name));
            }
        })
        .join();
    }
}

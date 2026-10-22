//! Throwaway databases for the tests.
//!
//! It needs `MOSAIKIT_TEST_DATABASE_URL`: a role with CREATEDB and CREATEROLE
//! (with `cargo xtask db up` it is `mosaikit_dev` on the development cluster).
//! Every test creates its own database `msk_t_<random>`; at the end databases and
//! roles with that prefix are removed.

use std::str::FromStr;

use sqlx::postgres::PgConnectOptions;
use sqlx::{ConnectOptions, Connection};

pub const ENV: &str = "MOSAIKIT_TEST_DATABASE_URL";

/// Default URL: the cluster of `cargo xtask db up`.
pub const DEFAULT_URL: &str = "postgres://mosaikit_dev:mosaikit_dev@127.0.0.1:55432/postgres";

pub struct TestDb {
    pub name: String,
    pub url: String,
    admin: PgConnectOptions,
}

impl TestDb {
    pub async fn create() -> TestDb {
        let admin_url = std::env::var(ENV).unwrap_or_else(|_| DEFAULT_URL.to_string());
        let admin = PgConnectOptions::from_str(&admin_url).expect("invalid MOSAIKIT_TEST_DATABASE_URL");
        let name = format!("msk_t_{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);
        let mut conn = admin.connect().await.unwrap_or_else(|e| {
            panic!("test PostgreSQL not reachable ({e}): run `cargo xtask db up` or set {ENV}")
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
        // dedicated runtime: Drop may happen inside or outside tokio
        let _ = std::thread::spawn(move || {
            if let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() {
                rt.block_on(Self::cleanup(admin, name));
            }
        })
        .join();
    }
}

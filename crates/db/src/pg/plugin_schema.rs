//! Schema e ruolo di un plugin: provisioning, migrazioni, congelamento.
//!
//! Durante una migrazione gli oggetti dello schema appartengono al ruolo del
//! plugin e le istruzioni girano con quel ruolo (`SET LOCAL ROLE`): non possono
//! toccare `core` ne' altri plugin. Dopo, `freeze` riporta tutto al ruolo app,
//! verifica le regole (resource_id/tenant_id, niente policy proprie...), aggiunge
//! FK e policy RLS e concede al plugin solo il DML.

use sqlx::Row;

use super::PgTx as Tx;
use crate::{qi, ql, DbError, FinalizeReport, Result};

#[derive(Debug, Clone)]
pub struct PgPluginSchema {
    #[allow(dead_code)]
    pub plugin_id: String,
    pub schema: String,
    pub role: String,
    pub reporting_role: String,
    /// schemi delle estensioni richieste (es. `public` per PostGIS), dopo quello del plugin
    pub extra_path: Vec<String>,
}

/// Funzioni `core` che i ruoli dei plugin possono eseguire.
const CORE_GRANTS: &[&str] = &[
    "core.set_ctx(bytea, uuid, uuid, text, uuid)",
    "core.ctx_user()",
    "core.ctx_tenant()",
    "core.ctx_plugin()",
    "core.level_of(uuid)",
    "core.can_access(uuid, int)",
    "core.create_resource(text, text, uuid, jsonb)",
    "core.update_resource(uuid, text, jsonb, bigint)",
    "core.move_resource(uuid, uuid)",
    "core.delete_resource(uuid)",
];

impl PgPluginSchema {
    fn s(&self) -> String {
        qi(&self.schema)
    }
    fn r(&self) -> String {
        qi(&self.role)
    }
    fn search_path(&self) -> String {
        std::iter::once(self.s()).chain(self.extra_path.iter().map(|e| qi(e))).collect::<Vec<_>>().join(", ")
    }

    /// Una istruzione alla volta, senza cache dei prepared statement (DDL).
    /// Non si usa `raw_sql`: la sua future non e' `Send` per ogni lifetime.
    async fn exec(tx: &mut Tx, sql: &str) -> Result<()> {
        sqlx::query(sql).persistent(false).execute(&mut **tx).await.map_err(|e| {
            DbError::Invalid(format!("{e} (in: {})", sql.chars().take(160).collect::<String>()))
        })?;
        Ok(())
    }

    /// Crea (o aggiorna) ruolo e schema del plugin. Idempotente.
    pub async fn provision(&self, tx: &mut Tx, password: &str) -> Result<()> {
        let exists: bool = sqlx::query_scalar("select exists (select 1 from pg_roles where rolname = $1)")
            .bind(&self.role)
            .fetch_one(&mut **tx)
            .await?;
        if !exists {
            Self::exec(tx, &format!("create role {} login noinherit password {}", self.r(), ql(password)))
                .await?;
        } else {
            Self::exec(tx, &format!("alter role {} login password {}", self.r(), ql(password))).await?;
        }
        let r = self.r();
        let s = self.s();
        Self::exec(tx, &format!("alter role {r} connection limit 16")).await?;
        Self::exec(tx, &format!("alter role {r} set search_path = {}", self.search_path())).await?;
        Self::exec(tx, &format!("alter role {r} set statement_timeout = '15s'")).await?;
        Self::exec(tx, &format!("alter role {r} set idle_in_transaction_session_timeout = '60s'")).await?;
        // il ruolo app deve poter assumere il ruolo del plugin (migrazioni, cambio proprietario)
        Self::exec(tx, &format!("grant {r} to current_user")).await?;
        Self::exec(tx, &format!("create schema if not exists {s}")).await?;
        Self::exec(tx, &format!("grant usage on schema core to {r}")).await?;
        Self::exec(tx, &format!("grant usage on schema {s} to {r}")).await?;
        for f in CORE_GRANTS {
            Self::exec(tx, &format!("grant execute on function {f} to {r}")).await?;
        }
        Self::exec(tx, &format!("grant select on core.visible_resources to {r}")).await?;
        Ok(())
    }

    /// Relazioni dello schema: (nome, relkind). Esclude le sequenze legate a colonne.
    async fn relations(&self, tx: &mut Tx) -> Result<Vec<(String, String)>> {
        let rows = sqlx::query(
            "select c.relname::text, c.relkind::text from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = $1 and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
               and not (c.relkind = 'S' and exists (
                   select 1 from pg_depend d
                   where d.objid = c.oid and d.classid = 'pg_class'::regclass and d.deptype in ('a', 'i')))
             order by c.relname",
        )
        .bind(&self.schema)
        .fetch_all(&mut **tx)
        .await?;
        Ok(rows.iter().map(|r| (r.get::<String, _>(0), r.get::<String, _>(1))).collect())
    }

    async fn set_owner(&self, tx: &mut Tx, owner: &str) -> Result<()> {
        for (name, kind) in self.relations(tx).await? {
            let what = match kind.as_str() {
                "v" => "view",
                "S" => "sequence",
                "m" => "materialized view",
                "f" => "foreign table",
                _ => "table",
            };
            Self::exec(tx, &format!("alter {what} {}.{} owner to {owner}", self.s(), qi(&name))).await?;
        }
        Ok(())
    }

    /// Prepara lo schema per una migrazione: oggetti al ruolo del plugin, CREATE concesso.
    pub async fn thaw(&self, tx: &mut Tx) -> Result<()> {
        // il nuovo proprietario deve avere CREATE sullo schema
        Self::exec(tx, &format!("grant create on schema {} to {}", self.s(), self.r())).await?;
        self.set_owner(tx, &self.r()).await
    }

    /// Esegue istruzioni gia' verificate da sql-guard con il ruolo del plugin.
    pub async fn run_as_plugin(&self, tx: &mut Tx, statements: &[String]) -> Result<()> {
        Self::exec(tx, &format!("set local search_path = {}", self.search_path())).await?;
        Self::exec(tx, &format!("set local role {}", self.r())).await?;
        for stmt in statements {
            Self::exec(tx, stmt).await?;
        }
        Self::exec(tx, "reset role").await?;
        Self::exec(tx, "set local search_path = core, public").await
    }

    /// Riporta lo schema al ruolo app e applica le regole di sicurezza.
    pub async fn freeze(&self, tx: &mut Tx) -> Result<FinalizeReport> {
        let s = self.s();
        let r = self.r();
        Self::exec(tx, "reset role").await?;
        Self::exec(tx, &format!("revoke create on schema {s} from {r}")).await?;

        let funcs: i64 = sqlx::query_scalar(
            "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1",
        )
        .bind(&self.schema)
        .fetch_one(&mut **tx)
        .await?;
        if funcs > 0 {
            return Err(DbError::Invalid("lo schema del plugin non puo' contenere funzioni".into()));
        }

        // PostgreSQL verifica i privilegi delle viste solo all'uso: una vista su
        // core.users creata dal plugin, passata al ruolo app, li esporrebbe.
        let outside: Vec<String> = sqlx::query_scalar(
            "select distinct v.relname::text || ' -> ' || dn.nspname::text || '.' || d.relname::text
             from pg_rewrite rw
             join pg_class v on v.oid = rw.ev_class
             join pg_namespace vn on vn.oid = v.relnamespace
             join pg_depend dep on dep.objid = rw.oid and dep.classid = 'pg_rewrite'::regclass
                               and dep.refclassid = 'pg_class'::regclass
             join pg_class d on d.oid = dep.refobjid
             join pg_namespace dn on dn.oid = d.relnamespace
             where vn.nspname = $1 and d.oid <> v.oid and dn.nspname <> $1",
        )
        .bind(&self.schema)
        .fetch_all(&mut **tx)
        .await?;
        if let Some(o) = outside.first() {
            return Err(DbError::Invalid(format!(
                "una vista del plugin usa oggetti fuori dal suo schema: {o}"
            )));
        }

        let rels = self.relations(tx).await?;
        for (name, kind) in &rels {
            if kind == "m" || kind == "f" {
                return Err(DbError::Invalid(format!(
                    "oggetto non ammesso: {name} (vista materializzata o tabella esterna)"
                )));
            }
        }
        self.set_owner(tx, "current_user").await?;

        let mut report = FinalizeReport::default();
        for (name, kind) in &rels {
            let t = format!("{s}.{}", qi(name));
            match kind.as_str() {
                "r" | "p" => {
                    self.check_table_columns(tx, name).await?;
                    let foreign: i64 = sqlx::query_scalar(
                        "select count(*) from pg_policies where schemaname = $1 and tablename = $2
                           and policyname not like 'msk\\_%'",
                    )
                    .bind(&self.schema)
                    .bind(name)
                    .fetch_one(&mut **tx)
                    .await?;
                    if foreign > 0 {
                        return Err(DbError::Invalid(format!(
                            "la tabella {name} ha policy non gestite dall'host"
                        )));
                    }
                    let has_fk: bool = sqlx::query_scalar(
                        "select exists (select 1 from pg_constraint
                           where conrelid = ($1 || '.' || $2)::regclass and contype = 'f'
                             and confrelid = 'core.resources'::regclass)",
                    )
                    .bind(qi(&self.schema))
                    .bind(qi(name))
                    .fetch_one(&mut **tx)
                    .await?;
                    if !has_fk {
                        Self::exec(
                            tx,
                            &format!(
                                "alter table {t} add constraint {} foreign key (resource_id) \
                                 references core.resources(id) on delete cascade",
                                qi(&format!("msk_{name}_resource_fk"))
                            ),
                        )
                        .await?;
                    }
                    let has_index: bool = sqlx::query_scalar(
                        "select exists (select 1 from pg_index i
                           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                           where i.indrelid = ($1 || '.' || $2)::regclass and a.attname = 'resource_id')",
                    )
                    .bind(qi(&self.schema))
                    .bind(qi(name))
                    .fetch_one(&mut **tx)
                    .await?;
                    if !has_index {
                        Self::exec(tx, &format!("create index on {t} (resource_id)")).await?;
                    }
                    Self::exec(tx, &format!("alter table {t} enable row level security")).await?;
                    for p in ["msk_select", "msk_insert", "msk_update", "msk_delete"] {
                        Self::exec(tx, &format!("drop policy if exists {p} on {t}")).await?;
                    }
                    Self::exec(
                        tx,
                        &format!(
                        "create policy msk_select on {t} for select using (core.can_access(resource_id, 1))"
                    ),
                    )
                    .await?;
                    Self::exec(
                        tx,
                        &format!(
                            "create policy msk_insert on {t} for insert \
                         with check (core.can_access(resource_id, 2) and tenant_id = core.ctx_tenant())"
                        ),
                    )
                    .await?;
                    Self::exec(
                        tx,
                        &format!(
                        "create policy msk_update on {t} for update using (core.can_access(resource_id, 2)) \
                         with check (core.can_access(resource_id, 2) and tenant_id = core.ctx_tenant())"
                    ),
                    )
                    .await?;
                    Self::exec(
                        tx,
                        &format!(
                        "create policy msk_delete on {t} for delete using (core.can_access(resource_id, 2))"
                    ),
                    )
                    .await?;
                    Self::exec(tx, &format!("revoke all on {t} from {r}")).await?;
                    Self::exec(tx, &format!("grant select, insert, update, delete on {t} to {r}")).await?;
                    report.tables.push(name.clone());
                }
                "v" if name.starts_with("kpi_") => {
                    let has_tenant: bool = sqlx::query_scalar(
                        "select exists (select 1 from information_schema.columns
                           where table_schema = $1 and table_name = $2 and column_name = 'tenant_id')",
                    )
                    .bind(&self.schema)
                    .bind(name)
                    .fetch_one(&mut **tx)
                    .await?;
                    if !has_tenant {
                        return Err(DbError::Invalid(format!(
                            "la vista KPI {name} deve avere la colonna tenant_id"
                        )));
                    }
                    // definer (proprietario app): aggrega su tutti i tenant; il plugin non la legge
                    Self::exec(tx, &format!("alter view {t} set (security_invoker = false)")).await?;
                    Self::exec(tx, &format!("revoke all on {t} from {r}")).await?;
                    Self::exec(tx, &format!("grant select on {t} to {}", qi(&self.reporting_role))).await?;
                    report.kpi_views.push(name.clone());
                }
                "v" => {
                    // invoker: la vista non scavalca la RLS delle tabelle
                    Self::exec(tx, &format!("alter view {t} set (security_invoker = true)")).await?;
                    Self::exec(tx, &format!("revoke all on {t} from {r}")).await?;
                    Self::exec(tx, &format!("grant select on {t} to {r}")).await?;
                    report.views.push(name.clone());
                }
                _ => {}
            }
        }
        Self::exec(tx, &format!("grant usage, select, update on all sequences in schema {s} to {r}")).await?;
        Self::exec(tx, &format!("grant usage on schema {s} to {}", qi(&self.reporting_role))).await?;
        Ok(report)
    }

    async fn check_table_columns(&self, tx: &mut Tx, table: &str) -> Result<()> {
        for col in ["resource_id", "tenant_id"] {
            let ok: bool = sqlx::query_scalar(
                "select exists (select 1 from information_schema.columns
                   where table_schema = $1 and table_name = $2 and column_name = $3
                     and data_type = 'uuid' and is_nullable = 'NO')",
            )
            .bind(&self.schema)
            .bind(table)
            .bind(col)
            .fetch_one(&mut **tx)
            .await?;
            if !ok {
                return Err(DbError::Invalid(format!(
                    "la tabella {table} deve avere la colonna {col} uuid not null"
                )));
            }
        }
        Ok(())
    }

    /// Colonne di una tabella dello schema: (nome, tipo di information_schema).
    pub async fn columns(&self, tx: &mut Tx, table: &str) -> Result<Vec<(String, String)>> {
        let rows = sqlx::query(
            "select column_name::text, data_type::text from information_schema.columns
             where table_schema = $1 and table_name = $2 order by ordinal_position",
        )
        .bind(&self.schema)
        .bind(table)
        .fetch_all(&mut **tx)
        .await?;
        Ok(rows.iter().map(|r| (r.get(0), r.get(1))).collect())
    }

    /// Rimuove schema e ruolo (disinstallazione).
    pub async fn drop(&self, tx: &mut Tx) -> Result<()> {
        Self::exec(tx, &format!("drop schema if exists {} cascade", self.s())).await?;
        let exists: bool = sqlx::query_scalar("select exists (select 1 from pg_roles where rolname = $1)")
            .bind(&self.role)
            .fetch_one(&mut **tx)
            .await?;
        if exists {
            Self::exec(tx, &format!("drop owned by {}", self.r())).await?;
            Self::exec(tx, &format!("drop role {}", self.r())).await?;
        }
        Ok(())
    }
}

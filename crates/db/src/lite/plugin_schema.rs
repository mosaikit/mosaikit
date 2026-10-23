//! Space of a plugin on SQLite: tables `plg_<id>__<name>`, real KPI views,
//! normal views stored in `core_plugin_views` and expanded at every use.
//!
//! `freeze` checks the same rules as PostgreSQL (resource_id and tenant_id
//! required, index on resource_id, KPI views with tenant_id) and creates the triggers
//! that, in the transactions of the plugins, refuse rows that are not allowed (like the
//! `WITH CHECK` clauses of the RLS policies).

use std::sync::Arc;

use mosaikit_sql_guard::sqlite::{self as tr, Mode, Translated};

use super::{Inner, LiteTx};
use crate::value::Param;
use crate::{DbError, FinalizeReport, Result};

pub struct LitePluginSchema {
    pub plugin_id: String,
    pub schema: String,
    pub(crate) db: Arc<Inner>,
}

fn q(s: &str) -> String {
    format!("\"{}\"", s.replace('"', "\"\""))
}

const DENY: &str = "SELECT RAISE(ABORT, 'mosaikit[42501]: row not allowed by the access rules')";

impl LitePluginSchema {
    fn prefix(&self) -> String {
        format!("{}__", self.schema)
    }

    pub async fn provision(&self, _tx: &mut LiteTx) -> Result<()> {
        Ok(())
    }

    async fn objects(&self, tx: &mut LiteTx, kinds: &str) -> Result<Vec<(String, String)>> {
        let (rows, _) = tx
            .raw(
                format!(
                    "select name, type from sqlite_master where type in ({kinds}) and substr(name, 1, length(?1)) = ?1 \
                     order by case type when 'trigger' then 0 when 'view' then 1 when 'index' then 2 else 3 end, name"
                ),
                vec![Param::Text(self.prefix())],
                true,
            )
            .await?;
        rows.iter().map(|r| Ok((r.try_get(0)?, r.try_get(1)?))).collect()
    }

    /// Statements already checked by sql-guard, translated into the space of the plugin.
    pub async fn run_as_plugin(&self, tx: &mut LiteTx, statements: &[String]) -> Result<()> {
        for stmt in statements {
            let scope = tx.reload_scope(&self.plugin_id).await?;
            let out = tr::translate(stmt, Mode::Migration(&scope)).map_err(|e| {
                DbError::Invalid(format!("{e} (in: {})", stmt.chars().take(160).collect::<String>()))
            })?;
            for t in out {
                match t {
                    Translated::Sql(sql) => {
                        tx.raw(sql.clone(), Vec::new(), false).await.map_err(|e| {
                            DbError::Invalid(format!(
                                "{e} (in: {})",
                                sql.chars().take(160).collect::<String>()
                            ))
                        })?;
                    }
                    Translated::StoreView { name, sql } => {
                        // the view must be valid as a query of the plugin
                        let mut probe = scope.clone();
                        probe.views.insert(name.clone(), sql.clone());
                        tr::translate_one(&format!("select * from {}", q(&name)), Mode::Plugin(&probe))
                            .map_err(|e| DbError::Invalid(format!("view {name}: {e}")))?;
                        tx.raw(
                            "insert into core_plugin_views (plugin_id, name, sql) values (?1, ?2, ?3) \
                             on conflict (plugin_id, name) do update set sql = excluded.sql"
                                .into(),
                            vec![Param::Text(self.plugin_id.clone()), Param::Text(name), Param::Text(sql)],
                            false,
                        )
                        .await?;
                    }
                    Translated::DropView { name } => {
                        tx.raw(
                            "delete from core_plugin_views where plugin_id = ?1 and name = ?2".into(),
                            vec![Param::Text(self.plugin_id.clone()), Param::Text(name)],
                            false,
                        )
                        .await?;
                    }
                    Translated::Skip => {}
                }
            }
        }
        self.db.invalidate(&self.plugin_id);
        Ok(())
    }

    /// Columns: (name, declared type in lower case: the same names as PostgreSQL).
    pub async fn columns(&self, tx: &mut LiteTx, table: &str) -> Result<Vec<(String, String)>> {
        let (rows, _) = tx
            .raw(
                "select name, lower(type) from pragma_table_info(?1) order by cid".into(),
                vec![Param::Text(format!("{}{table}", self.prefix()))],
                true,
            )
            .await?;
        rows.iter().map(|r| Ok((r.try_get(0)?, r.try_get(1)?))).collect()
    }

    pub async fn freeze(&self, tx: &mut LiteTx) -> Result<FinalizeReport> {
        let scope = tx.reload_scope(&self.plugin_id).await?;
        let mut report = FinalizeReport::default();
        for (name, protected) in &scope.tables {
            let physical = scope.physical(name);
            let cols = self.columns(tx, name).await?;
            let (rows, _) = tx
                .raw(
                    "select name, lower(type), \"notnull\" from pragma_table_info(?1)".into(),
                    vec![Param::Text(physical.clone())],
                    true,
                )
                .await?;
            for col in ["resource_id", "tenant_id"] {
                let ok = rows.iter().any(|r| {
                    r.try_get::<String, _>(0).ok().as_deref() == Some(col)
                        && r.try_get::<String, _>(1).ok().as_deref() == Some("uuid")
                        && (r.try_get::<i64, _>(2).unwrap_or(0) == 1 || col == "resource_id")
                });
                if !ok {
                    return Err(DbError::Invalid(format!(
                        "the table {name} must have the column {col} uuid not null"
                    )));
                }
            }
            let _ = (cols, protected);
            // index on resource_id (the primary key counts)
            let (idx, _) = tx
                .raw(
                    "select 1 from pragma_index_list(?1) l join pragma_index_info(l.name) i \
                     where i.seqno = 0 and i.name = 'resource_id' \
                     union all select 1 from pragma_table_info(?1) where name = 'resource_id' and pk = 1"
                        .into(),
                    vec![Param::Text(physical.clone())],
                    true,
                )
                .await?;
            if idx.is_empty() {
                tx.raw(
                    format!(
                        "create index {} on {} (resource_id)",
                        q(&format!("{physical}_resource_idx")),
                        q(&physical)
                    ),
                    Vec::new(),
                    false,
                )
                .await?;
            }
            // index on tenant_id: the KPIs and the views of a tenant read the rows of one tenant
            let (tidx, _) = tx
                .raw(
                    "select 1 from pragma_index_list(?1) l join pragma_index_info(l.name) i                      where i.seqno = 0 and i.name = 'tenant_id'"
                        .into(),
                    vec![Param::Text(physical.clone())],
                    true,
                )
                .await?;
            if tidx.is_empty() {
                tx.raw(
                    format!(
                        "create index {} on {} (tenant_id)",
                        q(&format!("{physical}_tenant_idx")),
                        q(&physical)
                    ),
                    Vec::new(),
                    false,
                )
                .await?;
            }
            // check triggers (active only in the transactions of the plugins)
            let lv = |r: &str| tr::level_of(r);
            let triggers = [
                (
                    "msk_ins",
                    "before insert",
                    format!("({} < 2 OR NEW.tenant_id IS NOT core_ctx_tenant())", lv("NEW.resource_id")),
                ),
                (
                    "msk_upd",
                    "before update",
                    format!(
                        "({} < 2 OR {} < 2 OR NEW.tenant_id IS NOT core_ctx_tenant())",
                        lv("OLD.resource_id"),
                        lv("NEW.resource_id")
                    ),
                ),
                (
                    // in cascade from the resource (already deleted) there is nothing to check
                    "msk_del",
                    "before delete",
                    format!(
                        "(EXISTS (SELECT 1 FROM core_resources WHERE id = OLD.resource_id) AND {} < 2)",
                        lv("OLD.resource_id")
                    ),
                ),
            ];
            for (suffix, when, cond) in triggers {
                let tname = q(&format!("{physical}__{suffix}"));
                tx.raw(format!("drop trigger if exists {tname}"), Vec::new(), false).await?;
                tx.raw(
                    format!(
                        "create trigger {tname} {when} on {} when core_ctx_active() and {cond} begin {DENY}; end",
                        q(&physical)
                    ),
                    Vec::new(),
                    false,
                )
                .await?;
            }
            report.tables.push(name.clone());
        }
        for v in &scope.kpi_views {
            let (rows, _) = tx
                .raw(
                    "select 1 from pragma_table_info(?1) where name = 'tenant_id'".into(),
                    vec![Param::Text(scope.physical(v))],
                    true,
                )
                .await?;
            if rows.is_empty() {
                return Err(DbError::Invalid(format!("the KPI view {v} must have the column tenant_id")));
            }
            report.kpi_views.push(v.clone());
        }
        report.views = scope.views.keys().cloned().collect();
        self.db.invalidate(&self.plugin_id);
        Ok(report)
    }

    /// Removes tables, views, indexes and triggers of the plugin.
    pub async fn drop(&self, tx: &mut LiteTx) -> Result<()> {
        for (name, kind) in self.objects(tx, "'trigger', 'view', 'index', 'table'").await? {
            if kind == "index" && name.starts_with("sqlite_") {
                continue;
            }
            let res = tx.raw(format!("drop {kind} if exists {}", q(&name)), Vec::new(), false).await;
            // automatic indexes go away with the table
            if let Err(e) = res {
                if kind != "index" {
                    return Err(e);
                }
            }
        }
        tx.raw(
            "delete from core_plugin_views where plugin_id = ?1".into(),
            vec![Param::Text(self.plugin_id.clone())],
            false,
        )
        .await?;
        self.db.invalidate(&self.plugin_id);
        Ok(())
    }
}

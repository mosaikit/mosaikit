//! SQL whitelist for the plugins.
//!
//! It is the **second** defence: the first are the PostgreSQL role of the plugin
//! (no privilege outside its schema) and Row-Level Security. The guard
//! stops in advance statements that have no reason to exist in a
//! plugin (`SET`, `COPY`, system functions, other schemas...) and returns
//! the SQL serialized again from the AST: exactly what was analysed
//! is run.

use std::ops::ControlFlow;

pub mod sqlite;

use sqlparser::ast::{
    visit_expressions, visit_relations, AlterTableOperation, ColumnOption, Expr, ObjectName, ObjectType,
    SetExpr, Statement, TableConstraint,
};
use sqlparser::dialect::PostgreSqlDialect;
use sqlparser::parser::Parser;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum GuardError {
    #[error("invalid SQL: {0}")]
    Parse(String),
    #[error("one statement per call only")]
    MultipleStatements,
    #[error("statement not allowed in plugins: {0}")]
    Statement(String),
    #[error("object not accessible to plugins: {0}")]
    Relation(String),
    #[error("function not allowed in plugins: {0}")]
    Function(String),
}

pub type Result<T> = std::result::Result<T, GuardError>;

/// Kind of statement allowed at runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Select,
    Insert,
    Update,
    Delete,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Checked {
    pub kind: Kind,
    /// `INSERT/UPDATE/DELETE ... RETURNING`: produces rows
    pub returning: bool,
    /// SQL serialized again from the AST
    pub sql: String,
}

impl Checked {
    pub fn produces_rows(&self) -> bool {
        self.kind == Kind::Select || self.returning
    }
}

/// Objects of the `core` schema the plugins may read.
const CORE_RELATIONS: &[&str] = &["visible_resources"];
/// Functions of the `core` schema the plugins may call.
const CORE_FUNCTIONS: &[&str] = &["can_access", "level_of", "ctx_user", "ctx_tenant"];
/// Forbidden functions (besides all the `pg_*` ones).
const DENIED_FUNCTIONS: &[&str] = &[
    "set_config",
    "current_setting",
    "dblink",
    "query_to_xml",
    "query_to_xml_and_xmlschema",
    "table_to_xml",
    "cursor_to_xml",
    "schema_to_xml",
    "database_to_xml",
    "txid_current",
    "lo_import",
    "lo_export",
    "lo_get",
    "lo_put",
    "lo_from_bytea",
    "lo_open",
];

fn parse(sql: &str) -> Result<Vec<Statement>> {
    Parser::parse_sql(&PostgreSqlDialect {}, sql).map_err(|e| GuardError::Parse(e.to_string()))
}

fn ident(s: &str) -> String {
    s.to_ascii_lowercase()
}

/// Checks a relation name (table, view, CTE, table function).
fn check_relation(name: &ObjectName, schema: &str) -> Result<()> {
    let parts: Vec<String> = name.0.iter().map(|i| ident(&i.value)).collect();
    let ok = match parts.as_slice() {
        [n] => !n.starts_with("pg_") && n != "information_schema",
        [s, n] if s == schema => !n.is_empty(),
        [s, n] if s == "core" => CORE_RELATIONS.contains(&n.as_str()),
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(GuardError::Relation(name.to_string()))
    }
}

/// Checks the name of an object created/changed by a migration: only in its own schema.
fn check_own_object(name: &ObjectName, schema: &str) -> Result<()> {
    let parts: Vec<String> = name.0.iter().map(|i| ident(&i.value)).collect();
    let ok = match parts.as_slice() {
        [n] => !n.starts_with("pg_"),
        [s, n] => s == schema && !n.starts_with("pg_"),
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(GuardError::Relation(name.to_string()))
    }
}

fn check_function(name: &ObjectName, schema: &str) -> Result<()> {
    let parts: Vec<String> = name.0.iter().map(|i| ident(&i.value)).collect();
    let ok = match parts.as_slice() {
        [n] => !n.starts_with("pg_") && !n.starts_with("lo_") && !DENIED_FUNCTIONS.contains(&n.as_str()),
        [s, n] if s == "core" => CORE_FUNCTIONS.contains(&n.as_str()),
        [s, _] if s == schema => true,
        _ => false,
    };
    if ok {
        Ok(())
    } else {
        Err(GuardError::Function(name.to_string()))
    }
}

/// Checks every relation and function referenced by a statement.
fn check_references(stmt: &Statement, schema: &str) -> Result<()> {
    let mut err = None;
    let _ = visit_relations(stmt, |rel| match check_relation(rel, schema) {
        Ok(()) => ControlFlow::Continue(()),
        Err(e) => {
            err = Some(e);
            ControlFlow::Break(())
        }
    });
    if let Some(e) = err {
        return Err(e);
    }
    let _ = visit_expressions(stmt, |expr| {
        if let Expr::Function(f) = expr {
            if let Err(e) = check_function(&f.name, schema) {
                err = Some(e);
                return ControlFlow::Break(());
            }
        }
        ControlFlow::Continue(())
    });
    match err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

pub(crate) fn statement_name(stmt: &Statement) -> String {
    let s = stmt.to_string();
    s.split_whitespace().take(2).collect::<Vec<_>>().join(" ").to_uppercase()
}

fn check_dml(stmt: &Statement, schema: &str) -> Result<Checked> {
    let (kind, returning) = match stmt {
        Statement::Query(q) => {
            if let SetExpr::Select(sel) = q.body.as_ref() {
                if sel.into.is_some() {
                    return Err(GuardError::Statement("SELECT INTO".into()));
                }
            }
            (Kind::Select, false)
        }
        Statement::Insert(i) => {
            check_own_object(&i.table_name, schema)?;
            (Kind::Insert, i.returning.is_some())
        }
        Statement::Update { returning, .. } => (Kind::Update, returning.is_some()),
        Statement::Delete(d) => (Kind::Delete, d.returning.is_some()),
        other => return Err(GuardError::Statement(statement_name(other))),
    };
    check_references(stmt, schema)?;
    Ok(Checked { kind, returning, sql: stmt.to_string() })
}

/// Statement sent by a plugin at runtime: one only, DML only.
pub fn check_query(sql: &str, schema: &str) -> Result<Checked> {
    let stmts = parse(sql)?;
    match stmts.as_slice() {
        [one] => check_dml(one, schema),
        [] => Err(GuardError::Parse("empty statement".into())),
        _ => Err(GuardError::MultipleStatements),
    }
}

/// Migration file of a plugin: DDL limited to its own schema + DML.
/// Returns the statements serialized again, to run one at a time.
pub fn check_migration(sql: &str, schema: &str) -> Result<Vec<String>> {
    let stmts = parse(sql)?;
    let mut out = Vec::with_capacity(stmts.len());
    for stmt in &stmts {
        match stmt {
            Statement::Query(_) | Statement::Insert(_) | Statement::Update { .. } | Statement::Delete(_) => {
                check_dml(stmt, schema)?;
            }
            Statement::CreateTable(t) => {
                if t.temporary {
                    return Err(GuardError::Statement("CREATE TEMPORARY TABLE".into()));
                }
                check_own_object(&t.name, schema)?;
                for c in &t.columns {
                    for o in &c.options {
                        if let ColumnOption::ForeignKey { foreign_table, .. } = &o.option {
                            check_own_object(foreign_table, schema)?;
                        }
                    }
                }
                for c in &t.constraints {
                    if let TableConstraint::ForeignKey { foreign_table, .. } = c {
                        check_own_object(foreign_table, schema)?;
                    }
                }
                check_references(stmt, schema)?;
            }
            Statement::CreateIndex(i) => {
                check_own_object(&i.table_name, schema)?;
                if let Some(n) = &i.name {
                    check_own_object(n, schema)?;
                }
                check_references(stmt, schema)?;
            }
            Statement::CreateView { name, materialized, temporary, .. } => {
                if *materialized || *temporary {
                    return Err(GuardError::Statement("CREATE MATERIALIZED/TEMPORARY VIEW".into()));
                }
                check_own_object(name, schema)?;
                check_references(stmt, schema)?;
            }
            Statement::CreateSequence { name, temporary, .. } => {
                if *temporary {
                    return Err(GuardError::Statement("CREATE TEMPORARY SEQUENCE".into()));
                }
                check_own_object(name, schema)?;
            }
            Statement::AlterTable { name, operations, .. } => {
                check_own_object(name, schema)?;
                for op in operations {
                    match op {
                        AlterTableOperation::AddColumn { .. }
                        | AlterTableOperation::DropColumn { .. }
                        | AlterTableOperation::RenameColumn { .. }
                        | AlterTableOperation::RenameTable { .. }
                        | AlterTableOperation::AlterColumn { .. }
                        | AlterTableOperation::DropConstraint { .. }
                        | AlterTableOperation::RenameConstraint { .. } => {}
                        AlterTableOperation::AddConstraint(c) => {
                            if let TableConstraint::ForeignKey { foreign_table, .. } = c {
                                check_own_object(foreign_table, schema)?;
                            }
                        }
                        other => return Err(GuardError::Statement(format!("ALTER TABLE {other}"))),
                    }
                }
                check_references(stmt, schema)?;
            }
            Statement::Drop { object_type, names, .. } => {
                if !matches!(
                    object_type,
                    ObjectType::Table | ObjectType::View | ObjectType::Index | ObjectType::Sequence
                ) {
                    return Err(GuardError::Statement(format!("DROP {object_type}")));
                }
                for n in names {
                    check_own_object(n, schema)?;
                }
            }
            Statement::Comment { object_name, .. } => {
                check_own_object(object_name, schema)?;
            }
            other => return Err(GuardError::Statement(statement_name(other))),
        }
        out.push(stmt.to_string());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: &str = "plg_com_test_notes";

    #[test]
    fn allowed_dml() {
        let c = check_query("select tag, count(*) n from notes where tag = $1 group by tag", S).unwrap();
        assert_eq!(c.kind, Kind::Select);
        assert!(c.produces_rows());
        let c = check_query("insert into notes (resource_id, title) values ($1::uuid, $2) returning *", S)
            .unwrap();
        assert!(c.returning);
        check_query("update plg_com_test_notes.notes set title = 'x' where resource_id = $1::uuid", S)
            .unwrap();
        check_query("delete from notes where resource_id = $1::uuid", S).unwrap();
        check_query("with t as (select * from notes) select count(*) from t", S).unwrap();
        check_query(
            "select n.*, v.owner_name from notes n join core.visible_resources v on v.id = n.resource_id",
            S,
        )
        .unwrap();
        check_query("select core.level_of($1::uuid)", S).unwrap();
        check_query("select lower(title), coalesce(tag, 'x'), now() from notes", S).unwrap();
    }

    #[test]
    fn forbidden_statements() {
        for sql in [
            "set role postgres",
            "reset role",
            "set statement_timeout = 0",
            "copy notes to '/tmp/x'",
            "create table x (a int)",
            "drop table notes",
            "grant select on notes to public",
            "listen x",
            "select 1; select 2",
            "select * into new_table from notes",
        ] {
            assert!(check_query(sql, S).is_err(), "should have been refused: {sql}");
        }
    }

    #[test]
    fn forbidden_objects_and_functions() {
        for sql in [
            "select * from core.users",
            "select * from core.session_ctx",
            "select * from plg_other.notes",
            "select * from pg_catalog.pg_authid",
            "select * from pg_stat_activity",
            "select * from information_schema.tables",
            "select set_config('x', 'y', false)",
            "select current_setting('x')",
            "select pg_sleep(10)",
            "select pg_catalog.pg_read_file('x')",
            "select core.set_ctx($1, null, null, null, null)",
            "select * from pg_ls_dir('.')",
            "insert into core.grants values (1)",
            "update core.resources set owner_id = null",
            "delete from core.users",
            "select * from (select * from core.users) x",
            "select (select password_hash from core.users limit 1)",
        ] {
            assert!(check_query(sql, S).is_err(), "should have been refused: {sql}");
        }
    }

    #[test]
    fn migrations() {
        let ok = check_migration(
            "create table readings (resource_id uuid not null, tenant_id uuid not null, temp double precision);
             create index on readings (resource_id);
             create index readings_temp on readings (temp);
             create view kpi_readings as select tenant_id, count(*) n from readings group by tenant_id;
             alter table readings add column note text;
             comment on table readings is 'letture';
             insert into readings (resource_id, tenant_id) select resource_id, tenant_id from readings where false;",
            S,
        )
        .unwrap();
        assert_eq!(ok.len(), 7);

        for sql in [
            "create function f() returns int as 'select 1' language sql",
            "create policy p on readings using (true)",
            "alter table readings disable row level security",
            "alter table readings owner to postgres",
            "create table core.x (a int)",
            "create view v as select * from core.users",
            "create materialized view m as select 1",
            "create table x (r uuid references core.resources(id))",
            "grant all on readings to public",
            "drop schema plg_com_test_notes cascade",
            "drop function f",
            "do $$ begin end $$",
            "set role postgres",
            "create table t (a text default current_setting('x'))",
            "create temporary table t (a int)",
        ] {
            assert!(check_migration(sql, S).is_err(), "should have been refused: {sql}");
        }
    }
}

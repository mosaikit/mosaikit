//! Translation from PostgreSQL SQL to SQLite, with the security rules of Mosaikit.
//!
//! SQLite has no schemas, roles or Row-Level Security. The translation:
//! - renames the objects: `core.users` -> `core_users`, `plg_x.notes` -> `plg_x__notes`;
//! - in the transactions of the plugins replaces every read of a protected table
//!   (with `resource_id`) with a subquery filtered by the access level of the
//!   context (the equivalent of `msk_select`), and adds the filter to UPDATE/DELETE
//!   (`msk_update`/`msk_delete`); triggers check INSERT and new values;
//! - expands the `core.*` functions (levels, context) into SQL on the core tables;
//! - converts casts, functions, intervals, `= ANY(...)`, `ILIKE`, `$n` placeholders;
//! - for the SQL written by the plugins it accepts only their tables and views.
//!
//! The `core_ctx_*()` functions are registered by Mosaikit on every connection and
//! read the context of the transaction from the Rust side: the plugin cannot change it.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::ops::ControlFlow;

use sqlparser::ast::{
    BinaryOperator, ColumnOption, ColumnOptionDef, DataType, Expr, FromTable, FunctionArg, FunctionArgExpr,
    FunctionArguments, Ident, ObjectName, Query, ReferentialAction, SetExpr, Statement, TableAlias,
    TableFactor, Value, VisitMut, VisitorMut,
};
use sqlparser::dialect::{GenericDialect, PostgreSqlDialect};
use sqlparser::parser::Parser;

use crate::{GuardError, Result};

/// Format of the instants stored as text (like `TS_FORMAT` of mosaikit-db).
pub const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/// Objects of a plugin, to resolve the names of its queries.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Scope {
    /// logical schema (`plg_notes`)
    pub schema: String,
    /// tables: name -> protected (has `resource_id`: rows filtered by level)
    pub tables: BTreeMap<String, bool>,
    /// views of the plugin (not KPI): name -> PostgreSQL SQL, expanded at every use
    pub views: BTreeMap<String, String>,
    /// KPI views (real SQLite views, aggregated over every tenant: for the kernel only)
    pub kpi_views: BTreeSet<String>,
}

impl Scope {
    pub fn prefix(&self) -> String {
        format!("{}__", self.schema)
    }
    pub fn physical(&self, name: &str) -> String {
        format!("{}__{name}", self.schema)
    }
}

#[derive(Debug, Clone, Copy)]
pub enum Mode<'a> {
    /// SQL of the kernel; with `Some` it runs in a transaction of the plugin (filtered rows)
    Kernel(Option<&'a Scope>),
    /// SQL written by the plugin, already checked by `check_query`
    Plugin(&'a Scope),
    /// migration of the plugin, already checked by `check_migration`
    Migration(&'a Scope),
}

/// Result of the translation of a statement.
#[derive(Debug, Clone, PartialEq)]
pub enum Translated {
    Sql(String),
    /// view of the plugin (not KPI): the definition is stored and expanded at every use
    StoreView {
        name: String,
        sql: String,
    },
    DropView {
        name: String,
    },
    /// statement with no effect on SQLite (e.g. COMMENT ON)
    Skip,
}

// ------------------------------------------------------------------ SQL templates

/// Level (0-3) of the context on the row of `core_resources` with alias `r`.
pub fn level_row(r: &str) -> String {
    format!(
        "(CASE \
           WHEN core_ctx_tenant() IS NULL OR {r}.tenant_id IS DISTINCT FROM core_ctx_tenant() THEN 0 \
           WHEN core_ctx_plugin() IS NOT NULL AND {r}.plugin_id IS DISTINCT FROM core_ctx_plugin() THEN 0 \
           WHEN {trash} THEN 0 \
           WHEN core_ctx_link() IS NOT NULL THEN (CASE WHEN {r}.id = core_ctx_link() \
                OR core_ctx_link() IN (SELECT value FROM json_each({r}.ancestors)) THEN 1 ELSE 0 END) \
           ELSE {} END)",
        level_for(
            "core_ctx_user()",
            &format!("{r}.tenant_id"),
            &format!("{r}.id"),
            &format!("{r}.ancestors")
        ),
        trash = in_trash_row(r)
    )
}

/// The row of `core_resources` with alias `r`, or one of its ancestors, is in the trash.
fn in_trash_row(r: &str) -> String {
    format!(
        "({r}.deleted_at IS NOT NULL OR EXISTS (SELECT 1 FROM core_resources msk_tr \
           WHERE msk_tr.deleted_at IS NOT NULL AND msk_tr.id IN (SELECT value FROM json_each({r}.ancestors))))"
    )
}

/// `core.in_trash(rid)`: the resource or one of its ancestors is in the trash.
pub fn in_trash(rid: &str) -> String {
    format!(
        "EXISTS (SELECT 1 FROM (SELECT ({rid}) AS v) msk_ix JOIN core_resources msk_ir ON msk_ir.id = msk_ix.v \
           WHERE {})",
        in_trash_row("msk_ir")
    )
}

// The arguments of the templates (`rid`, `u`, ...) come from the SQL of the caller and
// may contain unqualified columns (e.g. `parent_id`): they are evaluated in a
// subquery without tables in the FROM, so they resolve in the outer query and
// not in the core tables inside the template.

/// Level of the context on any resource (0 if it does not exist).
pub fn level_of(rid: &str) -> String {
    format!(
        "coalesce((SELECT {} FROM (SELECT ({rid}) AS v) msk_lx JOIN core_resources msk_lr ON msk_lr.id = msk_lx.v), 0)",
        level_row("msk_lr")
    )
}

/// Level of a user: owner of the resource or of an ancestor 3, otherwise
/// the highest of the grants, direct or through a group of the tenant.
pub fn level_for(u: &str, t: &str, rid: &str, anc: &str) -> String {
    format!(
        "(SELECT CASE \
           WHEN msk_a.u IS NULL OR NOT {member} THEN 0 \
           WHEN EXISTS (SELECT 1 FROM core_resources msk_d WHERE msk_d.deleted_at IS NOT NULL \
                AND (msk_d.id = msk_a.rid OR msk_d.id IN (SELECT value FROM json_each(msk_a.anc)))) THEN 0 \
           WHEN EXISTS (SELECT 1 FROM core_resources msk_o WHERE msk_o.owner_id = msk_a.u \
                AND (msk_o.id = msk_a.rid OR msk_o.id IN (SELECT value FROM json_each(msk_a.anc)))) THEN 3 \
           ELSE coalesce((SELECT max(msk_g.level) FROM core_grants msk_g \
                WHERE (msk_g.resource_id = msk_a.rid OR msk_g.resource_id IN (SELECT value FROM json_each(msk_a.anc))) \
                  AND ((msk_g.principal_type = 'user' AND msk_g.principal_id = msk_a.u) \
                    OR (msk_g.principal_type = 'group' AND msk_g.principal_id IN ( \
                        SELECT msk_gm.group_id FROM core_group_members msk_gm \
                        JOIN core_groups msk_gr ON msk_gr.id = msk_gm.group_id \
                        WHERE msk_gm.user_id = msk_a.u AND msk_gr.tenant_id = msk_a.t)))), 0) \
         END FROM (SELECT ({u}) AS u, ({t}) AS t, ({rid}) AS rid, ({anc}) AS anc) msk_a)",
        member = member_sql("msk_a.u", "msk_a.t")
    )
}

/// The user is an active member of an active tenant (membership not suspended).
pub fn is_member(u: &str, t: &str) -> String {
    format!("(SELECT {} FROM (SELECT ({u}) AS u, ({t}) AS t) msk_im)", member_sql("msk_im.u", "msk_im.t"))
}

fn member_sql(u: &str, t: &str) -> String {
    format!(
        "EXISTS (SELECT 1 FROM core_memberships msk_m \
           JOIN core_users msk_mu ON msk_mu.id = msk_m.user_id AND msk_mu.status = 'active' \
           JOIN core_tenants msk_mt ON msk_mt.id = msk_m.tenant_id AND msk_mt.status = 'active' \
           WHERE msk_m.tenant_id = {t} AND msk_m.user_id = {u} AND msk_m.status = 'active')"
    )
}

/// `core.visible_resources`: metadata of the resources of the plugin visible in the context.
pub fn visible_resources() -> String {
    format!(
        "SELECT msk_r.id, msk_r.tenant_id, msk_r.plugin_id, msk_r.kind, msk_r.parent_id, msk_r.ancestors, \
           msk_r.owner_id, msk_u.username AS owner_username, \
           coalesce(nullif(msk_u.display_name, ''), msk_u.username) AS owner_name, \
           msk_r.title, msk_r.size_bytes, msk_r.meta, msk_r.created_at, msk_r.updated_at, \
           {lvl} AS my_level, \
           EXISTS (SELECT 1 FROM core_grants msk_vg WHERE msk_vg.resource_id = msk_r.id) AS shared \
         FROM core_resources msk_r JOIN core_users msk_u ON msk_u.id = msk_r.owner_id \
         WHERE msk_r.tenant_id = core_ctx_tenant() AND msk_r.plugin_id = core_ctx_plugin() AND {lvl} >= 1",
        lvl = level_row("msk_r")
    )
}

/// Rows of a protected table visible in the context (read).
fn filtered_table(physical: &str) -> String {
    format!("SELECT * FROM \"{physical}\" WHERE {} >= 1", level_of("resource_id"))
}

// ------------------------------------------------------------------ utilities

fn err(m: impl Into<String>) -> GuardError {
    GuardError::Statement(m.into())
}

fn parse_expr(sql: &str) -> Result<Expr> {
    Parser::new(&GenericDialect {})
        .try_with_sql(sql)
        .and_then(|mut p| p.parse_expr())
        .map_err(|e| GuardError::Parse(format!("{e} (internal template)")))
}

fn parse_query(sql: &str) -> Result<Query> {
    match Parser::parse_sql(&GenericDialect {}, sql).map_err(|e| GuardError::Parse(e.to_string()))?.pop() {
        Some(Statement::Query(q)) => Ok(*q),
        _ => Err(GuardError::Parse("query expected (internal template)".into())),
    }
}

fn ident(s: &str) -> Ident {
    Ident::with_quote('"', s)
}

fn lower_parts(n: &ObjectName) -> Vec<String> {
    n.0.iter().map(|i| i.value.to_ascii_lowercase()).collect()
}

fn args_of(f: &sqlparser::ast::Function) -> Vec<String> {
    match &f.args {
        FunctionArguments::List(l) => l
            .args
            .iter()
            .map(|a| match a {
                FunctionArg::Unnamed(FunctionArgExpr::Expr(e)) => e.to_string(),
                FunctionArg::Named { arg: FunctionArgExpr::Expr(e), .. } => e.to_string(),
                FunctionArg::Unnamed(FunctionArgExpr::Wildcard) => "*".into(),
                other => other.to_string(),
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn named_arg(f: &sqlparser::ast::Function) -> Option<(String, String)> {
    match &f.args {
        FunctionArguments::List(l) => l.args.iter().find_map(|a| match a {
            FunctionArg::Named { name, arg: FunctionArgExpr::Expr(e), .. } => {
                Some((name.value.to_ascii_lowercase(), e.to_string()))
            }
            _ => None,
        }),
        _ => None,
    }
}

fn type_class(dt: &DataType) -> &'static str {
    let s = dt.to_string().to_ascii_lowercase();
    if s.ends_with("[]") || matches!(dt, DataType::Array(_)) {
        "array"
    } else if s == "interval" {
        "interval"
    } else if s == "date" {
        "date"
    } else if s.contains("bool") {
        "bool"
    } else if s.contains("int") || s == "serial" || s == "bigserial" || s == "smallserial" {
        "int"
    } else if ["numeric", "decimal", "real", "double", "float"].iter().any(|k| s.contains(k)) {
        "real"
    } else if s.contains("char") || s == "text" || s == "name" || s == "citext" {
        "text"
    } else {
        // uuid, json, jsonb, timestamp...: on SQLite they are already text
        "same"
    }
}

const SENTINEL: &str = "__msk_target__";

/// Function names the plugins cannot use on SQLite (besides the system ones).
const DENIED_LITE: &[&str] =
    &["load_extension", "readfile", "writefile", "edit", "fts3_tokenizer", "zipfile"];

/// PostgreSQL table functions with a SQLite equivalent (same `value` column).
fn table_function(name: &str) -> Option<&'static str> {
    match name {
        "json_each" | "jsonb_each" | "json_each_text" | "jsonb_each_text" => Some("json_each"),
        "json_array_elements"
        | "jsonb_array_elements"
        | "json_array_elements_text"
        | "jsonb_array_elements_text" => Some("json_each"),
        "json_tree" => Some("json_tree"),
        _ => None,
    }
}

// ------------------------------------------------------------------ visitor

struct Tr<'a> {
    mode: Mode<'a>,
    ctes: HashSet<String>,
    funcs: HashSet<String>,
    err: Option<GuardError>,
}

impl<'a> Tr<'a> {
    fn scope(&self) -> Option<&'a Scope> {
        match self.mode {
            Mode::Kernel(s) => s,
            Mode::Plugin(s) | Mode::Migration(s) => Some(s),
        }
    }

    /// The rows of the protected tables must be filtered (transactions of the plugins).
    fn filtering(&self) -> bool {
        matches!(self.mode, Mode::Plugin(_) | Mode::Kernel(Some(_)))
    }

    fn fail<T>(&mut self, e: GuardError) -> ControlFlow<T> {
        if self.err.is_none() {
            self.err = Some(e);
        }
        ControlFlow::Continue(())
    }

    /// Logical name of an object of the plugin -> physical name (or None if it stays as it is).
    fn resolve_local(&self, name: &str) -> Result<Option<String>> {
        let Some(s) = self.scope() else {
            return Err(GuardError::Relation(name.to_string()));
        };
        if s.tables.contains_key(name) {
            return Ok(Some(s.physical(name)));
        }
        if s.views.contains_key(name) {
            return match self.mode {
                Mode::Migration(_) => {
                    Err(err(format!("the view {name} is not used in migrations on SQLite")))
                }
                _ => Ok(None), // expanded in post_visit_table_factor
            };
        }
        if s.kpi_views.contains(name) {
            return match self.mode {
                Mode::Plugin(_) => Err(GuardError::Relation(name.to_string())),
                _ => Ok(Some(s.physical(name))),
            };
        }
        match self.mode {
            Mode::Migration(_) => Ok(Some(s.physical(name))),
            _ => Err(GuardError::Relation(name.to_string())),
        }
    }

    fn rename(&mut self, n: &mut ObjectName) -> Result<()> {
        let parts = lower_parts(n);
        match parts.as_slice() {
            [one] if one == SENTINEL => {}
            [one] if self.ctes.contains(one) || self.funcs.contains(one) => {}
            [one] => {
                if let Some(p) = self.resolve_local(one)? {
                    *n = ObjectName(vec![ident(&p)]);
                }
            }
            [s, t] if s == "core" => {
                // migrations: no core object (the key to core.resources is separate)
                if matches!(self.mode, Mode::Migration(_))
                    || (matches!(self.mode, Mode::Plugin(_)) && t != "visible_resources")
                {
                    return Err(GuardError::Relation(n.to_string()));
                }
                if t != "visible_resources" {
                    *n = ObjectName(vec![ident(&format!("core_{t}"))]);
                }
            }
            [s, t] if self.scope().is_some_and(|sc| &sc.schema == s) => {
                if let Some(p) = self.resolve_local(t)? {
                    *n = ObjectName(vec![ident(&p)]);
                } else {
                    *n = ObjectName(vec![ident(t)]);
                }
            }
            [s, t] if s.starts_with("plg_") && matches!(self.mode, Mode::Kernel(_)) => {
                *n = ObjectName(vec![ident(&format!("{s}__{t}"))]);
            }
            _ => return Err(GuardError::Relation(n.to_string())),
        }
        Ok(())
    }

    /// Physical name -> (logical name, protected), if it is a table of the plugin.
    fn plugin_table(&self, n: &ObjectName) -> Option<(String, bool)> {
        let s = self.scope()?;
        let [one] = n.0.as_slice() else { return None };
        let logical = one.value.strip_prefix(&s.prefix())?;
        match s.tables.get(logical) {
            Some(p) => Some((logical.to_string(), *p)),
            // tables created in the same migration
            None if matches!(self.mode, Mode::Migration(_)) => Some((logical.to_string(), false)),
            None => None,
        }
    }

    fn expr(&mut self, e: &mut Expr) -> Result<()> {
        let new = match e {
            Expr::Value(Value::Placeholder(p)) if p.starts_with('$') => {
                Some(Expr::Value(Value::Placeholder(format!("?{}", &p[1..]))))
            }
            Expr::Cast { expr, data_type, .. } => {
                let inner = expr.to_string();
                let literal = matches!(**expr, Expr::Value(_));
                Some(match type_class(data_type) {
                    "interval" => return Ok(()), // handled by the operation that uses it
                    "int" => parse_expr(&format!("CAST({inner} AS INTEGER)"))?,
                    "real" => parse_expr(&format!("CAST({inner} AS REAL)"))?,
                    "date" => parse_expr(&format!("date({inner})"))?,
                    "text" if !literal => parse_expr(&format!("CAST({inner} AS TEXT)"))?,
                    "bool" => match inner.to_ascii_lowercase().as_str() {
                        "'true'" | "'t'" => parse_expr("1")?,
                        "'false'" | "'f'" => parse_expr("0")?,
                        _ => *expr.clone(),
                    },
                    _ => Expr::Nested(expr.clone()),
                })
            }
            Expr::ILike { negated, expr, pattern, escape_char, any } => Some(Expr::Like {
                negated: *negated,
                expr: expr.clone(),
                pattern: pattern.clone(),
                escape_char: escape_char.clone(),
                any: *any,
            }),
            Expr::AnyOp { left, compare_op, right, .. } => {
                let neg = match compare_op {
                    BinaryOperator::Eq => "",
                    _ => return Err(err("only `= ANY(...)` is supported on SQLite")),
                };
                Some(parse_expr(&format!("({left} {neg}IN (SELECT value FROM json_each({right})))"))?)
            }
            Expr::AllOp { left, compare_op, right } => {
                if !matches!(compare_op, BinaryOperator::NotEq) {
                    return Err(err("only `<> ALL(...)` is supported on SQLite"));
                }
                Some(parse_expr(&format!("({left} NOT IN (SELECT value FROM json_each({right})))"))?)
            }
            Expr::Array(a) => {
                let items: Vec<String> = a.elem.iter().map(|x| x.to_string()).collect();
                Some(parse_expr(&format!("json_array({})", items.join(", ")))?)
            }
            Expr::TypedString { value, .. } => Some(Expr::Value(Value::SingleQuotedString(value.clone()))),
            Expr::Extract { field, expr, .. } => {
                let f = field.to_string().to_ascii_lowercase();
                Some(parse_expr(&match f.as_str() {
                    "epoch" => format!("((julianday({expr}) - 2440587.5) * 86400.0)"),
                    "year" => format!("CAST(strftime('%Y', {expr}) AS INTEGER)"),
                    "month" => format!("CAST(strftime('%m', {expr}) AS INTEGER)"),
                    "day" => format!("CAST(strftime('%d', {expr}) AS INTEGER)"),
                    "hour" => format!("CAST(strftime('%H', {expr}) AS INTEGER)"),
                    "dow" => format!("CAST(strftime('%w', {expr}) AS INTEGER)"),
                    other => return Err(err(format!("EXTRACT({other}) not supported on SQLite"))),
                })?)
            }
            Expr::BinaryOp { left, op: op @ (BinaryOperator::Plus | BinaryOperator::Minus), right } => {
                let sign = if matches!(op, BinaryOperator::Plus) { "+" } else { "-" };
                let mods: Option<Vec<String>> = match right.as_ref() {
                    Expr::Interval(i) => match i.value.as_ref() {
                        Expr::Value(Value::SingleQuotedString(s)) => {
                            let w: Vec<&str> = s.split_whitespace().collect();
                            let mut v = Vec::new();
                            for c in w.chunks(2) {
                                v.push(format!("'{sign}{}'", c.join(" ")));
                            }
                            Some(v)
                        }
                        other => Some(vec![format!("('{sign}' || ({other}))")]),
                    },
                    Expr::Cast { expr, data_type, .. } if type_class(data_type) == "interval" => {
                        Some(vec![format!("('{sign}' || ({expr}))")])
                    }
                    Expr::Function(f) if lower_parts(&f.name) == ["make_interval"] => {
                        let (unit, v) =
                            named_arg(f).ok_or_else(|| err("make_interval requires a named argument"))?;
                        let (unit, mul) = match unit.as_str() {
                            "secs" => ("seconds", ""),
                            "mins" => ("minutes", ""),
                            "hours" => ("hours", ""),
                            "days" => ("days", ""),
                            "weeks" => ("days", " * 7"),
                            "months" => ("months", ""),
                            "years" => ("years", ""),
                            other => return Err(err(format!("make_interval({other}) not supported"))),
                        };
                        Some(vec![format!("('{sign}' || (({v}){mul}) || ' {unit}')")])
                    }
                    _ => None,
                };
                match mods {
                    Some(m) => Some(parse_expr(&format!(
                        "strftime('%Y-%m-%dT%H:%M:%fZ', {left}, {})",
                        m.join(", ")
                    ))?),
                    None => None,
                }
            }
            Expr::BinaryOp {
                op:
                    BinaryOperator::PGRegexMatch
                    | BinaryOperator::PGRegexIMatch
                    | BinaryOperator::PGRegexNotMatch
                    | BinaryOperator::PGRegexNotIMatch,
                ..
            } => {
                return Err(err("regular expressions (~) not supported on SQLite"));
            }
            Expr::Function(f) => self.function(f)?,
            _ => None,
        };
        if let Some(n) = new {
            *e = n;
        }
        Ok(())
    }

    fn function(&mut self, f: &mut sqlparser::ast::Function) -> Result<Option<Expr>> {
        let parts = lower_parts(&f.name);
        let a = args_of(f);
        let arg =
            |i: usize| a.get(i).cloned().ok_or_else(|| err(format!("missing arguments for {}", f.name)));
        if let [s, name] = parts.as_slice() {
            if s == "core" {
                return Ok(Some(parse_expr(&match name.as_str() {
                    "level_of" => level_of(&arg(0)?),
                    "can_access" => format!("({} >= ({}))", level_of(&arg(0)?), arg(1)?),
                    "level_for" => level_for(&arg(0)?, &arg(1)?, &arg(2)?, &arg(3)?),
                    "is_member" => is_member(&arg(0)?, &arg(1)?),
                    "in_trash" => in_trash(&arg(0)?),
                    "ctx_user" => "core_ctx_user()".into(),
                    "ctx_tenant" => "core_ctx_tenant()".into(),
                    "ctx_plugin" => "core_ctx_plugin()".into(),
                    other => return Err(GuardError::Function(format!("core.{other} (su SQLite)"))),
                })?));
            }
            return Err(GuardError::Function(f.name.to_string()));
        }
        let name = parts.first().cloned().unwrap_or_default();
        if matches!(self.mode, Mode::Plugin(_))
            && (DENIED_LITE.contains(&name.as_str()) || name.starts_with("sqlite"))
        {
            return Err(GuardError::Function(name));
        }
        let rename = |f: &mut sqlparser::ast::Function, to: &str| {
            f.name = ObjectName(vec![Ident::new(to)]);
        };
        match name.as_str() {
            "now"
            | "current_timestamp"
            | "transaction_timestamp"
            | "clock_timestamp"
            | "statement_timestamp"
            | "localtimestamp" => return Ok(Some(parse_expr(NOW)?)),
            "json_agg" | "jsonb_agg" | "array_agg" => {
                if let Some(x) = a.first() {
                    if x.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                        && !x.chars().all(|c| c.is_ascii_digit())
                    {
                        // json_agg(alias) aggregates whole rows: on SQLite the list of columns is needed
                        if !matches!(x.as_str(), "true" | "false" | "null") {
                            return Err(err(
                                "json_agg of a whole row is not supported on SQLite: use json_build_object",
                            ));
                        }
                    }
                }
                rename(f, "json_group_array")
            }
            "json_build_object" | "jsonb_build_object" => rename(f, "json_object"),
            "json_build_array" | "jsonb_build_array" => rename(f, "json_array"),
            "to_json" | "to_jsonb" => return Ok(Some(parse_expr(&arg(0)?)?)),
            "json_typeof" | "jsonb_typeof" => rename(f, "json_type"),
            "json_array_length" | "jsonb_array_length" => rename(f, "json_array_length"),
            "string_agg" => rename(f, "group_concat"),
            "greatest" => rename(f, "max"),
            "least" => rename(f, "min"),
            "char_length" | "character_length" => rename(f, "length"),
            "strpos" => rename(f, "instr"),
            "left" => return Ok(Some(parse_expr(&format!("substr({}, 1, {})", arg(0)?, arg(1)?))?)),
            "pg_advisory_xact_lock" | "pg_advisory_lock" => return Ok(Some(parse_expr("1")?)),
            "to_char" => {
                let fmt = arg(1)?;
                let f2 = match fmt.as_str() {
                    "'YYYY-MM-DD'" => "'%Y-%m-%d'",
                    "'YYYY-MM'" => "'%Y-%m'",
                    "'YYYY'" => "'%Y'",
                    "'HH24:MI'" => "'%H:%M'",
                    other => return Err(err(format!("to_char with format {other} not supported on SQLite"))),
                };
                return Ok(Some(parse_expr(&format!("strftime({f2}, {})", arg(0)?))?));
            }
            "date_trunc" => {
                let unit = arg(0)?.to_ascii_lowercase();
                let x = arg(1)?;
                return Ok(Some(parse_expr(&match unit.as_str() {
                    "'day'" => format!("(date({x}) || 'T00:00:00.000Z')"),
                    "'month'" => format!("(strftime('%Y-%m', {x}) || '-01T00:00:00.000Z')"),
                    "'year'" => format!("(strftime('%Y', {x}) || '-01-01T00:00:00.000Z')"),
                    other => return Err(err(format!("date_trunc({other}) not supported on SQLite"))),
                })?));
            }
            "make_interval" => {} // handled by the + / - operation
            _ => {}
        }
        Ok(None)
    }
}

impl VisitorMut for Tr<'_> {
    type Break = ();

    fn pre_visit_query(&mut self, q: &mut Query) -> ControlFlow<()> {
        if let Some(w) = &q.with {
            for c in &w.cte_tables {
                self.ctes.insert(c.alias.name.value.to_ascii_lowercase());
            }
        }
        // FOR UPDATE / FOR SHARE: SQLite already serializes writes
        q.locks.clear();
        if let SetExpr::Select(s) = q.body.as_ref() {
            if matches!(s.distinct, Some(sqlparser::ast::Distinct::On(_))) {
                return self.fail(err("DISTINCT ON not supported on SQLite"));
            }
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_table_factor(&mut self, t: &mut TableFactor) -> ControlFlow<()> {
        if let TableFactor::Table { name, args: Some(_), .. } = t {
            let parts = lower_parts(name);
            match parts.as_slice() {
                [one] => match table_function(one) {
                    Some(to) => {
                        *name = ObjectName(vec![Ident::new(to)]);
                        self.funcs.insert(to.to_string());
                    }
                    None => {
                        return self.fail(GuardError::Function(format!("{one} (table function on SQLite)")))
                    }
                },
                _ => return self.fail(GuardError::Function(name.to_string())),
            }
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_relation(&mut self, n: &mut ObjectName) -> ControlFlow<()> {
        if let Err(e) = self.rename(n) {
            return self.fail(e);
        }
        ControlFlow::Continue(())
    }

    fn post_visit_table_factor(&mut self, t: &mut TableFactor) -> ControlFlow<()> {
        let (name, alias) = match t {
            TableFactor::Table { name, alias, args: None, .. } => (name.clone(), alias.clone()),
            _ => return ControlFlow::Continue(()),
        };
        let parts = lower_parts(&name);
        // core.visible_resources
        if parts == ["core", "visible_resources"] {
            if !self.filtering() {
                return self
                    .fail(err("core.visible_resources is used only in the transactions of the plugins"));
            }
            let alias =
                alias.unwrap_or(TableAlias { name: Ident::new("visible_resources"), columns: vec![] });
            match parse_query(&visible_resources()) {
                Ok(q) => {
                    *t = TableFactor::Derived { lateral: false, subquery: Box::new(q), alias: Some(alias) }
                }
                Err(e) => return self.fail(e),
            }
            return ControlFlow::Continue(());
        }
        // view of the plugin: expanded
        if let (Some(s), [one]) = (self.scope(), parts.as_slice()) {
            if let Some(body) = s.views.get(one) {
                let alias = alias.unwrap_or(TableAlias { name: ident(one), columns: vec![] });
                let sql = match translate_one(body, self.mode) {
                    Ok(sql) => sql,
                    Err(e) => return self.fail(e),
                };
                match parse_query(&sql) {
                    Ok(q) => {
                        *t =
                            TableFactor::Derived { lateral: false, subquery: Box::new(q), alias: Some(alias) }
                    }
                    Err(e) => return self.fail(e),
                }
                return ControlFlow::Continue(());
            }
        }
        // table of the plugin: rows filtered in the transactions of the plugins
        if let Some((logical, protected)) = self.plugin_table(&name) {
            let alias = alias.unwrap_or(TableAlias { name: ident(&logical), columns: vec![] });
            if protected && self.filtering() {
                match parse_query(&filtered_table(&name.0[0].value)) {
                    Ok(q) => {
                        *t =
                            TableFactor::Derived { lateral: false, subquery: Box::new(q), alias: Some(alias) }
                    }
                    Err(e) => return self.fail(e),
                }
            } else if let TableFactor::Table { alias: a, .. } = t {
                *a = Some(alias);
            }
        }
        ControlFlow::Continue(())
    }

    fn post_visit_expr(&mut self, e: &mut Expr) -> ControlFlow<()> {
        if let Err(x) = self.expr(e) {
            return self.fail(x);
        }
        ControlFlow::Continue(())
    }
}

// ------------------------------------------------------------------ statements

/// Target of INSERT/UPDATE/DELETE: (physical name, logical name, protected).
fn target(tr: &Tr, n: &ObjectName) -> Result<(String, String, bool)> {
    let parts = lower_parts(n);
    let scope = tr.scope();
    let logical = match (parts.as_slice(), scope) {
        ([one], Some(_)) => one.clone(),
        ([s, t], Some(sc)) if *s == sc.schema => t.clone(),
        ([s, t], _) if s == "core" && matches!(tr.mode, Mode::Kernel(_)) => {
            return Ok((format!("core_{t}"), t.clone(), false));
        }
        ([s, t], _) if s.starts_with("plg_") && matches!(tr.mode, Mode::Kernel(_)) => {
            return Ok((format!("{s}__{t}"), t.clone(), false));
        }
        _ => return Err(GuardError::Relation(n.to_string())),
    };
    let s = scope.expect("scope");
    match s.tables.get(&logical) {
        Some(p) => Ok((s.physical(&logical), logical, *p)),
        None if matches!(tr.mode, Mode::Migration(_)) => Ok((s.physical(&logical), logical, false)),
        None => Err(GuardError::Relation(n.to_string())),
    }
}

fn sentinel() -> ObjectName {
    ObjectName(vec![Ident::new(SENTINEL)])
}

fn and_level(sel: &mut Option<Expr>, alias: &str, min: u8) -> Result<()> {
    let cond = format!("{} >= {min}", level_of(&format!("\"{alias}\".resource_id")));
    *sel = Some(match sel.take() {
        Some(s) => parse_expr(&format!("({s}) AND {cond}"))?,
        None => parse_expr(&cond)?,
    });
    Ok(())
}

/// Preliminary checks on the SQL written by a plugin: no internal names of Mosaikit.
fn plugin_prescan(sql: &str) -> Result<()> {
    let l = sql.to_ascii_lowercase();
    for bad in ["core_", "plg_", "msk_", "sqlite_", "__", "pragma", "attach", "main.", "temp."] {
        if l.contains(bad) {
            return Err(GuardError::Relation(format!("reserved name: {bad}")));
        }
    }
    Ok(())
}

fn translate_stmt(mut st: Statement, mode: Mode) -> Result<Translated> {
    let mut tr = Tr { mode, ctes: HashSet::new(), funcs: HashSet::new(), err: None };
    // DML targets: renamed separately (they must not be replaced by subqueries)
    let mut dml: Option<(String, String, bool)> = None;
    match &mut st {
        Statement::Insert(i) => {
            dml = Some(target(&tr, &i.table_name)?);
            i.table_name = sentinel();
        }
        Statement::Update { table, .. } => {
            if !table.joins.is_empty() {
                return Err(err("UPDATE with JOIN not supported on SQLite"));
            }
            if let TableFactor::Table { name, .. } = &mut table.relation {
                dml = Some(target(&tr, name)?);
                *name = sentinel();
            }
        }
        Statement::Delete(d) => {
            let tables = match &mut d.from {
                FromTable::WithFromKeyword(t) | FromTable::WithoutKeyword(t) => t,
            };
            if tables.len() != 1 || d.using.is_some() {
                return Err(err("DELETE on several tables or with USING not supported on SQLite"));
            }
            if let TableFactor::Table { name, .. } = &mut tables[0].relation {
                dml = Some(target(&tr, name)?);
                *name = sentinel();
            }
        }
        _ => {}
    }

    let out: Option<()> = match &mut st {
        Statement::CreateView { name, query, materialized, .. } => {
            let Mode::Migration(scope) = mode else { return Err(err("CREATE VIEW only in migrations")) };
            if *materialized {
                return Err(err("materialized views not supported"));
            }
            let n = lower_parts(name).pop().unwrap_or_default();
            if !n.starts_with("kpi_") {
                // normal view: expanded at every use with the filters of the context
                return Ok(Translated::StoreView { name: n, sql: query.to_string() });
            }
            *name = ObjectName(vec![ident(&scope.physical(&n))]);
            None
        }
        Statement::Drop { object_type, names, cascade, .. } => {
            let Mode::Migration(scope) = mode else { return Err(err("DROP only in migrations")) };
            if let (sqlparser::ast::ObjectType::View, [one]) = (&*object_type, names.as_slice()) {
                let n = lower_parts(one).pop().unwrap_or_default();
                if scope.views.contains_key(&n) {
                    return Ok(Translated::DropView { name: n });
                }
            }
            for n in names.iter_mut() {
                let l = lower_parts(n).pop().unwrap_or_default();
                *n = ObjectName(vec![ident(&scope.physical(&l))]);
            }
            *cascade = false;
            None
        }
        Statement::Comment { .. } => return Ok(Translated::Skip),
        Statement::CreateIndex(ci) => {
            let Mode::Migration(scope) = mode else { return Err(err("CREATE INDEX only in migrations")) };
            let table = lower_parts(&ci.table_name).pop().unwrap_or_default();
            let n = match &ci.name {
                Some(n) => lower_parts(n).pop().unwrap_or_default(),
                None => {
                    let cols: Vec<String> = ci
                        .columns
                        .iter()
                        .map(|c| {
                            c.expr
                                .to_string()
                                .chars()
                                .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
                                .collect()
                        })
                        .collect();
                    format!("{table}_{}_idx", cols.join("_"))
                }
            };
            ci.name = Some(ObjectName(vec![ident(&scope.physical(&n))]));
            ci.using = None;
            ci.concurrently = false;
            None
        }
        Statement::CreateTable(ct) => {
            let Mode::Migration(scope) = mode else { return Err(err("CREATE TABLE only in migrations")) };
            let fk = |n: &mut ObjectName| {
                let p = lower_parts(n);
                *n = match p.as_slice() {
                    [s, t] if s == "core" => ObjectName(vec![Ident::new(format!("core_{t}"))]),
                    [s, t] if *s == scope.schema => ObjectName(vec![ident(&scope.physical(t))]),
                    [t] if !t.starts_with("core_") => ObjectName(vec![ident(&scope.physical(t))]),
                    _ => n.clone(),
                };
            };
            for c in &mut ct.constraints {
                if let sqlparser::ast::TableConstraint::ForeignKey { foreign_table, .. } = c {
                    fk(foreign_table);
                }
            }
            for c in &mut ct.columns {
                let ty = c.data_type.to_string().to_ascii_lowercase();
                if matches!(ty.as_str(), "serial" | "bigserial" | "smallserial") {
                    c.data_type = DataType::Integer(None);
                }
                for o in &mut c.options {
                    if let ColumnOption::Default(d) = &mut o.option {
                        // on SQLite a non-literal DEFAULT goes between parentheses
                        if !matches!(d, Expr::Value(_)) {
                            *d = Expr::Nested(Box::new(d.clone()));
                        }
                    }
                }
                // resource_id: key to core_resources with cascading delete
                if c.name.value.eq_ignore_ascii_case("resource_id")
                    && !c.options.iter().any(|o| matches!(o.option, ColumnOption::ForeignKey { .. }))
                {
                    c.options.push(ColumnOptionDef {
                        name: None,
                        option: ColumnOption::ForeignKey {
                            foreign_table: ObjectName(vec![Ident::new("core_resources")]),
                            referred_columns: vec![Ident::new("id")],
                            on_delete: Some(ReferentialAction::Cascade),
                            on_update: None,
                            characteristics: None,
                        },
                    });
                }
                for o in &mut c.options {
                    if let ColumnOption::ForeignKey { foreign_table, .. } = &mut o.option {
                        fk(foreign_table);
                    }
                }
            }
            None
        }
        Statement::AlterTable { operations, .. } => {
            for op in operations.iter() {
                use sqlparser::ast::AlterTableOperation as A;
                match op {
                    A::AddColumn { .. }
                    | A::RenameColumn { .. }
                    | A::RenameTable { .. }
                    | A::DropColumn { .. } => {}
                    other => return Err(err(format!("ALTER TABLE not supported on SQLite: {other}"))),
                }
            }
            None
        }
        Statement::Query(_)
        | Statement::Insert(_)
        | Statement::Update { .. }
        | Statement::Delete(_)
        | Statement::Savepoint { .. }
        | Statement::ReleaseSavepoint { .. }
        | Statement::Rollback { .. } => None,
        other => {
            return Err(err(format!("statement not supported on SQLite: {}", crate::statement_name(other))))
        }
    };
    let _ = out;

    let _ = st.visit(&mut tr);
    if let Some(e) = tr.err.take() {
        return Err(e);
    }

    // renaming of constraints, indexes and DDL names not covered by the visitor
    if let Statement::AlterTable { operations, .. } = &mut st {
        for op in operations.iter_mut() {
            if let sqlparser::ast::AlterTableOperation::RenameTable { table_name } = op {
                if let Some(s) = tr.scope() {
                    let n = lower_parts(table_name).pop().unwrap_or_default();
                    *table_name = ObjectName(vec![ident(&s.physical(&n))]);
                }
            }
        }
    }

    if let Some((physical, logical, protected)) = dml {
        let filter = protected && tr.filtering();
        match &mut st {
            Statement::Insert(i) => {
                i.table_name = ObjectName(vec![ident(&physical)]);
                if i.table_alias.is_none() && !physical.starts_with("core_") {
                    i.table_alias = Some(ident(&logical));
                }
            }
            Statement::Update { table, selection, .. } => {
                if let TableFactor::Table { name, alias, .. } = &mut table.relation {
                    *name = ObjectName(vec![ident(&physical)]);
                    let a = alias
                        .get_or_insert(TableAlias { name: ident(&logical), columns: vec![] })
                        .name
                        .value
                        .clone();
                    if filter {
                        and_level(selection, &a, 2)?;
                    }
                }
            }
            Statement::Delete(d) => {
                let tables = match &mut d.from {
                    FromTable::WithFromKeyword(t) | FromTable::WithoutKeyword(t) => t,
                };
                if let TableFactor::Table { name, alias, .. } = &mut tables[0].relation {
                    *name = ObjectName(vec![ident(&physical)]);
                    let a = alias
                        .get_or_insert(TableAlias { name: ident(&logical), columns: vec![] })
                        .name
                        .value
                        .clone();
                    if filter {
                        and_level(&mut d.selection, &a, 2)?;
                    }
                }
            }
            _ => {}
        }
    }

    Ok(Translated::Sql(st.to_string()))
}

/// Translates one or more PostgreSQL statements for SQLite.
pub fn translate(sql: &str, mode: Mode) -> Result<Vec<Translated>> {
    if let Mode::Plugin(_) = mode {
        plugin_prescan(sql)?;
    }
    let stmts =
        Parser::parse_sql(&PostgreSqlDialect {}, sql).map_err(|e| GuardError::Parse(e.to_string()))?;
    stmts.into_iter().map(|s| translate_stmt(s, mode)).collect()
}

/// Translates a single SQL statement (DML or query).
pub fn translate_one(sql: &str, mode: Mode) -> Result<String> {
    let mut v = translate(sql, mode)?;
    match (v.len(), v.pop()) {
        (1, Some(Translated::Sql(s))) => Ok(s),
        (1, Some(other)) => Err(err(format!("unexpected statement: {other:?}"))),
        _ => Err(GuardError::MultipleStatements),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope() -> Scope {
        Scope {
            schema: "plg_notes".into(),
            tables: [("notes".to_string(), true), ("tags".to_string(), false)].into_iter().collect(),
            views: [(
                "recent".to_string(),
                "select resource_id, title from notes where title <> ''".to_string(),
            )]
            .into_iter()
            .collect(),
            kpi_views: ["kpi_notes".to_string()].into_iter().collect(),
        }
    }

    fn k(sql: &str) -> String {
        translate_one(sql, Mode::Kernel(None)).unwrap()
    }

    #[test]
    fn names_casts_parameters() {
        assert_eq!(
            k("select id from core.users where id = $1::uuid"),
            "SELECT id FROM \"core_users\" WHERE id = (?1)"
        );
        assert_eq!(
            k("select count(*)::int, sum(size_bytes)::bigint from core.resources where tenant_id = $2"),
            "SELECT CAST(count(*) AS INTEGER), CAST(sum(size_bytes) AS INTEGER) FROM \"core_resources\" WHERE tenant_id = ?2"
        );
        assert_eq!(k("select x from \"plg_a\".\"kpi_b\" v"), "SELECT x FROM \"plg_a__kpi_b\" AS v");
        assert!(k("select 1 from core.users where username ilike $1").contains("LIKE ?1"));
    }

    #[test]
    fn time_and_arrays() {
        let s = k("select 1 from core.sessions where expires_at > now() and created_at > now() - interval '30 days'");
        assert!(s.contains("expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"), "{s}");
        assert!(
            s.contains("strftime('%Y-%m-%dT%H:%M:%fZ', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), '-30 days')"),
            "{s}"
        );
        let s = k("update core.sessions set expires_at = now() + make_interval(secs => $1)");
        assert!(s.contains("('+' || ((?1)) || ' seconds')"), "{s}");
        let s = k("select 1 from core.resources where id = any($1)");
        assert!(s.contains("id IN (SELECT value FROM json_each(?1))"), "{s}");
        let s = k("select 1 from core.resources for update");
        assert!(!s.contains("FOR UPDATE"));
    }

    #[test]
    fn core_functions_expanded() {
        let s = k("select core.level_of($1)");
        assert!(s.contains("core_ctx_tenant()") && s.contains("core_grants"), "{s}");
        let s = k("select core.ctx_user()");
        assert_eq!(s, "SELECT core_ctx_user()");
    }

    #[test]
    fn rows_filtered_in_plugin_transactions() {
        let sc = scope();
        let s = translate_one("select title from notes where tag = $1", Mode::Plugin(&sc)).unwrap();
        assert!(s.contains("FROM (SELECT * FROM \"plg_notes__notes\" WHERE coalesce("), "{s}");
        assert!(s.contains(") AS \"notes\" WHERE tag = ?1"), "{s}");
        // table without resource_id: not filtered but renamed
        let s = translate_one("select * from tags", Mode::Plugin(&sc)).unwrap();
        assert_eq!(s, "SELECT * FROM \"plg_notes__tags\" AS \"tags\"");
        // UPDATE / DELETE: filter on the target
        let s = translate_one("update notes set title = $1 where tag = 'x'", Mode::Plugin(&sc)).unwrap();
        assert!(
            s.starts_with(
                "UPDATE \"plg_notes__notes\" AS \"notes\" SET title = ?1 WHERE (tag = 'x') AND coalesce("
            ),
            "{s}"
        );
        let s = translate_one("delete from notes", Mode::Plugin(&sc)).unwrap();
        assert!(s.contains("WHERE coalesce((SELECT"), "{s}");
        // view of the plugin expanded with the filters
        let s = translate_one("select title from recent", Mode::Plugin(&sc)).unwrap();
        assert!(
            s.contains("FROM (SELECT resource_id, title FROM (SELECT * FROM \"plg_notes__notes\""),
            "{s}"
        );
        // kernel in the transaction of the plugin: core.visible_resources
        let s = translate_one(
            "select t.title from \"plg_notes\".\"notes\" t join core.visible_resources v on v.id = t.resource_id",
            Mode::Kernel(Some(&sc)),
        )
        .unwrap();
        assert!(s.contains("AS t JOIN (SELECT msk_r.id"), "{s}");
    }

    #[test]
    fn the_plugin_does_not_leave_its_space() {
        let sc = scope();
        for bad in [
            "select * from core_users",
            "select * from plg_notes__notes",
            "select * from kpi_notes",
            "select * from sqlite_master",
            "select * from other",
            "select load_extension('x')",
            "select * from core.users",
            "select msk_lr.id from notes msk_lr",
        ] {
            assert!(translate_one(bad, Mode::Plugin(&sc)).is_err(), "{bad}");
        }
    }

    #[test]
    fn migrations() {
        let sc = Scope { schema: "plg_x".into(), ..Scope::default() };
        let v = translate(
            "create table items (resource_id uuid primary key, tenant_id uuid not null default core.ctx_tenant(), n serial, at timestamptz default now());
             create index on items (tenant_id);
             create view kpi_items as select tenant_id, count(*) as n from items group by tenant_id;
             create view mine as select * from items",
            Mode::Migration(&sc),
        )
        .unwrap();
        let Translated::Sql(t) = &v[0] else { panic!() };
        assert!(t.starts_with("CREATE TABLE \"plg_x__items\""), "{t}");
        assert!(t.contains("DEFAULT (core_ctx_tenant())"), "{t}");
        assert!(t.contains("REFERENCES core_resources (id) ON DELETE CASCADE"), "{t}");
        assert!(t.contains("n INTEGER"), "{t}");
        assert!(t.contains("DEFAULT (strftime("), "{t}");
        assert_eq!(
            v[1],
            Translated::Sql(
                "CREATE INDEX \"plg_x__items_tenant_id_idx\" ON \"plg_x__items\"(tenant_id)".into()
            )
        );
        let Translated::Sql(kpi) = &v[2] else { panic!() };
        assert!(
            kpi.contains("CREATE VIEW \"plg_x__kpi_items\"")
                && kpi.contains("FROM \"plg_x__items\" AS \"items\""),
            "{kpi}"
        );
        assert!(matches!(&v[3], Translated::StoreView { name, .. } if name == "mine"));
    }
}

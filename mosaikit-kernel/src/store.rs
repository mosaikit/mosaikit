//! Persistenza CRUD: trait Backend + implementazioni.
//!
//! Scelta PoC: SQLite (rusqlite, feature "sqlite", default) — file unico,
//! transazionale, portabile; e' anche lo stesso mondo di SpatiaLite/GeoPackage
//! nel GIS. Fallback std-only: un file JSON per risorsa.
//!
//! Modello dati: una tabella per risorsa, colonne tipizzate derivate dal
//! ResourceDescriptor dichiarato dal plugin (il kernel resta domain-agnostic).

use std::path::{Path, PathBuf};
use crate::model::{ResourceDescriptor, Row};
#[cfg(feature = "sqlite")]
use crate::model::{FieldKind, Value};

pub trait Backend: Send {
    /// Carica tutte le righe della risorsa (il filtro resta in memoria nel kernel).
    fn load(&mut self, d: &ResourceDescriptor) -> Vec<Row>;
    fn insert(&mut self, d: &ResourceDescriptor, r: &Row);
    fn update(&mut self, d: &ResourceDescriptor, r: &Row);
    fn remove(&mut self, d: &ResourceDescriptor, id: u64);
}

/// Nessuna persistenza (test in-memory).
pub struct MemBackend;
impl Backend for MemBackend {
    fn load(&mut self, _: &ResourceDescriptor) -> Vec<Row> { Vec::new() }
    fn insert(&mut self, _: &ResourceDescriptor, _: &Row) {}
    fn update(&mut self, _: &ResourceDescriptor, _: &Row) {}
    fn remove(&mut self, _: &ResourceDescriptor, _: u64) {}
}

fn safe_ident(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).collect()
}

#[cfg(feature = "sqlite")]
fn sql_type(k: FieldKind) -> &'static str {
    match k {
        FieldKind::Text | FieldKind::Date | FieldKind::Choice => "TEXT",
        FieldKind::Number => "REAL",
        FieldKind::Bool => "INTEGER",
    }
}

/// Backend di default: SQLite se compilato (feature "sqlite"), altrimenti JSON file.
pub fn open_default(data_dir: &Path, resource_name: &str) -> Box<dyn Backend> {
    #[cfg(feature = "sqlite")]
    {
        match SqliteBackend::open(data_dir, resource_name) {
            Ok(b) => return Box::new(b),
            Err(e) => eprintln!("[store] sqlite non disponibile ({e}), uso JSON file"),
        }
    }
    Box::new(JsonFileBackend::new(data_dir, resource_name))
}

// ---------------------------------------------------------------------------
// SQLite backend
// ---------------------------------------------------------------------------

#[cfg(feature = "sqlite")]
pub struct SqliteBackend {
    conn: rusqlite::Connection,
    table: String,
}

#[cfg(feature = "sqlite")]
impl SqliteBackend {
    pub fn open(data_dir: &Path, resource_name: &str) -> Result<Self, String> {
        let _ = std::fs::create_dir_all(data_dir);
        let conn = rusqlite::Connection::open(data_dir.join("mosaikit.db")).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;").map_err(|e| e.to_string())?;
        Ok(SqliteBackend { conn, table: safe_ident(resource_name) })
    }

    fn ensure_table(&self, d: &ResourceDescriptor) -> Result<(), String> {
        let mut sql = format!("CREATE TABLE IF NOT EXISTS \"{}\" (id INTEGER PRIMARY KEY", self.table);
        for f in &d.fields {
            sql.push_str(&format!(", \"{}\" {}", safe_ident(&f.key), sql_type(f.kind)));
        }
        sql.push(')');
        self.conn.execute(&sql, []).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn params_for(d: &ResourceDescriptor, r: &Row) -> Vec<rusqlite::types::Value> {
        d.fields.iter().map(|f| {
            let v = r.values.get(&f.key).cloned().unwrap_or(Value::Text(String::new()));
            match v {
                Value::Number(n) => rusqlite::types::Value::Real(n),
                Value::Bool(b) => rusqlite::types::Value::Integer(b as i64),
                other => rusqlite::types::Value::Text(other.display()),
            }
        }).collect()
    }
}

#[cfg(feature = "sqlite")]
impl Backend for SqliteBackend {
    fn load(&mut self, d: &ResourceDescriptor) -> Vec<Row> {
        if self.ensure_table(d).is_err() { return Vec::new(); }
        let cols: Vec<String> = d.fields.iter().map(|f| format!("\"{}\"", safe_ident(&f.key))).collect();
        let sql = format!("SELECT id{} FROM \"{}\" ORDER BY id",
            if cols.is_empty() { String::new() } else { format!(", {}", cols.join(", ")) }, self.table);
        let stmt = match self.conn.prepare(&sql) { Ok(s) => s, Err(_) => return Vec::new() };
        let mut rows = Vec::new();
        let mut stmt = stmt;
        let cols_n = d.fields.len();
        let mut q = match stmt.query([]) { Ok(q) => q, Err(_) => return Vec::new() };
        use std::collections::BTreeMap;
        while let Ok(Some(row)) = q.next() {
            let id: i64 = row.get(0).unwrap_or(0);
            let mut values = BTreeMap::new();
            for (i, f) in d.fields.iter().enumerate() {
                let v = match f.kind {
                    FieldKind::Number => row.get::<usize, Option<f64>>(i + 1)
                        .map(|o| o.map(Value::Number).unwrap_or(Value::Number(0.0))).unwrap_or(Value::Number(0.0)),
                    FieldKind::Bool => row.get::<usize, Option<i64>>(i + 1)
                        .map(|o| Value::Bool(o.unwrap_or(0) != 0)).unwrap_or(Value::Bool(false)),
                    _ => row.get::<usize, Option<String>>(i + 1)
                        .map(|o| Value::Text(o.unwrap_or_default())).unwrap_or(Value::Text(String::new())),
                };
                values.insert(f.key.clone(), v);
            }
            let _ = cols_n;
            rows.push(Row { id: id as u64, values });
        }
        rows
    }

    fn insert(&mut self, d: &ResourceDescriptor, r: &Row) {
        if self.ensure_table(d).is_err() { return; }
        let cols: Vec<String> = d.fields.iter().map(|f| format!("\"{}\"", safe_ident(&f.key))).collect();
        let marks: Vec<String> = (0..cols.len()).map(|i| format!("?{}", i + 2)).collect();
        let sql = format!("INSERT OR REPLACE INTO \"{}\" (id{} ) VALUES (?1{})",
            self.table,
            if cols.is_empty() { String::new() } else { format!(", {}", cols.join(", ")) },
            if marks.is_empty() { String::new() } else { format!(", {}", marks.join(", ")) });
        let mut params: Vec<rusqlite::types::Value> = vec![rusqlite::types::Value::Integer(r.id as i64)];
        params.extend(Self::params_for(d, r));
        let refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
        let _ = self.conn.execute(&sql, refs.as_slice());
    }

    fn update(&mut self, d: &ResourceDescriptor, r: &Row) {
        // stessa semantica di insert (PRIMARY KEY su id)
        self.insert(d, r);
    }

    fn remove(&mut self, _d: &ResourceDescriptor, id: u64) {
        let sql = format!("DELETE FROM \"{}\" WHERE id = ?1", self.table);
        let _ = self.conn.execute(&sql, [id as i64]);
    }
}

// ---------------------------------------------------------------------------
// JSON file backend (std-only, zero dipendenze)
// ---------------------------------------------------------------------------

pub struct JsonFileBackend {
    path: PathBuf,
    rows: std::collections::BTreeMap<u64, Row>,
}

impl JsonFileBackend {
    pub fn new(data_dir: &Path, resource: &str) -> Self {
        let dir = data_dir.join("resources");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join(format!("{}.json", safe_ident(resource)));
        let rows = std::fs::read_to_string(&path).ok()
            .and_then(|s| crate::json::Json::parse(&s).ok())
            .and_then(|j| j.as_arr().map(|a| a.to_vec()))
            .map(|arr| arr.iter().filter_map(Row::from_json)
                .map(|r| (r.id, r)).collect())
            .unwrap_or_default();
        JsonFileBackend { path, rows }
    }

    fn flush(&self) {
        let j = crate::json::Json::Arr(self.rows.values().map(|r| r.to_json()).collect());
        let _ = std::fs::write(&self.path, j.to_string());
    }
}

impl Backend for JsonFileBackend {
    fn load(&mut self, _d: &ResourceDescriptor) -> Vec<Row> {
        self.rows.values().cloned().collect()
    }
    fn insert(&mut self, _d: &ResourceDescriptor, r: &Row) {
        self.rows.insert(r.id, r.clone());
        self.flush();
    }
    fn update(&mut self, _d: &ResourceDescriptor, r: &Row) {
        self.rows.insert(r.id, r.clone());
        self.flush();
    }
    fn remove(&mut self, _d: &ResourceDescriptor, id: u64) {
        self.rows.remove(&id);
        self.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Field, ResourceDescriptor};

    fn desc() -> ResourceDescriptor {
        ResourceDescriptor {
            name: "things".into(),
            fields: vec![
                Field { key: "title".into(), label: "T".into(), kind: FieldKind::Text, required: true, multiline: false, options: vec![] },
                Field { key: "n".into(), label: "N".into(), kind: FieldKind::Number, required: false, multiline: false, options: vec![] },
                Field { key: "ok".into(), label: "OK".into(), kind: FieldKind::Bool, required: false, multiline: false, options: vec![] },
            ],
        }
    }

    fn row(id: u64, title: &str) -> Row {
        let mut values = std::collections::BTreeMap::new();
        values.insert("title".into(), Value::Text(title.into()));
        values.insert("n".into(), Value::Number(42.0));
        values.insert("ok".into(), Value::Bool(true));
        Row { id, values }
    }

    #[test]
    fn json_backend_roundtrip() {
        let dir = std::env::temp_dir().join("msk-store-test");
        let _ = std::fs::remove_dir_all(&dir);
        let d = desc();
        {
            let mut b = JsonFileBackend::new(&dir, "things");
            b.insert(&d, &row(1, "primo"));
            b.insert(&d, &row(2, "secondo"));
        }
        let mut b2 = JsonFileBackend::new(&dir, "things");
        let loaded = b2.load(&d);
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].values["title"], Value::Text("primo".into()));
        b2.remove(&d, 1);
        let mut b3 = JsonFileBackend::new(&dir, "things");
        assert_eq!(b3.load(&d).len(), 1);
    }
}

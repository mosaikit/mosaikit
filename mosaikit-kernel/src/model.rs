//! Modello domain-agnostic: il kernel ragiona in termini di Contribution
//! (icona + risorsa generica), IconButton, ContentArea e CrudView.

use std::collections::BTreeMap;
use crate::json::Json;
use crate::manifest::resource_from_json;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldKind { Text, Number, Bool, Date, Choice }

#[derive(Debug, Clone)]
pub struct Field {
    pub key: String,
    pub label: String,
    pub kind: FieldKind,
    pub required: bool,
    pub multiline: bool,
    pub options: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ResourceDescriptor {
    pub name: String,
    pub fields: Vec<Field>,
}

/// Cosa aggiunge il plugin alla shell: un bottone su IconBar + una risorsa CRUD.
#[derive(Debug, Clone)]
pub struct Contribution {
    pub icon: String,
    pub label: String,
    pub resource: ResourceDescriptor,
    /// Tipo di vista: "" = CRUD generico; altri valori (es. "files") sono
    /// interpretati dalla UI. Il kernel resta agnostico: pass-through.
    pub kind: String,
}

#[derive(Debug, Clone)]
pub struct IconButton {
    pub plugin_id: String,
    pub icon: String,
    pub label: String,
    pub view_id: String, // = resource name
}

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Text(String),
    Number(f64),
    Bool(bool),
    Date(String),
    Choice(String),
}

impl Value {
    pub fn parse(kind: FieldKind, raw: &str) -> Result<Value, String> {
        let raw = raw.trim();
        match kind {
            FieldKind::Text | FieldKind::Date => Ok(Value::Text(raw.to_string())),
            FieldKind::Choice => Ok(Value::Choice(raw.to_string())),
            FieldKind::Bool => Ok(Value::Bool(matches!(raw.to_ascii_lowercase().as_str(), "true" | "1" | "si" | "s" | "x"))),
            FieldKind::Number => raw.parse::<f64>()
                .map(Value::Number)
                .map_err(|_| format!("valore non numerico: '{raw}'")),
        }
    }
    pub fn display(&self) -> String {
        match self {
            Value::Text(s) | Value::Date(s) | Value::Choice(s) => s.clone(),
            Value::Number(n) => {
                if n.fract() == 0.0 { format!("{}", *n as i64) } else { format!("{n}") }
            }
            Value::Bool(b) => if *b { "✓".into() } else { "".into() },
        }
    }
    pub fn to_json(&self) -> Json { Json::Str(self.display()) }
    pub fn from_json(j: &Json) -> Value {
        match j {
            Json::Bool(b) => Value::Bool(*b),
            Json::Num(n) => Value::Number(*n),
            Json::Str(s) => Value::Text(s.clone()),
            _ => Value::Text(String::new()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Row {
    pub id: u64,
    pub values: BTreeMap<String, Value>,
}

impl Row {
    pub fn to_json(&self) -> Json {
        Json::Obj(vec![
            ("id".into(), Json::Num(self.id as f64)),
            ("values".into(), Json::Obj(self.values.iter()
                .map(|(k, v)| (k.clone(), v.to_json())).collect())),
        ])
    }
    pub fn from_json(j: &Json) -> Option<Row> {
        let id = j.get("id")?.as_f64()? as u64;
        let mut values = BTreeMap::new();
        if let Some(pairs) = j.get("values").and_then(Json::as_obj) {
            for (k, v) in pairs { values.insert(k.clone(), Value::from_json(v)); }
        }
        Some(Row { id, values })
    }
}

/// ContentArea: la zona centrale. Una sola vista attiva alla volta.
#[derive(Debug, Clone)]
pub enum ContentArea {
    Empty { message: String },
    Crud(CrudView),
}

#[derive(Debug, Clone)]
pub struct CrudView {
    pub resource: ResourceDescriptor,
    pub rows: Vec<Row>,
    pub selected: Option<u64>,
    pub draft: BTreeMap<String, String>, // form di inserimento/modifica (stringhe grezze)
    pub filter: String,
    pub status: String,
}

impl CrudView {
    pub fn new(resource: ResourceDescriptor) -> Self {
        CrudView { resource, rows: Vec::new(), selected: None, draft: BTreeMap::new(), filter: String::new(), status: String::new() }
    }
    pub fn clear_draft(&mut self) {
        self.selected = None;
        self.draft = self.resource.fields.iter().map(|f| (f.key.clone(), String::new())).collect();
        self.status.clear();
    }
    pub fn select(&mut self, id: u64) {
        self.selected = Some(id);
        if let Some(row) = self.rows.iter().find(|r| r.id == id) {
            self.draft = row.values.iter().map(|(k, v)| (k.clone(), v.display())).collect();
        }
        self.status.clear();
    }
}

/// Manifest embedded nel guest WASM (stesso JSON del pacchetto .mskp).
pub fn contribution_from_guest_json(src: &str) -> Result<Contribution, String> {
    let j = Json::parse(src)?;
    Contribution::from_json(&j)
}

/// Usato dal runtime per derivare la resource dal manifest guest completo.
pub fn resource_from_manifest_json(src: &str) -> Result<ResourceDescriptor, String> {
    let j = Json::parse(src)?;
    let c = j.get("contribution").ok_or("guest manifest: manca contribution")?;
    resource_from_json(c.get("resource").ok_or("guest manifest: manca resource")?)
}

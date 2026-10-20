//! Motore CRUD generico: il kernel tratta ogni risorsa dichiarata da un
//! plugin allo stesso modo. Persistenza delegata a store::Backend
//! (SQLite di default, JSON file in modalita' std-only).

use std::collections::BTreeMap;
use crate::model::{Field, ResourceDescriptor, Row, Value};
use crate::store::{Backend, MemBackend};

pub struct ResourceStore {
    pub descriptor: ResourceDescriptor,
    next_id: u64,
    rows: BTreeMap<u64, Row>,
    backend: Box<dyn Backend>,
}

impl ResourceStore {
    pub fn new(descriptor: ResourceDescriptor) -> Self {
        Self::with_backend(descriptor, Box::new(MemBackend))
    }

    pub fn with_backend(descriptor: ResourceDescriptor, mut backend: Box<dyn Backend>) -> Self {
        let loaded = backend.load(&descriptor);
        let next_id = loaded.iter().map(|r| r.id).max().unwrap_or(0) + 1;
        let rows = loaded.into_iter().map(|r| (r.id, r)).collect();
        ResourceStore { descriptor, next_id, rows, backend }
    }

    pub fn validate(&self, raw: &BTreeMap<String, String>) -> Result<BTreeMap<String, Value>, String> {
        let mut values = BTreeMap::new();
        for f in &self.descriptor.fields {
            let r = raw.get(&f.key).cloned().unwrap_or_default();
            if f.required && r.trim().is_empty() {
                return Err(format!("campo obbligatorio: {}", f.label));
            }
            if !r.trim().is_empty() || matches!(f.kind, crate::model::FieldKind::Bool) {
                values.insert(f.key.clone(), Value::parse(f.kind, &r)?);
            } else {
                values.insert(f.key.clone(), Value::Text(String::new()));
            }
        }
        Ok(values)
    }

    pub fn create(&mut self, raw: &BTreeMap<String, String>) -> Result<Row, String> {
        let values = self.validate(raw)?;
        let id = self.next_id;
        self.next_id += 1;
        let row = Row { id, values };
        self.rows.insert(id, row.clone());
        self.backend.insert(&self.descriptor, &row);
        Ok(row)
    }

    pub fn update(&mut self, id: u64, raw: &BTreeMap<String, String>) -> Result<Row, String> {
        if !self.rows.contains_key(&id) { return Err(format!("record {id} inesistente")); }
        let values = self.validate(raw)?;
        let row = Row { id, values };
        self.rows.insert(id, row.clone());
        self.backend.update(&self.descriptor, &row);
        Ok(row)
    }

    pub fn delete(&mut self, id: u64) -> Result<Row, String> {
        let row = self.rows.remove(&id).ok_or_else(|| format!("record {id} inesistente"))?;
        self.backend.remove(&self.descriptor, id);
        Ok(row)
    }

    pub fn get(&self, id: u64) -> Option<&Row> { self.rows.get(&id) }

    pub fn list(&self, filter: &str) -> Vec<Row> {
        let f = filter.trim().to_lowercase();
        self.rows.values()
            .filter(|r| f.is_empty() || r.values.values().any(|v| v.display().to_lowercase().contains(&f)))
            .cloned()
            .collect()
    }

    pub fn fields(&self) -> &[Field] { &self.descriptor.fields }
}

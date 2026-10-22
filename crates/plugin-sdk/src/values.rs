use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Values of a CRUD record (key of the field -> JSON value).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Values(pub Map<String, Value>);

impl Values {
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.0.get(key).filter(|v| !v.is_null())
    }

    /// Value as text ("" if absent or null).
    pub fn str(&self, key: &str) -> String {
        match self.get(key) {
            Some(Value::String(s)) => s.clone(),
            Some(v) => v.to_string(),
            None => String::new(),
        }
    }

    pub fn f64(&self, key: &str) -> Option<f64> {
        match self.get(key)? {
            Value::Number(n) => n.as_f64(),
            Value::String(s) => s.trim().parse().ok(),
            _ => None,
        }
    }

    pub fn bool(&self, key: &str) -> bool {
        match self.get(key) {
            Some(Value::Bool(b)) => *b,
            Some(Value::String(s)) => matches!(s.as_str(), "true" | "1" | "yes" | "si" | "sì"),
            _ => false,
        }
    }

    pub fn set(&mut self, key: &str, v: impl Into<Value>) {
        self.0.insert(key.to_string(), v.into());
    }

    pub fn remove(&mut self, key: &str) -> Option<Value> {
        self.0.remove(key)
    }
}

impl From<Map<String, Value>> for Values {
    fn from(m: Map<String, Value>) -> Values {
        Values(m)
    }
}

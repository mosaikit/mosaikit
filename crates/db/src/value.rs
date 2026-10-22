//! Backend-independent values: query parameters and result columns.
//!
//! PostgreSQL has native types (uuid, timestamptz, jsonb, arrays); SQLite stores them
//! as text (uuid, instants in RFC 3339 format with milliseconds, JSON, arrays
//! as JSON) or integers (bool). The `FromVal` conversions accept both forms.

use std::sync::Arc;

use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use uuid::Uuid;

use crate::DbError;

/// Format of the instants stored as text (SQLite): sortable as a string.
pub const TS_FORMAT: &str = "%Y-%m-%dT%H:%M:%S%.3fZ";

pub fn ts_text(t: &DateTime<Utc>) -> String {
    t.format(TS_FORMAT).to_string()
}

/// Type of a parameter (needed for the typed NULLs of PostgreSQL).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ty {
    Bool,
    I16,
    I32,
    I64,
    F64,
    Text,
    Bytes,
    Uuid,
    Ts,
    Date,
    Json,
    Uuids,
    Texts,
}

/// Parameter of a query.
#[derive(Debug, Clone, PartialEq)]
pub enum Param {
    Null(Ty),
    Bool(bool),
    I16(i16),
    I32(i32),
    I64(i64),
    F64(f64),
    Text(String),
    Bytes(Vec<u8>),
    Uuid(Uuid),
    Ts(DateTime<Utc>),
    Date(NaiveDate),
    Json(Value),
    Uuids(Vec<Uuid>),
    Texts(Vec<String>),
}

pub trait IntoParam {
    fn into_param(self) -> Param;
}

/// Static type, for `Option<T>` (typed NULL).
pub trait ParamTy {
    const TY: Ty;
}

macro_rules! param {
    ($t:ty, $ty:ident, |$v:ident| $e:expr) => {
        impl IntoParam for $t {
            fn into_param(self) -> Param {
                let $v = self;
                $e
            }
        }
        impl ParamTy for $t {
            const TY: Ty = Ty::$ty;
        }
    };
}

param!(bool, Bool, |v| Param::Bool(v));
param!(i16, I16, |v| Param::I16(v));
param!(i32, I32, |v| Param::I32(v));
param!(i64, I64, |v| Param::I64(v));
param!(u32, I64, |v| Param::I64(v as i64));
param!(f64, F64, |v| Param::F64(v));
param!(String, Text, |v| Param::Text(v));
param!(&String, Text, |v| Param::Text(v.clone()));
param!(&str, Text, |v| Param::Text(v.to_string()));
param!(&&str, Text, |v| Param::Text(v.to_string()));
param!(Vec<u8>, Bytes, |v| Param::Bytes(v));
param!(&Vec<u8>, Bytes, |v| Param::Bytes(v.clone()));
param!(&[u8], Bytes, |v| Param::Bytes(v.to_vec()));
param!(Uuid, Uuid, |v| Param::Uuid(v));
param!(&Uuid, Uuid, |v| Param::Uuid(*v));
param!(DateTime<Utc>, Ts, |v| Param::Ts(v));
param!(&DateTime<Utc>, Ts, |v| Param::Ts(*v));
param!(NaiveDate, Date, |v| Param::Date(v));
param!(Value, Json, |v| Param::Json(v));
param!(&Value, Json, |v| Param::Json(v.clone()));
param!(Vec<Uuid>, Uuids, |v| Param::Uuids(v));
param!(&Vec<Uuid>, Uuids, |v| Param::Uuids(v.clone()));
param!(&[Uuid], Uuids, |v| Param::Uuids(v.to_vec()));
param!(Vec<String>, Texts, |v| Param::Texts(v));
param!(&Vec<String>, Texts, |v| Param::Texts(v.clone()));
param!(&[String], Texts, |v| Param::Texts(v.to_vec()));

impl<T: IntoParam + ParamTy> IntoParam for Option<T> {
    fn into_param(self) -> Param {
        match self {
            Some(v) => v.into_param(),
            None => Param::Null(T::TY),
        }
    }
}

impl<T: IntoParam + ParamTy> ParamTy for Option<T> {
    const TY: Ty = T::TY;
}

impl<T: IntoParam + ParamTy + Clone> IntoParam for &Option<T> {
    fn into_param(self) -> Param {
        self.clone().into_param()
    }
}

impl IntoParam for Param {
    fn into_param(self) -> Param {
        self
    }
}

impl Param {
    /// Parameter from a JSON value (query parameters of the plugins).
    pub fn from_json(v: &Value) -> Param {
        match v {
            Value::Null => Param::Null(Ty::Text),
            Value::Bool(b) => Param::Bool(*b),
            Value::Number(n) if n.is_i64() => Param::I64(n.as_i64().unwrap_or_default()),
            Value::Number(n) => Param::F64(n.as_f64().unwrap_or_default()),
            Value::String(s) => Param::Text(s.clone()),
            other => Param::Json(other.clone()),
        }
    }
}

/// Value of a column of the result.
#[derive(Debug, Clone, PartialEq)]
pub enum Val {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
    Bytes(Vec<u8>),
    Uuid(Uuid),
    Ts(DateTime<Utc>),
    Date(NaiveDate),
    Json(Value),
    Uuids(Vec<Uuid>),
    Texts(Vec<String>),
}

impl Val {
    /// As JSON (results of the queries of the plugins).
    pub fn to_json(&self) -> Value {
        match self {
            Val::Null => Value::Null,
            Val::Bool(b) => Value::Bool(*b),
            Val::Int(i) => Value::from(*i),
            Val::Float(f) => serde_json::Number::from_f64(*f).map(Value::Number).unwrap_or(Value::Null),
            Val::Text(s) => Value::String(s.clone()),
            Val::Bytes(b) => Value::String(hex::encode(b)),
            Val::Uuid(u) => Value::String(u.to_string()),
            Val::Ts(t) => Value::String(t.to_rfc3339()),
            Val::Date(d) => Value::String(d.to_string()),
            Val::Json(v) => v.clone(),
            Val::Uuids(v) => Value::Array(v.iter().map(|u| Value::String(u.to_string())).collect()),
            Val::Texts(v) => Value::Array(v.iter().cloned().map(Value::String).collect()),
        }
    }
}

fn bad(want: &str, got: &Val) -> DbError {
    DbError::Decode(format!("expected {want}, found {got:?}"))
}

pub fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    if let Ok(t) = DateTime::parse_from_rfc3339(s) {
        return Some(t.with_timezone(&Utc));
    }
    // SQLite formats (datetime(), CURRENT_TIMESTAMP)
    for f in ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"] {
        if let Ok(t) = chrono::NaiveDateTime::parse_from_str(s, f) {
            return Some(t.and_utc());
        }
    }
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok().and_then(|d| d.and_hms_opt(0, 0, 0)).map(|t| t.and_utc())
}

/// Conversion from a column.
pub trait FromVal<'r>: Sized {
    fn from_val(v: &'r Val) -> Result<Self, DbError>;
}

impl<'r, T: FromVal<'r>> FromVal<'r> for Option<T> {
    fn from_val(v: &'r Val) -> Result<Self, DbError> {
        match v {
            Val::Null => Ok(None),
            other => T::from_val(other).map(Some),
        }
    }
}

impl<'r> FromVal<'r> for bool {
    fn from_val(v: &'r Val) -> Result<Self, DbError> {
        match v {
            Val::Bool(b) => Ok(*b),
            Val::Int(i) => Ok(*i != 0),
            other => Err(bad("bool", other)),
        }
    }
}

macro_rules! int {
    ($t:ty) => {
        impl<'r> FromVal<'r> for $t {
            fn from_val(v: &'r Val) -> Result<Self, DbError> {
                match v {
                    Val::Int(i) => <$t>::try_from(*i).map_err(|_| bad(stringify!($t), v)),
                    Val::Bool(b) => Ok(*b as $t),
                    Val::Float(f) if f.fract() == 0.0 => Ok(*f as $t),
                    other => Err(bad(stringify!($t), other)),
                }
            }
        }
    };
}
int!(i16);
int!(i32);
int!(i64);
int!(u32);

impl<'r> FromVal<'r> for f64 {
    fn from_val(v: &'r Val) -> Result<Self, DbError> {
        match v {
            Val::Float(f) => Ok(*f),
            Val::Int(i) => Ok(*i as f64),
            other => Err(bad("f64", other)),
        }
    }
}

impl<'r> FromVal<'r> for String {
    fn from_val(v: &'r Val) -> Result<Self, DbError> {
        match v {
            Val::Text(s) => Ok(s.clone()),
            Val::Uuid(u) => Ok(u.to_string()),
            Val::Date(d) => Ok(d.to_string()),
            other => Err(bad("text", other)),
        }
    }
}

impl<'r> FromVal<'r> for &'r str {
    fn from_val(v: &'r Val) -> Result<Self, DbError> {
        match v {
            Val::Text(s) => Ok(s.as_str()),
            other => Err(bad("text", other)),
        }
    }
}

impl<'r> FromVal<'r> for Uuid {
    fn from_val(v: &'r Val) -> Result<Self, DbError> {
        match v {
            Val::Uuid(u) => Ok(*u),
            Val::Text(s) => s.parse().map_err(|_| bad("uuid", v)),
            Val::Bytes(b) => Uuid::from_slice(b).map_err(|_| bad("uuid", v)),
            other => Err(bad("uuid", other)),
        }
    }
}

impl<'r> FromVal<'r> for DateTime<Utc> {
    fn from_val(v: &'r Val) -> Result<Self, DbError> {
        match v {
            Val::Ts(t) => Ok(*t),
            Val::Text(s) => parse_ts(s).ok_or_else(|| bad("instant", v)),
            other => Err(bad("instant", other)),
        }
    }
}

impl<'r> FromVal<'r> for NaiveDate {
    fn from_val(v: &'r Val) -> Result<Self, DbError> {
        match v {
            Val::Date(d) => Ok(*d),
            Val::Text(s) => {
                NaiveDate::parse_from_str(&s[..s.len().min(10)], "%Y-%m-%d").map_err(|_| bad("date", v))
            }
            other => Err(bad("date", other)),
        }
    }
}

impl<'r> FromVal<'r> for Value {
    fn from_val(v: &'r Val) -> Result<Self, DbError> {
        match v {
            Val::Json(j) => Ok(j.clone()),
            Val::Text(s) => serde_json::from_str(s).map_err(|_| bad("json", v)),
            Val::Null => Ok(Value::Null),
            other => Ok(other.to_json()),
        }
    }
}

impl<'r> FromVal<'r> for Vec<u8> {
    fn from_val(v: &'r Val) -> Result<Self, DbError> {
        match v {
            Val::Bytes(b) => Ok(b.clone()),
            other => Err(bad("bytes", other)),
        }
    }
}

impl<'r> FromVal<'r> for Vec<Uuid> {
    fn from_val(v: &'r Val) -> Result<Self, DbError> {
        match v {
            Val::Uuids(u) => Ok(u.clone()),
            Val::Text(s) => serde_json::from_str(s).map_err(|_| bad("uuid[]", v)),
            other => Err(bad("uuid[]", other)),
        }
    }
}

impl<'r> FromVal<'r> for Vec<String> {
    fn from_val(v: &'r Val) -> Result<Self, DbError> {
        match v {
            Val::Texts(t) => Ok(t.clone()),
            Val::Text(s) => serde_json::from_str(s).map_err(|_| bad("text[]", v)),
            other => Err(bad("text[]", other)),
        }
    }
}

/// Row of a result.
#[derive(Debug, Clone)]
pub struct Row {
    pub(crate) cols: Arc<Vec<String>>,
    pub(crate) vals: Vec<Val>,
}

pub trait ColIndex {
    fn index(&self, row: &Row) -> Option<usize>;
}

impl ColIndex for usize {
    fn index(&self, row: &Row) -> Option<usize> {
        (*self < row.vals.len()).then_some(*self)
    }
}

impl ColIndex for &str {
    fn index(&self, row: &Row) -> Option<usize> {
        row.cols.iter().position(|c| c == self)
    }
}

impl Row {
    pub fn new(cols: Arc<Vec<String>>, vals: Vec<Val>) -> Row {
        Row { cols, vals }
    }

    pub fn try_get<'r, T: FromVal<'r>, I: ColIndex>(&'r self, i: I) -> Result<T, DbError> {
        let idx = i.index(self).ok_or_else(|| DbError::Decode("column does not exist".into()))?;
        T::from_val(&self.vals[idx])
    }

    /// Like `try_get`, but a wrong type is a programming error (panic).
    pub fn get<'r, T: FromVal<'r>, I: ColIndex>(&'r self, i: I) -> T {
        match self.try_get(i) {
            Ok(v) => v,
            Err(e) => panic!("column cannot be decoded: {e}"),
        }
    }

    pub fn columns(&self) -> &[String] {
        &self.cols
    }

    pub fn values(&self) -> &[Val] {
        &self.vals
    }

    pub fn len(&self) -> usize {
        self.vals.len()
    }

    pub fn is_empty(&self) -> bool {
        self.vals.is_empty()
    }

    /// The row as a JSON object.
    pub fn to_json(&self) -> Value {
        Value::Object(self.cols.iter().cloned().zip(self.vals.iter().map(Val::to_json)).collect())
    }
}

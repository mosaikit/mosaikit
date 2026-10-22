//! Errors of the kernel, with the category the server turns into an HTTP status and a stable code the
//! interface translates into the language of whoever uses it (the message stays for logs and as a fallback).

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    BadRequest,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
    TooMany,
    Internal,
}

impl Kind {
    /// The code of a category, when the error has no code of its own.
    pub fn code(self) -> &'static str {
        match self {
            Kind::BadRequest => "bad_request",
            Kind::Unauthorized => "unauthorized",
            Kind::Forbidden => "forbidden",
            Kind::NotFound => "not_found",
            Kind::Conflict => "conflict",
            Kind::TooMany => "too_many",
            Kind::Internal => "internal",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Error {
    pub kind: Kind,
    pub message: String,
    /// specific code (`password_too_short`, `wrong_credentials`, ...); absent: the one of the category
    pub code: Option<&'static str>,
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub fn new(kind: Kind, m: impl Into<String>) -> Error {
        Error { kind, message: m.into(), code: None }
    }
    /// The same error with a specific code, stable across versions.
    pub fn with_code(mut self, code: &'static str) -> Error {
        self.code = Some(code);
        self
    }
    /// The code to send to the interface.
    pub fn code(&self) -> &'static str {
        self.code.unwrap_or(self.kind.code())
    }
    pub fn bad(m: impl Into<String>) -> Error {
        Error::new(Kind::BadRequest, m)
    }
    pub fn unauthorized(m: impl Into<String>) -> Error {
        Error::new(Kind::Unauthorized, m)
    }
    pub fn forbidden(m: impl Into<String>) -> Error {
        Error::new(Kind::Forbidden, m)
    }
    pub fn not_found(m: impl Into<String>) -> Error {
        Error::new(Kind::NotFound, m)
    }
    pub fn conflict(m: impl Into<String>) -> Error {
        Error::new(Kind::Conflict, m)
    }
    pub fn internal(m: impl Into<String>) -> Error {
        Error::new(Kind::Internal, m)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Error {}

/// Category of an SQL error from the SQLSTATE code (SQLite too, translated by mosaikit-db).
fn sql_kind(code: Option<&str>) -> Option<Kind> {
    Some(match code? {
        "42501" => Kind::Forbidden,
        "23505" => Kind::Conflict,
        "22023" | "22P02" | "22007" | "22008" | "23502" | "23503" | "23514" | "22001" | "P0001" => {
            Kind::BadRequest
        }
        "57014" => Kind::BadRequest, // statement_timeout
        _ => return None,
    })
}

fn internal(e: &dyn fmt::Display) -> Error {
    tracing::error!("database error: {e}");
    Error::new(Kind::Internal, "internal database error")
}

impl From<sqlx::Error> for Error {
    fn from(e: sqlx::Error) -> Error {
        if matches!(e, sqlx::Error::RowNotFound) {
            return Error::not_found("not found");
        }
        let code = match &e {
            sqlx::Error::Database(d) => d.code().map(|c| c.to_string()),
            _ => None,
        };
        match sql_kind(code.as_deref()) {
            Some(kind) => {
                let m = match &e {
                    sqlx::Error::Database(d) => d.message().trim_start_matches("mosaikit: ").to_string(),
                    other => other.to_string(),
                };
                Error::new(kind, m)
            }
            None => internal(&e),
        }
    }
}

impl From<mosaikit_db::DbError> for Error {
    fn from(e: mosaikit_db::DbError) -> Error {
        use mosaikit_db::DbError as D;
        match e {
            D::Sqlx(s) => s.into(),
            D::Invalid(m) => Error::bad(m),
            D::Migrate(m) => Error::internal(m.to_string()),
            D::RowNotFound => Error::not_found("not found"),
            D::Decode(m) => internal(&m),
            D::Sql { code, message } => match sql_kind(code.as_deref()) {
                Some(kind) => Error::new(kind, message.trim_start_matches("mosaikit: ").to_string()),
                None => internal(&message),
            },
        }
    }
}

impl From<mosaikit_mskp::Error> for Error {
    fn from(e: mosaikit_mskp::Error) -> Error {
        Error::bad(e.to_string())
    }
}

impl From<mosaikit_sql_guard::GuardError> for Error {
    fn from(e: mosaikit_sql_guard::GuardError) -> Error {
        Error::bad(e.to_string())
    }
}

impl From<mosaikit_runtime::RuntimeError> for Error {
    fn from(e: mosaikit_runtime::RuntimeError) -> Error {
        Error::bad(e.to_string())
    }
}

impl From<std::io::Error> for Error {
    fn from(e: std::io::Error) -> Error {
        tracing::error!("I/O error: {e}");
        Error::internal(format!("I/O error: {e}"))
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Error {
        Error::bad(format!("invalid JSON: {e}"))
    }
}

impl From<tokio::task::JoinError> for Error {
    fn from(e: tokio::task::JoinError) -> Error {
        Error::internal(e.to_string())
    }
}

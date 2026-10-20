//! Mosaikit kernel PoC.
//!
//! Domain-agnostic: non conosce Note, Task o Contatti. Conosce solo
//! autenticazione, pacchetti plugin (.mskp), registry, attivazione,
//! IconBar + ContentArea e un motore CRUD generico su ResourceDescriptor
//! dichiarati dai plugin.

pub mod sha256;
pub mod json;
pub mod auth;
pub mod manifest;
pub mod package;
pub mod validate;
pub mod model;
pub mod crud;
pub mod store;
pub mod registry;
pub mod engine;
pub mod app;
pub mod ziputil;
pub mod vfs;

pub use app::MosaikitApp;
pub use auth::{Auth, Role, Session, Action, AuthError};
pub use manifest::Manifest;
pub use model::{Contribution, ResourceDescriptor, Field, FieldKind, Value, IconButton, ContentArea, CrudView};
pub use engine::{PluginEngine, PluginArtifact, HeadlessEngine, Hook};
pub use registry::Registry;

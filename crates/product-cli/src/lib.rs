//! `mosaikit-product`: the tool of the publishers of products (distributions) built on Mosaikit.
//!
//! A product is a folder with a `distribution.toml`, a brand, its own plugins and the official plugins it keeps.
//! This tool makes one from a compiled base (the desktop archive or the Docker image of the kit): no source of
//! Mosaikit and no compilation of the kernel. The checks of the plugins are the ones of `mosaikit-plugin`.

pub mod basefetch;
pub mod build;
pub mod dev;
pub mod keycloak;
pub mod model;
pub mod scaffold;
pub mod test;
pub mod validate;

pub use model::Distribution;

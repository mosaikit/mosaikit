//! `mosaikit-fake-idp`: the test identity provider (OIDC) of the development environment and of the
//! e2e tests. Never for production: it has no passwords. See docs/manual-tests.md.

use std::net::SocketAddr;

use clap::Parser;
use mosaikit_server::fake_idp::{FakeConfig, FakeIdp};

#[derive(Parser)]
#[command(
    about = "Test identity provider (OIDC) for development and tests: no passwords, never in production"
)]
struct Args {
    /// port on 127.0.0.1
    #[arg(long, default_value_t = 5556)]
    port: u16,
    #[arg(long, default_value = "mosaikit")]
    client_id: String,
    #[arg(long, default_value = "fake-secret")]
    client_secret: String,
    /// algorithm of the ID tokens: ES256 or RS256
    #[arg(long, default_value = "ES256")]
    alg: String,
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    let a = Args::parse();
    let cfg = FakeConfig { client_id: a.client_id, client_secret: a.client_secret, alg: a.alg };
    let idp = FakeIdp::spawn(SocketAddr::from(([127, 0, 0, 1], a.port)), cfg.clone()).await?;
    println!(
        "test identity provider: {} (client {}, secret {})",
        idp.issuer, cfg.client_id, cfg.client_secret
    );
    tokio::signal::ctrl_c().await?;
    Ok(())
}

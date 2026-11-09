//! `[docker] keycloak = true`: the Docker release of a product also runs Keycloak, with a realm of the product, a
//! sign-in page in the look of the product and a sample tenant (`idp-demo`) that already signs in through it
//! (OIDC), so that the integration with an identity provider can be tried at once. It is a demonstration:
//! `start-dev`, test passwords, a placeholder client secret. See `keycloak/README.md` in the release.

use std::path::Path;

use anyhow::{Context, Result};
use serde_json::Value;

use crate::model::Distribution;

const REALM: &str = include_str!("../../../deploy/keycloak/realm-mosaikit.json");
const CSS: &str = include_str!("../../../deploy/keycloak/themes/mosaikit/login/resources/css/login.css");
const LOGO: &str = include_str!("../../../deploy/keycloak/themes/mosaikit/login/resources/img/logo.svg");

/// Port of Keycloak on the host.
pub const PORT: u16 = 8180;
/// Slug of the sample tenant.
pub const TENANT: &str = "idp-demo";

/// The realm file: the one of the platform, with the realm, the client, the theme and the groups named after the product.
pub fn realm(id: &str, name: &str) -> Result<String> {
    let text = REALM
        .replace("mosaikit-managers", &format!("{id}-managers"))
        .replace("mosaikit-users", &format!("{id}-users"));
    let mut v: Value = serde_json::from_str(&text).context("the realm file of the platform")?;
    v["realm"] = id.into();
    v["displayName"] = name.into();
    v["loginTheme"] = id.into();
    if let Some(c) = v["clients"].get_mut(0) {
        c["clientId"] = id.into();
        c["name"] = name.into();
    }
    Ok(serde_json::to_string_pretty(&v)? + "\n")
}

fn channel(hex: &str, i: usize) -> Option<u8> {
    u8::from_str_radix(hex.get(1 + 2 * i..3 + 2 * i)?, 16).ok()
}

/// `#rrggbb` made darker, for the hover of the buttons.
fn darker(hex: &str) -> Option<String> {
    if hex.len() != 7 || !hex.starts_with('#') {
        return None;
    }
    let c: Vec<u8> = (0..3).filter_map(|i| channel(hex, i)).map(|v| (f32::from(v) * 0.8) as u8).collect();
    (c.len() == 3).then(|| format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2]))
}

fn set_var(css: &mut String, var: &str, value: &str) {
    let key = format!("{var}:");
    if let Some(i) = css.find(&key) {
        if let Some(j) = css[i..].find(';') {
            css.replace_range(i..i + j, &format!("{var}: {value}"));
        }
    }
}

/// The style sheet of the sign-in page: the one of the platform, with the colours and the logo of the brand.
pub fn css(colors: &toml::Table, logo_file: &str) -> String {
    let mut css = CSS.replace("../img/logo.svg", &format!("../img/{logo_file}"));
    let get = |k: &str| colors.get(k).and_then(|v| v.as_str()).filter(|v| v.len() == 7 && v.starts_with('#'));
    if let Some(a) = get("accent") {
        set_var(&mut css, "--msk-accent", a);
        if let Some(d) = darker(a) {
            set_var(&mut css, "--msk-accent-dark", &d);
        }
    }
    for (var, key) in
        [("--msk-bg", "bg"), ("--msk-card", "panel"), ("--msk-text", "fg"), ("--msk-border", "line")]
    {
        if let Some(v) = get(key) {
            set_var(&mut css, var, v);
        }
    }
    css
}

/// The folder `keycloak/` of the release: the realm, the theme and a README.
pub fn write(d: &Distribution, brand: Option<&Path>, out: &Path) -> Result<()> {
    let id = &d.product.id;
    let dir = out.join("keycloak");
    let theme = dir.join("themes").join(id).join("login");
    std::fs::create_dir_all(theme.join("resources").join("css"))?;
    std::fs::create_dir_all(theme.join("resources").join("img"))?;
    std::fs::write(dir.join(format!("realm-{id}.json")), realm(id, &d.product.name)?)?;
    std::fs::write(
        theme.join("theme.properties"),
        "# sign-in page of the product, in the look of its brand\nparent=keycloak.v2\nstyles=css/login.css\n",
    )?;
    let table = brand
        .and_then(|b| std::fs::read_to_string(b.join("brand.toml")).ok())
        .and_then(|t| toml::from_str::<toml::Table>(&t).ok())
        .unwrap_or_default();
    let img = theme.join("resources").join("img");
    let logo_src = table
        .get("logo")
        .and_then(|v| v.as_str())
        .and_then(|f| brand.map(|b| b.join(f)))
        .filter(|p| p.is_file());
    let logo_file = match logo_src.as_ref().and_then(|p| p.extension()).and_then(|e| e.to_str()) {
        Some(ext) => format!("logo.{ext}"),
        None => "logo.svg".to_string(),
    };
    match &logo_src {
        Some(p) => {
            std::fs::copy(p, img.join(&logo_file))?;
        }
        None => std::fs::write(img.join(&logo_file), LOGO)?,
    }
    let colors = table.get("colors").and_then(|v| v.as_table()).cloned().unwrap_or_default();
    std::fs::write(theme.join("resources").join("css").join("login.css"), css(&colors, &logo_file))?;
    std::fs::write(dir.join("README.md"), readme(d))?;
    Ok(())
}

/// What the release adds to `distribution.toml`: the sample tenant of the identity provider.
pub fn bootstrap(d: &Distribution) -> String {
    let id = &d.product.id;
    format!(
        "\n# added by `mosaikit-product build docker` ([docker] keycloak = true): a sample tenant that signs in through Keycloak\n\
         [bootstrap.idp_demo]\ntenant = \"{TENANT}\"\ntenant_name = \"{name} (identity provider demo)\"\n\
         issuer = \"http://localhost:{PORT}/realms/{id}\"\nclient_id = \"{id}\"\n\
         manager_groups = [\"{id}-managers\"]\nuser_groups = [\"{id}-users\"]\nbutton_text = \"Sign in with Keycloak\"\n",
        name = d.product.name
    )
}

/// The services of Keycloak for the compose file, and the volume it needs.
pub fn services(id: &str) -> String {
    format!(
        r#"  # ---- Keycloak: the identity provider of the sample tenant "{TENANT}" (a demonstration: see keycloak/README.md) ----
  keycloak:
    image: ${{KEYCLOAK_IMAGE:-quay.io/keycloak/keycloak:26.0}}
    restart: unless-stopped
    command: ["start-dev", "--import-realm"]
    environment:
      KC_BOOTSTRAP_ADMIN_USERNAME: ${{KEYCLOAK_ADMIN:-admin}}
      KC_BOOTSTRAP_ADMIN_PASSWORD: ${{KEYCLOAK_ADMIN_PASSWORD:-change-me-now}}
      KC_HTTP_PORT: "{PORT}"
      KC_HOSTNAME: ${{KEYCLOAK_URL:-http://localhost:{PORT}}}
      MOSAIKIT_OIDC_CLIENT_SECRET: ${{MOSAIKIT_OIDC_CLIENT_SECRET:-mosaikit-dev-secret}}
      MOSAIKIT_URL: ${{MOSAIKIT_URL:-http://localhost:8080}}
    ports:
      - "${{KEYCLOAK_PORT:-{PORT}}}:{PORT}"
    volumes:
      - kcdata:/opt/keycloak/data
      - ./keycloak/realm-{id}.json:/opt/keycloak/data/import/realm-{id}.json:ro
      - ./keycloak/themes/{id}:/opt/keycloak/themes/{id}:ro
  # The app accepts an http issuer only on localhost: this forwarder shares the network of the app and relays
  # localhost:{PORT} to Keycloak, so that the issuer works for the browser and for the app.
  keycloak-localhost:
    image: ${{SOCAT_IMAGE:-alpine/socat:1.8.0.0}}
    restart: unless-stopped
    network_mode: "service:app"
    depends_on:
      - keycloak
    command: ["TCP-LISTEN:{PORT},fork,reuseaddr", "TCP:keycloak:{PORT}"]
"#
    )
}

fn readme(d: &Distribution) -> String {
    let (id, name) = (&d.product.id, &d.product.name);
    format!(
        r#"# Keycloak for {name}

`docker compose up -d` also starts Keycloak, so that you can try a tenant that signs in through an identity provider
(OpenID Connect) next to the local one.

| What | Where |
|---|---|
| The product | http://localhost:8080 |
| The sample tenant | `{TENANT}`: choose it on the sign-in page, then "Sign in with Keycloak" |
| Keycloak console | http://localhost:{PORT} (`KEYCLOAK_ADMIN`, `KEYCLOAK_ADMIN_PASSWORD`; default `admin` / `change-me-now`) |
| The realm | `{id}`, imported from `keycloak/realm-{id}.json` at the first start |

Test people (password `change-me`): `anna.manager` (group `{id}-managers`, becomes Tenant Manager), `bruno.user` (group `{id}-users`, becomes
User) and `carla.noaccess` (no group, refused by the product).

The sign-in page of Keycloak takes the colours and the logo of your brand (`keycloak/themes/{id}`). The tenant is made at the first start with
its sign-in already configured (`[bootstrap.idp_demo]` in `distribution.toml`, the client secret from `MOSAIKIT_OIDC_CLIENT_SECRET`); you
can see and change it as the Administrator in Tenants, the tenant, Sign-in.

**This is a demonstration.** `start-dev` uses HTTP and an embedded database, the passwords are public and the client secret is a placeholder.
To remove it, delete the two services `keycloak` and `keycloak-localhost` from `compose.yml` and `[bootstrap.idp_demo]` from
`distribution.toml` (or set `[docker] keycloak = false` and build again). For a real identity provider use your own one and set the sign-in of the
tenant from the Administrator pages.
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_realm_is_named_after_the_product() {
        let r: Value = serde_json::from_str(&realm("acme", "Acme Maps").unwrap()).unwrap();
        assert_eq!((r["realm"].as_str(), r["loginTheme"].as_str()), (Some("acme"), Some("acme")));
        assert_eq!(r["clients"][0]["clientId"].as_str(), Some("acme"));
        assert!(r["groups"].to_string().contains("acme-managers"), "{}", r["groups"]);
        assert!(!r.to_string().contains("mosaikit-managers"));
    }

    #[test]
    fn the_sign_in_page_takes_the_colours_of_the_brand() {
        let t: toml::Table =
            toml::from_str("accent = \"#0b6e4f\"\nbg = \"#f6f8f7\"\nfg = \"nonsense\"").unwrap();
        let c = css(&t, "logo.png");
        assert!(c.contains("--msk-accent: #0b6e4f;") && c.contains("--msk-bg: #f6f8f7;"), "{c}");
        assert!(c.contains("--msk-accent-dark: #08583f;"), "{c}");
        assert!(c.contains("../img/logo.png") && !c.contains("../img/logo.svg"));
        // a colour that is not #rrggbb is left as it was
        assert!(c.contains("--msk-text: #1b2333;"));
    }
}

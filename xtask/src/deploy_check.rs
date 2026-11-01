//! Static checks of the Docker files in `deploy/` (no Docker needed): they run with the Rust tests.
//! They look at the text of compose.yml (no YAML library in the tree) and at the realm JSON.

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;
    use std::path::PathBuf;

    use crate::util::root;

    fn deploy() -> PathBuf {
        root().join("deploy")
    }

    fn read(rel: &str) -> String {
        std::fs::read_to_string(deploy().join(rel)).unwrap_or_else(|e| panic!("deploy/{rel}: {e}"))
    }

    /// Names after `${` up to `:-`, `}` or `:?`.
    fn vars(text: &str) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        let mut rest = text;
        while let Some(i) = rest.find("${") {
            rest = &rest[i + 2..];
            let end = rest.find(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).unwrap_or(rest.len());
            out.insert(rest[..end].to_string());
        }
        out
    }

    #[test]
    fn compose_is_well_formed() {
        let c = read("compose.yml");
        for (n, line) in c.lines().enumerate() {
            assert!(!line.contains('\t'), "compose.yml:{}: tab", n + 1);
            assert!(line.len() - line.trim_start().len() <= 8, "compose.yml:{}: too deep", n + 1);
        }
        let services: Vec<&str> = c
            .lines()
            .skip_while(|l| *l != "services:")
            .skip(1)
            .take_while(|l| l.starts_with(' ') || l.is_empty() || l.starts_with('#'))
            .filter(|l| l.starts_with("  ") && !l.starts_with("   ") && l.trim_end().ends_with(':'))
            .map(|l| l.trim().trim_end_matches(':'))
            .collect();
        for s in ["db", "app", "keycloak", "keycloak-localhost", "mail", "proxy"] {
            assert!(services.contains(&s), "service {s} missing: {services:?}");
        }
        // the optional services sit in a profile, the base ones never do
        let block = |name: &str| {
            let mut out = String::new();
            let mut inside = false;
            for l in c.lines() {
                let service_line = l.starts_with("  ")
                    && !l.starts_with("   ")
                    && !l.starts_with("  #")
                    && l.trim_end().ends_with(':');
                if service_line {
                    inside = l.trim().trim_end_matches(':') == name;
                } else if !l.starts_with(' ') && !l.is_empty() && !l.starts_with('#') {
                    inside = false;
                }
                if inside {
                    out.push_str(l);
                    out.push('\n');
                }
            }
            assert!(!out.is_empty(), "service {name} not found");
            out
        };
        for s in ["keycloak", "keycloak-localhost", "mail", "proxy"] {
            assert!(block(s).contains("profiles: ["), "{s} has no profile");
        }
        for s in ["db", "app"] {
            assert!(!block(s).contains("profiles:"), "{s} must not be in a profile");
        }
        assert!(!block("db").contains("ports:"), "the database must not be published");
        // every volume and port mapping with a relative host path exists
        for line in c.lines().map(str::trim).filter(|l| l.starts_with("- ./")) {
            let host = line.trim_start_matches("- ").split(':').next().unwrap().trim_start_matches("./");
            assert!(deploy().join(host).exists(), "compose.yml mounts {host}: not found");
        }
        // named volumes used are declared
        let declared: BTreeSet<&str> = c
            .lines()
            .skip_while(|l| *l != "volumes:")
            .skip(1)
            .map(|l| l.trim().trim_end_matches(':'))
            .collect();
        for line in c.lines().map(str::trim).filter(|l| l.starts_with("- ") && l.contains(":/")) {
            let src = line.trim_start_matches("- ").split(':').next().unwrap();
            if !src.starts_with('.') && !src.starts_with('$') && !src.starts_with('"') {
                assert!(declared.contains(src), "volume {src} not declared");
            }
        }
    }

    #[test]
    fn compose_variables_are_documented() {
        let readme = read("README.docker.md");
        let c = read("compose.yml");
        for v in vars(&c) {
            assert!(readme.contains(&v), "{v} used in compose.yml but not in README.docker.md");
        }
    }

    #[test]
    fn realm_import_is_safe() {
        let r: serde_json::Value = serde_json::from_str(&read("keycloak/realm-mosaikit.json")).unwrap();
        assert_eq!(r["realm"], "mosaikit");
        assert_eq!(r["registrationAllowed"], false, "self-registration must be off");
        assert_eq!(r["loginTheme"], "mosaikit");
        let client = r["clients"].as_array().unwrap().iter().find(|c| c["clientId"] == "mosaikit").unwrap();
        assert_eq!(client["attributes"]["pkce.code.challenge.method"], "S256");
        assert_eq!(client["implicitFlowEnabled"], false);
        assert_eq!(client["directAccessGrantsEnabled"], false);
        let uris = client["redirectUris"].as_array().unwrap();
        assert!(!uris.is_empty());
        for u in uris {
            let u = u.as_str().unwrap();
            assert!(u.contains("/api/auth/oidc/") && u != "*", "redirect URI too wide: {u}");
        }
        // only the placeholders the compose file defines
        let text = read("keycloak/realm-mosaikit.json");
        let compose = read("compose.yml");
        for v in vars(&text) {
            assert!(compose.contains(&format!("{v}:")), "{v} of the realm is not set by compose.yml");
        }
        assert!(r["users"].as_array().unwrap().len() >= 2);
    }

    #[test]
    fn keycloak_theme_files_exist() {
        for f in ["theme.properties", "resources/css/login.css", "resources/img/logo.svg"] {
            assert!(deploy().join("keycloak/themes/mosaikit/login").join(f).is_file(), "{f}");
        }
        let props = read("keycloak/themes/mosaikit/login/theme.properties");
        assert!(props.contains("styles=css/login.css"));
    }

    #[test]
    fn nginx_templates_use_known_variables() {
        let compose = read("compose.yml");
        let dir = deploy().join("nginx/templates");
        let mut n = 0;
        for e in std::fs::read_dir(&dir).unwrap() {
            let p = e.unwrap().path();
            let text = std::fs::read_to_string(&p).unwrap();
            assert_eq!(text.matches('{').count(), text.matches('}').count(), "{}: braces", p.display());
            for v in vars(&text) {
                assert!(v.starts_with("NGINX_"), "{}: ${{{v}}} is not substituted by the image", p.display());
                assert!(compose.contains(&format!("{v}:")), "{v} not set in compose.yml");
            }
            n += 1;
        }
        assert!(n >= 3);
        let main = read("nginx/templates/10-mosaikit.conf.template");
        assert!(
            main.contains("$connection_upgrade")
                && read("nginx/templates/proxy.inc.template").contains("proxy_read_timeout")
        );
    }

    /// The Docker development kit: the developer profile in a container that listens on every interface of its
    /// own network, published on the loopback of the host only (docs/architecture.md, the developer profile).
    #[test]
    fn devkit_compose_is_the_developer_profile_on_loopback_only() {
        let c = read("compose.devkit.yml");
        for (n, line) in c.lines().enumerate() {
            assert!(!line.contains('\t'), "compose.devkit.yml:{}: tab", n + 1);
        }
        for must in [
            "MOSAIKIT_DEVELOPER_PROFILE: \"1\"",
            "MOSAIKIT_DEVELOPER_PROFILE_ALLOW_REMOTE: \"1\"",
            "MOSAIKIT_DEV_PLUGINS: /plugin",
            "http://*.localhost:",
            "mosaikit_app:",
            "/plugin",
        ] {
            assert!(c.contains(must), "compose.devkit.yml lacks {must}");
        }
        // every published port is bound to 127.0.0.1, and the database is not published at all
        let ports: Vec<&str> =
            c.lines().map(str::trim).filter(|l| l.starts_with("- \"") && l.contains(":8")).collect();
        assert_eq!(ports.len(), 2, "{ports:?}");
        for p in ports {
            assert!(p.starts_with("- \"127.0.0.1:"), "port not on loopback: {p}");
        }
        let db: String = c
            .lines()
            .skip_while(|l| !l.starts_with("  db:"))
            .take_while(|l| !l.starts_with("  app:"))
            .collect();
        assert!(!db.contains("ports:"), "the database must not be published");
        // no reverse proxy, no trust of forwarded headers, no production flags
        assert!(!c.contains("MOSAIKIT_TRUST_PROXY") && !c.contains("profiles:"));
        // the volumes it uses are declared, the init folder exists
        for v in ["pgdata", "appdata"] {
            assert!(c.contains(&format!("  {v}:")), "volume {v} not declared");
        }
        assert!(deploy().join("initdb").is_dir());
        // the README documents every variable of the file
        let readme = read("README.devkit.md");
        for v in vars(&c) {
            assert!(
                readme.contains(&v) || v.starts_with("MOSAIKIT_DB_PASSWORD") || v == "POSTGRES_PASSWORD",
                "{v} not in README.devkit.md"
            );
        }
    }

    /// The folder of the kit is written without Docker: compose, initdb, `.env`, README and an empty plugin folder.
    #[test]
    fn devkit_folder_is_generated_without_docker() {
        // temporary work goes under MOSAIKIT_TEMP when it is set (CLAUDE.md)
        let base = std::env::var_os("MOSAIKIT_TEMP").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        let tmp = base.join(format!("devkit-folder-test-{}", std::process::id()));
        let out =
            crate::release::devkit_folder(&tmp.join("kit"), "mosaikit-dev", "1.2.3", "postgres:17-alpine")
                .unwrap();
        for f in ["compose.yml", ".env", "README.md", "initdb", "plugin/.gitkeep"] {
            assert!(out.join(f).exists(), "{f}");
        }
        let env = std::fs::read_to_string(out.join(".env")).unwrap();
        assert!(
            env.contains("MOSAIKIT_DEV_IMAGE=mosaikit-dev") && env.contains("MOSAIKIT_VERSION=1.2.3"),
            "{env}"
        );
        let readme = std::fs::read_to_string(out.join("README.md")).unwrap();
        assert!(
            !readme.contains("{{") && readme.contains("mosaikit-dev-1.2.3-image.tar"),
            "placeholders left"
        );
        // the compose file of the folder is the one of deploy/
        assert_eq!(std::fs::read_to_string(out.join("compose.yml")).unwrap(), read("compose.devkit.yml"));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

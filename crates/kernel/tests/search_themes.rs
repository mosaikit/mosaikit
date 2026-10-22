//! Search of the shell (what a person can see, trash, other tenants, plugins off, searchable fields),
//! themes of the theme editor (contrast, allowed themes, themes of a tenant) and the preferences that
//! follow a person (high contrast, guided tours).

use mosaikit_kernel::acl::{set_grant, Level};
use mosaikit_kernel::personal::{self, PrefsChange};
use mosaikit_kernel::plugins::tenants;
use mosaikit_kernel::search::{self, Group};
use mosaikit_kernel::tenancy::themes::{self, ThemeInput};
use mosaikit_kernel::tenancy::{self, set_platform_theme, set_tenant_theme, tenant_theme};
use mosaikit_kernel::testing::start;
use mosaikit_kernel::{crud, trash, Caller, Kernel, Kind};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use uuid::Uuid;

const NOTES: &str = "com.mosaikit.notes";

fn obj(v: Value) -> Map<String, Value> {
    v.as_object().cloned().unwrap()
}

async fn note(k: &Kernel, c: &Caller, title: &str, body: &str) -> Uuid {
    let row = crud::create(k, c, NOTES, "notes", &obj(json!({ "title": title, "body": body })), None)
        .await
        .unwrap();
    row["id"].as_str().unwrap().parse().unwrap()
}

async fn found(k: &Kernel, c: &Caller, q: &str) -> Vec<String> {
    let groups: Vec<Group> = search::search(k, c, q, "en").await.unwrap();
    groups.iter().flat_map(|g| g.items.iter().map(|i| i.title.clone())).collect()
}

#[tokio::test]
async fn search_finds_only_what_one_can_see() {
    let t = start().await;
    t.install("notes").await;
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;
    let anna = t.member(&g, "anna").await;
    let anna = t.home(&anna).await;
    let bruno = t.member(&g, "bruno").await;
    let bruno = t.home(&bruno).await;

    let visit = note(&t, &anna, "Site visit", "The north depot needs another look").await;
    let budget = note(&t, &bruno, "Budget 2027", "Numbers of the depot").await;

    // title and searchable fields (the body), each word as a beginning
    assert_eq!(found(&t, &anna, "site").await, vec!["Site visit"]);
    assert_eq!(found(&t, &anna, "depo north").await, vec!["Site visit"]);
    let groups = search::search(&t, &anna, "depot", "en").await.unwrap();
    assert_eq!(groups.len(), 1);
    assert_eq!(
        (groups[0].plugin_id.as_str(), groups[0].label.as_str(), groups[0].count),
        (NOTES, "Notes", 1)
    );
    assert!(groups[0].items[0].snippet.contains("north depot"), "{:?}", groups[0].items[0]);
    assert_eq!(search::search(&t, &anna, "depot", "it").await.unwrap()[0].label, "Note");
    // nothing for one letter
    assert!(found(&t, &anna, "s").await.is_empty());

    // the item of Bruno is not shared: Anna does not find it, Bruno does
    assert!(!found(&t, &anna, "budget").await.contains(&"Budget 2027".to_string()));
    assert_eq!(found(&t, &bruno, "budget").await, vec!["Budget 2027"]);
    set_grant(&t, &bruno, budget, "user", anna.user.user_id, Some(Level::Read)).await.unwrap();
    assert_eq!(found(&t, &anna, "budget").await, vec!["Budget 2027"]);

    // the Tenant Manager does not see private items through the search either
    assert!(found(&t, &manager, "visit").await.is_empty());

    // the trash hides an item, the restore brings it back
    crud::delete(&t, &anna, NOTES, "notes", visit).await.unwrap();
    assert!(found(&t, &anna, "visit").await.is_empty());
    trash::restore(&t, &anna, visit).await.unwrap();
    assert_eq!(found(&t, &anna, "visit").await, vec!["Site visit"]);

    // an update changes the searchable text
    crud::update(&t, &anna, NOTES, "notes", visit, &obj(json!({ "body": "warehouse" }))).await.unwrap();
    assert!(found(&t, &anna, "north").await.is_empty());
    assert_eq!(found(&t, &anna, "warehouse").await, vec!["Site visit"]);

    // items without a search text (older ones) are indexed by the background work
    mosaikit_db::query("update core.resources set search_text = null").execute(&t.k.db).await.unwrap();
    assert!(found(&t, &anna, "warehouse").await.is_empty());
    assert_eq!(found(&t, &anna, "visit").await, vec!["Site visit"], "the title is always found");
    assert!(search::reindex_pending(&t).await.unwrap() >= 2);
    assert_eq!(found(&t, &anna, "warehouse").await, vec!["Site visit"]);

    // another tenant never sees the items of this one
    let h = t.tenant("beta").await;
    let beta = t.home(&h).await;
    note(&t, &beta, "Beta visit", "").await;
    assert_eq!(found(&t, &beta, "visit").await, vec!["Beta visit"]);
    assert_eq!(found(&t, &anna, "visit").await, vec!["Site visit"]);

    // a plugin turned off in the tenant is out of the search
    tenants::set_enabled(&t, &manager, NOTES, false).await.unwrap();
    assert!(found(&t, &anna, "visit").await.is_empty());
    tenants::set_enabled(&t, &manager, NOTES, true).await.unwrap();

    // the Administrator finds tenants and people
    let admin = t.admin().await;
    let r = search::admin_search(&t, &admin, "alf").await.unwrap();
    assert_eq!(r.tenants.iter().map(|x| x.sub.as_str()).collect::<Vec<_>>(), vec!["alfa"]);
    assert!(search::admin_search(&t, &admin, "ann")
        .await
        .unwrap()
        .people
        .iter()
        .any(|p| p.sub.starts_with("anna")));
    assert_eq!(search::admin_search(&t, &g, "alf").await.unwrap_err().kind, Kind::Forbidden);
}

fn vars(primary_fg: &str) -> BTreeMap<String, String> {
    [
        ("--background", "#ffffff"),
        ("--foreground", "#242424"),
        ("--primary", "#1f6f5c"),
        ("--primary-foreground", primary_fg),
        ("--band", "#174f42"),
        ("--band-foreground", "#ffffff"),
        ("--sidebar", "#eef3f1"),
        ("--sidebar-foreground", "#2a3330"),
    ]
    .into_iter()
    .map(|(a, b)| (a.to_string(), b.to_string()))
    .collect()
}

fn input(name: &str) -> ThemeInput {
    ThemeInput {
        id: None,
        name: name.into(),
        input: json!({ "accent": "#1f6f5c", "bar": "color", "grays": "cool" }),
        light: vars("#ffffff"),
        dark: vars("#ffffff"),
    }
}

#[tokio::test]
async fn themes_of_the_editor() {
    let t = start().await;
    let admin = t.admin().await;
    let g = t.tenant("alfa").await;
    let manager = t.home(&g).await;
    let alfa = manager.tenant.tenant_id;

    // contrast below AA is refused; only the Administrator saves themes of the platform
    let mut low = input("Low");
    low.light.insert("--primary-foreground".into(), "#4f9a88".into());
    assert_eq!(themes::save_platform(&t, &admin, &low).await.unwrap_err().code, Some("theme_contrast"));
    assert_eq!(themes::save_platform(&t, &g, &input("X")).await.unwrap_err().kind, Kind::Forbidden);
    let green = themes::save_platform(&t, &admin, &input("Green")).await.unwrap();
    assert!(green.id.starts_with("c-") && green.scope == "platform");
    assert_eq!(themes::platform_themes(&t).await.unwrap().len(), 1);

    // the platform uses it; an unknown theme is refused
    assert_eq!(set_platform_theme(&t, &admin, "c-nothing").await.unwrap_err().code, Some("theme_unknown"));
    set_platform_theme(&t, &admin, &green.id).await.unwrap();
    assert_eq!(tenant_theme(&t, alfa).await.unwrap().preset, green.id);
    assert_eq!(themes::delete_platform(&t, &admin, &green.id).await.unwrap_err().code, Some("theme_in_use"));
    set_platform_theme(&t, &admin, "mosaikit").await.unwrap();

    // tenants: every theme until the Administrator restricts them
    set_tenant_theme(&t, &manager, Some(&green.id)).await.unwrap();
    assert_eq!(tenant_theme(&t, alfa).await.unwrap().preset, green.id);
    themes::set_allowed(&t, &admin, Some(vec!["tessera".into()])).await.unwrap();
    assert_eq!(tenant_theme(&t, alfa).await.unwrap().preset, "mosaikit", "no longer allowed: the platform's");
    assert_eq!(
        set_tenant_theme(&t, &manager, Some(&green.id)).await.unwrap_err().code,
        Some("theme_not_allowed")
    );
    assert_eq!(
        set_tenant_theme(&t, &manager, Some("italia")).await.unwrap_err().code,
        Some("theme_not_allowed")
    );
    set_tenant_theme(&t, &manager, Some("tessera")).await.unwrap();
    assert!(themes::set_allowed(&t, &admin, Some(vec!["nope".into()])).await.is_err());
    assert!(themes::for_tenant(&t, alfa).await.unwrap().is_empty());
    themes::set_allowed(&t, &admin, None).await.unwrap();
    assert_eq!(themes::for_tenant(&t, alfa).await.unwrap().len(), 1);

    // a theme of the tenant: only its own, and not while the theme is locked
    let mine = themes::save_tenant(&t, &manager, &input("Ours")).await.unwrap();
    assert_eq!(mine.scope, "tenant");
    set_tenant_theme(&t, &manager, Some(&mine.id)).await.unwrap();
    assert_eq!(tenant_theme(&t, alfa).await.unwrap().preset, mine.id);
    let anna = t.member(&g, "anna").await;
    let anna = t.home(&anna).await;
    assert_eq!(themes::save_tenant(&t, &anna, &input("No")).await.unwrap_err().kind, Kind::Forbidden);
    let h = t.tenant("beta").await;
    let beta = t.home(&h).await;
    assert_eq!(
        set_tenant_theme(&t, &beta, Some(&mine.id)).await.unwrap_err().code,
        Some("theme_not_allowed")
    );
    // the public list (sign-in page) has the themes of the platform and the ones in use by tenants
    let public: Vec<String> = themes::public(&t).await.unwrap().into_iter().map(|x| x.id).collect();
    assert!(public.contains(&green.id) && public.contains(&mine.id));

    tenancy::levels::set_platform(&t, &admin, &Map::new(), &obj(json!({ "theme": false }))).await.unwrap();
    assert_eq!(
        themes::save_tenant(&t, &manager, &input("Again")).await.unwrap_err().code,
        Some("setting_locked")
    );
    assert_eq!(tenant_theme(&t, alfa).await.unwrap().preset, "mosaikit");

    // deleting the theme in use brings the tenant back to the platform's
    themes::delete_tenant(&t, &manager, &mine.id).await.unwrap();
    assert!(themes::tenant_themes(&t, alfa).await.unwrap().is_empty());
}

#[tokio::test]
async fn preferences_of_a_person() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    let me = g.user_id;
    assert_eq!(personal::get(&t, me).await.unwrap(), Default::default());
    let p = personal::change(
        &t,
        me,
        &PrefsChange { contrast: Some(true), tour_done: Some("home".into()), ..Default::default() },
    )
    .await
    .unwrap();
    assert!(p.contrast && p.tours_done == vec!["home"]);
    personal::change(&t, me, &PrefsChange { tour_done: Some("home".into()), ..Default::default() })
        .await
        .unwrap();
    let p = personal::change(&t, me, &PrefsChange { tour_done: Some("manage".into()), ..Default::default() })
        .await
        .unwrap();
    assert_eq!(p.tours_done, vec!["home", "manage"]);
    assert!(personal::get(&t, me).await.unwrap().contrast);
    assert!(personal::change(
        &t,
        me,
        &PrefsChange { tour_done: Some("<script>".into()), ..Default::default() }
    )
    .await
    .is_err());
    let p = personal::change(
        &t,
        me,
        &PrefsChange { reset_tours: true, contrast: Some(false), ..Default::default() },
    )
    .await
    .unwrap();
    assert!(!p.contrast && p.tours_done.is_empty());
}

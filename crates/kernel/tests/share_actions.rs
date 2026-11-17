//! Actions of a share (`[[resources]] actions`): set per person or group next to the level, implied by manage,
//! answered by `actions::allowed`, filtered by `resources.list`. Run with `MOSAIKIT_TEST_BACKEND=sqlite` for SQLite.

use std::collections::BTreeMap;

use mosaikit_kernel::acl::{grants, set_grant, set_grant_with, Level};
use mosaikit_kernel::testing::{start, test_key, TestKernel};
use mosaikit_kernel::{actions, crud, Kind};
use serde_json::json;
use uuid::Uuid;

const DOCS: &str = "com.test.docs";

async fn install_docs(t: &TestKernel) {
    let toml = format!(
        "id = \"{DOCS}\"\nname = \"Docs\"\nversion = \"1.0.0\"\n[contribution]\nicon = \"x\"\nlabel = \"Docs\"\n\
         [[resources]]\nname = \"docs\"\nlabel = \"Doc\"\nactions = [\"download\", \"run\"]\n\
         [[resources.fields]]\nkey = \"title\"\nlabel = \"Title\"\nkind = \"text\"\n"
    );
    let mut files = BTreeMap::new();
    files.insert("plugin.toml".to_string(), toml.into_bytes());
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    t.install_package(&pkg).await.unwrap();
}

async fn doc(t: &TestKernel, who: &mosaikit_kernel::Caller) -> Uuid {
    let row =
        crud::create(t, who, DOCS, "docs", json!({ "title": "d" }).as_object().unwrap(), None).await.unwrap();
    row["id"].as_str().unwrap().parse().unwrap()
}

fn names(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[tokio::test]
async fn a_share_carries_actions_that_the_kernel_answers() {
    let t = start().await;
    install_docs(&t).await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let carla = t.member(&g, "carla").await;
    let (ca, cb, cc) = (t.home(&anna).await, t.home(&bruno).await, t.home(&carla).await);
    let rid = doc(&t, &ca).await;

    // a reader without actions only sees
    set_grant(&t, &ca, rid, "user", bruno.user_id, Some(Level::Read)).await.unwrap();
    assert!(!actions::allowed(&t, &cb, rid, "download").await.unwrap());
    // the owner manages: every action
    assert!(actions::allowed(&t, &ca, rid, "run").await.unwrap());

    // the action is on the share; the level is untouched
    set_grant_with(&t, &ca, rid, "user", bruno.user_id, Some(Level::Read), Some(&names(&["download"])))
        .await
        .unwrap();
    assert!(actions::allowed(&t, &cb, rid, "download").await.unwrap());
    assert!(!actions::allowed(&t, &cb, rid, "run").await.unwrap());
    let list = grants(&t, &ca, rid).await.unwrap();
    assert_eq!(list[0].actions, ["download"]);
    assert_eq!(list[0].level, "read");

    // a change of level with the plain call keeps the actions
    set_grant(&t, &ca, rid, "user", bruno.user_id, Some(Level::Write)).await.unwrap();
    assert!(actions::allowed(&t, &cb, rid, "download").await.unwrap());
    // an empty set clears them
    set_grant_with(&t, &ca, rid, "user", bruno.user_id, Some(Level::Write), Some(&[])).await.unwrap();
    assert!(!actions::allowed(&t, &cb, rid, "download").await.unwrap());

    // manage implies every action
    set_grant(&t, &ca, rid, "user", carla.user_id, Some(Level::Manage)).await.unwrap();
    assert!(actions::allowed(&t, &cc, rid, "run").await.unwrap());

    // names the plugin does not declare, or badly formed, are refused
    for bad in [&["delete"][..], &["Download"][..], &["manage"][..]] {
        let e = set_grant_with(&t, &ca, rid, "user", bruno.user_id, Some(Level::Read), Some(&names(bad)))
            .await
            .unwrap_err();
        assert_eq!(e.kind, Kind::BadRequest, "{bad:?}");
    }
    // somebody who does not see the item gets no for any action
    set_grant(&t, &ca, rid, "user", bruno.user_id, None).await.unwrap();
    assert!(!actions::allowed(&t, &cb, rid, "download").await.unwrap());
}

#[tokio::test]
async fn an_action_on_a_group_reaches_its_members_and_resources_list_filters_by_it() {
    let t = start().await;
    install_docs(&t).await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let (ca, cb) = (t.home(&anna).await, t.home(&bruno).await);
    let (d1, d2) = (doc(&t, &ca).await, doc(&t, &ca).await);
    let all = actions::allowed_among(&t, &cb, &[d1, d2], "download").await.unwrap();
    assert!(all.is_empty());

    // the built-in group of every member, with the action on one of the two items
    set_grant_with(&t, &ca, d1, "all", Uuid::nil(), Some(Level::Read), Some(&names(&["download"])))
        .await
        .unwrap();
    set_grant(&t, &ca, d2, "all", Uuid::nil(), Some(Level::Read)).await.unwrap();
    let ok = actions::allowed_among(&t, &cb, &[d1, d2], "download").await.unwrap();
    assert_eq!(ok.into_iter().collect::<Vec<_>>(), [d1]);
    let ok = actions::allowed_among(&t, &cb, &[d1, d2], "run").await.unwrap();
    assert!(ok.is_empty());
}

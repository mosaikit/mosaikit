//! Comments on resources: who reads and writes, the limits, who deletes. Run with
//! `MOSAIKIT_TEST_BACKEND=sqlite` for SQLite.

use mosaikit_kernel::acl::{set_grant, Level};
use mosaikit_kernel::comments as cm;
use mosaikit_kernel::testing::start;
use mosaikit_kernel::{crud, Kind};
use serde_json::json;
use uuid::Uuid;

async fn item(t: &mosaikit_kernel::testing::TestKernel, who: &mosaikit_kernel::Caller) -> Uuid {
    t.install("notes").await;
    let row = crud::create(
        t,
        who,
        "com.mosaikit.notes",
        "notes",
        json!({ "title": "n" }).as_object().unwrap(),
        None,
    )
    .await
    .unwrap();
    row["id"].as_str().unwrap().parse().unwrap()
}

#[tokio::test]
async fn people_who_see_a_resource_comment_on_it_and_no_one_else() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    let anna = t.member(&g, "anna").await;
    let bruno = t.member(&g, "bruno").await;
    let carla = t.member(&g, "carla").await;
    let (ca, cb, cc) = (t.home(&anna).await, t.home(&bruno).await, t.home(&carla).await);
    let rid = item(&t, &ca).await;
    // a person who does not see the resource does not learn it exists
    for r in [cm::list(&t, &cb, rid).await.map(|_| ()), cm::add(&t, &cb, rid, "hi").await.map(|_| ())] {
        assert_eq!(r.unwrap_err().kind, Kind::NotFound);
    }
    set_grant(&t, &ca, rid, "user", bruno.user_id, Some(Level::Read)).await.unwrap();
    set_grant(&t, &ca, rid, "user", carla.user_id, Some(Level::Write)).await.unwrap();
    // a reader writes too
    let first = cm::add(&t, &cb, rid, "  First <b>comment</b>\nline two ").await.unwrap();
    assert_eq!(first.body, "First <b>comment</b>\nline two");
    cm::add(&t, &cc, rid, "second").await.unwrap();
    let th = cm::list(&t, &ca, rid).await.unwrap();
    assert_eq!((th.count, th.comments.len()), (2, 2));
    assert_eq!(th.comments[0].author_name.is_empty(), false);
    assert!(th.comments.iter().all(|c| c.can_delete), "the owner manages the resource");
    assert_eq!(cm::count(&t, &cb, rid).await.unwrap(), 2);
    // delete: the author, or a manager; not another person who only writes
    let th = cm::list(&t, &cc, rid).await.unwrap();
    assert_eq!(th.comments.iter().map(|c| c.can_delete).collect::<Vec<_>>(), [false, true]);
    assert_eq!(cm::delete(&t, &cc, rid, first.id).await.unwrap_err().kind, Kind::Forbidden);
    cm::delete(&t, &cb, rid, first.id).await.unwrap();
    cm::delete(&t, &ca, rid, th.comments[1].id).await.unwrap();
    assert_eq!(cm::count(&t, &ca, rid).await.unwrap(), 0);
    assert_eq!(cm::delete(&t, &ca, rid, first.id).await.unwrap_err().kind, Kind::NotFound);
}

#[tokio::test]
async fn the_text_and_the_number_of_comments_are_limited() {
    let t = start().await;
    let g = t.tenant("alfa").await;
    let ca = t.home(&g).await;
    let rid = item(&t, &ca).await;
    let code = |r: mosaikit_kernel::Result<cm::Comment>| r.unwrap_err().code().to_string();
    assert_eq!(code(cm::add(&t, &ca, rid, "   ").await), "comment_empty");
    assert_eq!(code(cm::add(&t, &ca, rid, &"x".repeat(cm::MAX_BODY + 1)).await), "comment_too_long");
    assert_eq!(code(cm::add(&t, &ca, rid, "a\u{0007}b").await), "comment_invalid");
    cm::add(&t, &ca, rid, &"é".repeat(cm::MAX_BODY)).await.unwrap();
    // the rate limit stops a flood; the rest of the limit is the number per resource
    let mut last = Ok(());
    for _ in 0..cm::PER_MINUTE {
        last = cm::add(&t, &ca, rid, "again").await.map(|_| ());
    }
    assert_eq!(last.unwrap_err().code(), "comment_rate_limited");
    // the thread goes with the resource
    crud::delete(&t, &ca, "com.mosaikit.notes", "notes", rid).await.ok();
}

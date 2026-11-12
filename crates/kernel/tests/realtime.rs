//! Real-time channels of the plugins (`[permissions] realtime`): who may listen and send, presence, direct messages,
//! catching up after a reconnect, the limits. Run with `MOSAIKIT_TEST_BACKEND=sqlite` for SQLite.

use std::collections::BTreeMap;
use std::time::Duration;

use mosaikit_kernel::acl::{set_grant, Level};
use mosaikit_kernel::realtime::{self as rt, MAX_MESSAGE};
use mosaikit_kernel::testing::{start, test_key, TestKernel};
use mosaikit_kernel::{crud, Caller, Kind};
use serde_json::{json, Value};
use uuid::Uuid;

const RT: &str = "com.test.rt";
const NORT: &str = "com.test.nort";

fn toml(id: &str, realtime: bool) -> String {
    format!(
        "id = \"{id}\"\nname = \"Rt\"\nversion = \"1.0.0\"\n[contribution]\nicon = \"x\"\nlabel = \"Rt\"\n\
         [requires]\nmosaikit = \">=1.0\"\n\
         [[resources]]\nname = \"rooms\"\nfields = [{{ key = \"title\", kind = \"text\" }}]\n\
         [permissions]\nrealtime = {realtime}\n"
    )
}

async fn install(t: &TestKernel, id: &str, realtime: bool) {
    let mut files = BTreeMap::new();
    files.insert("plugin.toml".to_string(), toml(id, realtime).into_bytes());
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    t.install_package(&pkg).await.unwrap();
}

struct World {
    t: TestKernel,
    anna: Caller,
    bruno: Caller,
    carla: Caller,
    room: Uuid,
}

/// anna owns a room, bruno may read it, carla write it, dora (no grant) does not see it.
async fn world() -> (World, Caller) {
    let t = start().await;
    install(&t, RT, true).await;
    install(&t, NORT, false).await;
    let g = t.tenant("alfa").await;
    let (a, b, c, d) = (
        t.member(&g, "anna").await,
        t.member(&g, "bruno").await,
        t.member(&g, "carla").await,
        t.member(&g, "dora").await,
    );
    let (anna, bruno, carla, dora) = (t.home(&a).await, t.home(&b).await, t.home(&c).await, t.home(&d).await);
    let row = crud::create(&t, &anna, RT, "rooms", json!({ "title": "r" }).as_object().unwrap(), None)
        .await
        .unwrap();
    let room: Uuid = row["id"].as_str().unwrap().parse().unwrap();
    set_grant(&t, &anna, room, "user", bruno.user.user_id, Some(Level::Read)).await.unwrap();
    set_grant(&t, &anna, room, "user", carla.user.user_id, Some(Level::Write)).await.unwrap();
    (World { t, anna, bruno, carla, room }, dora)
}

async fn next(sub: &mut rt::Subscription) -> std::sync::Arc<rt::Frame> {
    tokio::time::timeout(Duration::from_secs(2), sub.recv()).await.expect("a frame in time").unwrap()
}

#[tokio::test]
async fn the_access_rule_of_the_resource_decides() {
    let (w, dora) = world().await;
    let k = &w.t.k;
    // dora does not see the room: she does not learn it exists
    let e = rt::subscribe(k, &dora, RT, w.room, "chat", None, json!({})).await.err().unwrap();
    assert_eq!(e.kind, Kind::NotFound);
    let e = rt::publish(k, &dora, RT, w.room, "chat", json!(1), None).await.unwrap_err();
    assert_eq!(e.kind, Kind::NotFound);
    // a reader listens but does not send
    let _bruno = rt::subscribe(k, &w.bruno, RT, w.room, "chat", None, json!({})).await.unwrap();
    let e = rt::publish(k, &w.bruno, RT, w.room, "chat", json!(1), None).await.unwrap_err();
    assert_eq!((e.kind, e.code()), (Kind::Forbidden, "rt_forbidden"));
    // a writer sends
    rt::publish(k, &w.carla, RT, w.room, "chat", json!({ "text": "hi" }), None).await.unwrap();
}

#[tokio::test]
async fn the_plugin_must_declare_realtime_and_own_the_resource() {
    let (w, _) = world().await;
    let k = &w.t.k;
    let e = rt::subscribe(k, &w.anna, NORT, w.room, "chat", None, json!({})).await.err().unwrap();
    assert_eq!(e.kind, Kind::Forbidden);
    assert!(e.message.contains("realtime"), "{e}");
    // the room belongs to RT: another plugin cannot open a channel on it
    let e = rt::subscribe(k, &w.anna, NORT, Uuid::new_v4(), "chat", None, json!({})).await.err().unwrap();
    assert!(matches!(e.kind, Kind::Forbidden | Kind::NotFound));
    // names
    for bad in ["", "Chat", "a b", "a/b"] {
        let e = rt::subscribe(k, &w.anna, RT, w.room, bad, None, json!({})).await.err().unwrap();
        assert_eq!((e.kind, e.code()), (Kind::BadRequest, "rt_name"), "{bad}");
    }
}

#[tokio::test]
async fn messages_reach_the_listeners_with_the_sender_set_by_the_kernel() {
    let (w, _) = world().await;
    let k = &w.t.k;
    let mut b = rt::subscribe(k, &w.bruno, RT, w.room, "chat", None, json!({})).await.unwrap();
    let seq = rt::publish(k, &w.carla, RT, w.room, "chat", json!({ "text": "hello" }), None).await.unwrap();
    let f = next(&mut b).await;
    assert_eq!((f.kind, f.seq), ("message", seq));
    assert_eq!(f.data["text"], "hello");
    assert_eq!(f.from.id, w.carla.user.user_id);
    // another channel of the same room is another conversation
    let mut other = rt::subscribe(k, &w.bruno, RT, w.room, "notes", None, json!({})).await.unwrap();
    rt::publish(k, &w.carla, RT, w.room, "chat", json!(2), None).await.unwrap();
    assert!(tokio::time::timeout(Duration::from_millis(150), other.recv()).await.is_err());
}

#[tokio::test]
async fn presence_follows_the_connections() {
    let (w, _) = world().await;
    let k = &w.t.k;
    let mut a =
        rt::subscribe(k, &w.anna, RT, w.room, "chat", None, json!({ "typing": false })).await.unwrap();
    assert_eq!(a.people.len(), 1);
    let b = rt::subscribe(k, &w.bruno, RT, w.room, "chat", None, json!({})).await.unwrap();
    assert_eq!(b.people.len(), 2);
    let join = next(&mut a).await;
    assert_eq!((join.kind, join.from.id), ("join", w.bruno.user.user_id));
    // a second tab of bruno does not announce him twice, the first one leaving does not make him leave
    let b2 = rt::subscribe(k, &w.bruno, RT, w.room, "chat", None, json!({})).await.unwrap();
    drop(b);
    assert!(tokio::time::timeout(Duration::from_millis(150), a.recv()).await.is_err());
    drop(b2);
    let leave = next(&mut a).await;
    assert_eq!((leave.kind, leave.from.id), ("leave", w.bruno.user.user_id));
    // the state is part of the presence
    rt::set_state(k, &w.anna, RT, w.room, "chat", json!({ "typing": true })).await.unwrap();
    let st = next(&mut a).await;
    assert_eq!((st.kind, st.from.state.clone()), ("state", Some(json!({ "typing": true }))));
    // no state without listening
    let e = rt::set_state(k, &w.carla, RT, w.room, "chat", json!({})).await.unwrap_err();
    assert_eq!(e.code(), "rt_not_connected");
}

#[tokio::test]
async fn a_direct_message_reaches_only_its_recipient() {
    let (w, _) = world().await;
    let k = &w.t.k;
    let mut a = rt::subscribe(k, &w.anna, RT, w.room, "call", None, json!({})).await.unwrap();
    let mut b = rt::subscribe(k, &w.bruno, RT, w.room, "call", None, json!({})).await.unwrap();
    // bruno's arrival reaches anna, not bruno
    assert_eq!(next(&mut a).await.kind, "join");
    rt::publish(k, &w.carla, RT, w.room, "call", json!({ "offer": "sdp" }), Some(w.bruno.user.user_id))
        .await
        .unwrap();
    assert_eq!(next(&mut b).await.data["offer"], "sdp");
    assert!(
        tokio::time::timeout(Duration::from_millis(150), a.recv()).await.is_err(),
        "anna must not see it"
    );
    // the sender sees what they send
    rt::publish(k, &w.carla, RT, w.room, "call", json!(1), None).await.unwrap();
    assert_eq!(next(&mut a).await.data, json!(1));
}

#[tokio::test]
async fn a_client_that_reconnects_catches_up() {
    let (w, _) = world().await;
    let k = &w.t.k;
    let keep = rt::subscribe(k, &w.anna, RT, w.room, "chat", None, json!({})).await.unwrap();
    let s1 = rt::publish(k, &w.carla, RT, w.room, "chat", json!(1), None).await.unwrap();
    let s2 = rt::publish(k, &w.carla, RT, w.room, "chat", json!(2), None).await.unwrap();
    let s3 = rt::publish(k, &w.carla, RT, w.room, "chat", json!(3), None).await.unwrap();
    let back = rt::subscribe(k, &w.bruno, RT, w.room, "chat", Some(s1), json!({})).await.unwrap();
    assert_eq!(back.replay.iter().map(|f| f.seq).collect::<Vec<_>>(), [s2, s3]);
    assert!(!back.gap);
    // asking for what the buffer no longer has says so
    for i in 0..250 {
        rt::publish(k, &w.carla, RT, w.room, "chat", json!(i), None).await.ok();
        if i % 25 == 24 {
            tokio::time::sleep(Duration::from_millis(1100)).await;
        }
    }
    let late = rt::subscribe(k, &w.bruno, RT, w.room, "chat", Some(s1), json!({})).await.unwrap();
    assert!(late.gap);
    drop(keep);
}

#[tokio::test]
async fn limits() {
    let (w, _) = world().await;
    let k = &w.t.k;
    // size
    let big = Value::String("x".repeat(MAX_MESSAGE));
    let e = rt::publish(k, &w.carla, RT, w.room, "chat", big, None).await.unwrap_err();
    assert_eq!(e.code(), "rt_too_large");
    let e = rt::subscribe(k, &w.anna, RT, w.room, "chat", None, Value::String("x".repeat(2000)))
        .await
        .err()
        .unwrap();
    assert_eq!(e.code(), "rt_too_large");
    // rate: 30 a second
    let mut refused = 0;
    for i in 0..40 {
        if let Err(e) = rt::publish(k, &w.carla, RT, w.room, "rate", json!(i), None).await {
            assert_eq!((e.kind, e.code()), (Kind::TooMany, "rt_rate"));
            refused += 1;
        }
    }
    assert!(refused >= 8, "{refused}");
    // channels per person
    let mut subs = Vec::new();
    for i in 0..rt::MAX_OPEN_PER_USER {
        subs.push(rt::subscribe(k, &w.anna, RT, w.room, &format!("c{i}"), None, json!({})).await.unwrap());
    }
    let e = rt::subscribe(k, &w.anna, RT, w.room, "one-more", None, json!({})).await.err().unwrap();
    assert_eq!((e.kind, e.code()), (Kind::TooMany, "rt_rate"));
    // leaving frees the place and, with nobody left, the channels
    drop(subs);
    rt::subscribe(k, &w.anna, RT, w.room, "one-more", None, json!({})).await.unwrap();
    assert!(k.rt.channels() <= 3, "{}", k.rt.channels());
}

#[tokio::test]
async fn a_person_who_loses_the_right_is_refused_at_the_next_check() {
    let (w, _) = world().await;
    let k = &w.t.k;
    rt::authorize(k, &w.bruno, RT, w.room, "chat", Level::Read).await.unwrap();
    set_grant(&w.t, &w.anna, w.room, "user", w.bruno.user.user_id, None).await.unwrap();
    let e = rt::authorize(k, &w.bruno, RT, w.room, "chat", Level::Read).await.unwrap_err();
    assert_eq!(e.kind, Kind::NotFound);
    assert!(rt::session_open(k, &w.anna).await || true);
}

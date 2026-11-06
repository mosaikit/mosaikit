//! The worker of the schedules: claim and lease, the gate on the rights of the author, the push to the
//! service (a fake one on the loopback), timeouts, failures and auto-pause, time zones, missed runs,
//! takeover and run-now. Run with `MOSAIKIT_TEST_BACKEND=sqlite` for SQLite.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Duration, Utc};
use mosaikit_kernel::plugins::tenants;
use mosaikit_kernel::schedule_worker as sw;
use mosaikit_kernel::schedules::{self as sc, CreateRequest};
use mosaikit_kernel::tenancy::keys::{self, Level};
use mosaikit_kernel::testing::{start_with, test_key, TestKernel};
use mosaikit_kernel::{run_tickets as rt, Caller, Kind};
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use uuid::Uuid;

const PLUGIN: &str = "com.test.schedrun";
const OTHER: &str = "com.test.schedrunother";

fn echo_wasm() -> Vec<u8> {
    wat::parse_str(
        r#"(module
  (memory (export "memory") 2)
  (data (i32.const 32768) "{\"ok\":null}")
  (global $bump (mut i32) (i32.const 65536))
  (func (export "msk_alloc") (param $len i32) (result i32)
    (local $p i32) (local.set $p (global.get $bump))
    (global.set $bump (i32.add (global.get $bump) (local.get $len))) (local.get $p))
  (func (export "msk_call") (param $ptr i32) (param $len i32) (result i64)
    (i64.or (i64.shl (i64.const 32768) (i64.const 32)) (i64.const 11)))
)"#,
    )
    .unwrap()
}

/// What the fake service saw: method, path, `Authorization`, body.
#[derive(Debug, Clone)]
struct Hit {
    method: String,
    path: String,
    auth: Option<String>,
    body: Value,
}

/// A service on the loopback: `POST /schedules/run` answers `push_status` (with a run id when 2xx and
/// `give_id`), `GET /schedules/runs/{id}` answers 200 with `{ "status": run_status }`.
struct Fake {
    port: u16,
    hits: Arc<Mutex<Vec<Hit>>>,
    push_status: Arc<Mutex<u16>>,
    give_id: Arc<Mutex<bool>>,
    run_status: Arc<Mutex<String>>,
}

impl Fake {
    async fn start() -> Fake {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let f = Fake {
            port,
            hits: Arc::default(),
            push_status: Arc::new(Mutex::new(202)),
            give_id: Arc::new(Mutex::new(true)),
            run_status: Arc::new(Mutex::new("running".into())),
        };
        let (hits, push, give, status) =
            (f.hits.clone(), f.push_status.clone(), f.give_id.clone(), f.run_status.clone());
        tokio::spawn(async move {
            let mut n = 0u32;
            loop {
                let Ok((mut s, _)) = listener.accept().await else { break };
                let (hits, push, give, status) = (hits.clone(), push.clone(), give.clone(), status.clone());
                n += 1;
                let n = n;
                tokio::spawn(async move {
                    let mut buf = Vec::new();
                    let mut chunk = [0u8; 4096];
                    let (head_end, len) = loop {
                        let r = s.read(&mut chunk).await.unwrap_or(0);
                        if r == 0 {
                            return;
                        }
                        buf.extend_from_slice(&chunk[..r]);
                        if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                            let head = String::from_utf8_lossy(&buf[..p]).to_lowercase();
                            let len = head
                                .lines()
                                .find_map(|l| l.strip_prefix("content-length:"))
                                .and_then(|v| v.trim().parse::<usize>().ok())
                                .unwrap_or(0);
                            break (p + 4, len);
                        }
                    };
                    while buf.len() < head_end + len {
                        let r = s.read(&mut chunk).await.unwrap_or(0);
                        if r == 0 {
                            break;
                        }
                        buf.extend_from_slice(&chunk[..r]);
                    }
                    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
                    let mut first = head.lines().next().unwrap_or("").split_whitespace();
                    let (method, path) =
                        (first.next().unwrap_or("").to_string(), first.next().unwrap_or("").to_string());
                    let auth = head
                        .lines()
                        .find(|l| l.to_lowercase().starts_with("authorization:"))
                        .map(|l| l.split_once(':').unwrap().1.trim().to_string());
                    let body: Value = serde_json::from_slice(&buf[head_end..]).unwrap_or(Value::Null);
                    hits.lock().unwrap().push(Hit { method: method.clone(), path: path.clone(), auth, body });
                    let (code, out) = if method == "POST" {
                        let code = *push.lock().unwrap();
                        let out = if (200..300).contains(&code) && *give.lock().unwrap() {
                            json!({ "run_id": format!("run-{n}") })
                        } else {
                            json!({})
                        };
                        (code, out)
                    } else {
                        (200, json!({ "status": status.lock().unwrap().clone() }))
                    };
                    let body = out.to_string();
                    let reply = format!(
                        "HTTP/1.1 {code} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = s.write_all(reply.as_bytes()).await;
                    let _ = s.shutdown().await;
                });
            }
        });
        f
    }

    fn hits(&self) -> Vec<Hit> {
        self.hits.lock().unwrap().clone()
    }

    fn posts(&self) -> Vec<Hit> {
        self.hits().into_iter().filter(|h| h.method == "POST").collect()
    }
}

fn toml(id: &str, port: u16, extra: &str) -> String {
    // an install with extra lines is a new version of the plugin
    let version = if extra.is_empty() { "1.0.0" } else { "1.0.1" };
    let targets = if id == PLUGIN { format!("run_targets = [\"{OTHER}\"]\n") } else { String::new() };
    format!(
        "id = \"{id}\"\nname = \"Sched\"\nversion = \"{version}\"\n[contribution]\nicon = \"x\"\nlabel = \"Sched\"\n\
         [requires]\nmosaikit = \">=1.0\"\n\
         [[resources]]\nname = \"items\"\nfields = [{{ key = \"title\", kind = \"text\" }}]\n\
         [[service_keys]]\nid = \"svc\"\nlabel = \"Service\"\n\
         [permissions]\nrun_commands = [\"x\"]\n{targets}network = [\"http://127.0.0.1:{port}\"]\n\
         [[schedules]]\nname = \"sync\"\ncommand = \"x\"\ntarget = \"http://127.0.0.1:{port}/schedules/run\"\n\
         service_key = \"svc\"\nmax_runtime_minutes = 20\n{extra}"
    )
}

async fn install(t: &TestKernel, id: &str, port: u16, extra: &str) {
    let mut files = BTreeMap::new();
    files.insert("plugin.toml".to_string(), toml(id, port, extra).into_bytes());
    files.insert("logic.wasm".to_string(), echo_wasm());
    let pkg = mosaikit_mskp::pack(&files, Some(&test_key())).unwrap();
    t.install_package(&pkg).await.unwrap();
}

struct World {
    t: TestKernel,
    fake: Fake,
    anna: Caller,
    bob: Caller,
    mgr: Caller,
}

async fn world() -> World {
    let fake = Fake::start().await;
    let t = start_with(|c| c.allow_private_fetch = true).await;
    install(&t, PLUGIN, fake.port, "").await;
    install(&t, OTHER, fake.port, "").await;
    let admin = t.admin().await;
    keys::set_key(&t, admin.user_id, Level::Platform, "svc", Some("secret-key"), Some(true)).await.unwrap();
    let alfa = t.tenant("alfa").await;
    let anna = t.member(&alfa, "anna").await;
    let bob = t.member(&alfa, "bob").await;
    let mgr = t.home(&alfa).await;
    let (anna, bob) = (t.home(&anna).await, t.home(&bob).await);
    World { t, fake, anna, bob, mgr }
}

fn req(cron: &str) -> CreateRequest {
    CreateRequest { plugin: PLUGIN.into(), name: "sync".into(), cron: cron.into(), ..Default::default() }
}

async fn make(w: &World, who: &Caller) -> Uuid {
    sc::create(&w.t, who, &req("*/15 * * * *")).await.unwrap().id
}

/// Makes a schedule due `ago` minutes ago.
async fn due(w: &World, id: Uuid, ago: i64) {
    mosaikit_db::query("update core.schedules set next_run_at = $2 where id = $1")
        .bind(id)
        .bind(Utc::now() - Duration::minutes(ago))
        .execute(&w.t.db)
        .await
        .unwrap();
}

async fn tick(w: &World) {
    sw::tick(&w.t.k).await.unwrap();
}

async fn sched(w: &World, id: Uuid) -> (String, Option<String>, Option<String>, i32, Option<DateTime<Utc>>) {
    let r = mosaikit_db::query(
        "select status, paused_reason, last_status, consecutive_failures, next_run_at from core.schedules where id = $1",
    )
    .bind(id)
    .fetch_one(&w.t.db)
    .await
    .unwrap();
    (r.get(0), r.get(1), r.get(2), r.get(3), r.get(4))
}

async fn runs(w: &World, id: Uuid) -> Vec<(String, Option<String>, Option<String>)> {
    mosaikit_db::query("select status, service_run_id, error from core.schedule_runs where schedule_id = $1 order by started_at")
        .bind(id)
        .fetch_all(&w.t.db)
        .await
        .unwrap()
        .iter()
        .map(|r| (r.get(0), r.get(1), r.get(2)))
        .collect()
}

async fn events(w: &World, action: &str) -> Vec<Value> {
    mosaikit_db::query_scalar("select detail from core.events where action = $1 order by id")
        .bind(action)
        .fetch_all(&w.t.db)
        .await
        .unwrap()
}

#[tokio::test]
async fn two_workers_never_claim_the_same_schedule() {
    let w = world().await;
    let mut ids = Vec::new();
    for _ in 0..3 {
        let id = make(&w, &w.anna).await;
        due(&w, id, 1).await;
        ids.push(id);
    }
    let notdue = make(&w, &w.bob).await;
    let (a, b) = tokio::join!(sw::claim(&w.t, 20), sw::claim(&w.t, 20));
    let mut got: Vec<Uuid> = a.unwrap().iter().chain(b.unwrap().iter()).map(|c| c.id).collect();
    got.sort();
    let mut want = ids.clone();
    want.sort();
    assert_eq!(got, want, "each due schedule is claimed once, by one of the two");
    assert!(!got.contains(&notdue));
    // the lease holds: nothing more to claim until it ends
    assert!(sw::claim(&w.t, 20).await.unwrap().is_empty());
    // a dead worker: the lease ends and the schedule can be claimed again
    mosaikit_db::query("update core.schedules set claimed_until = $2 where id = $1")
        .bind(ids[0])
        .bind(Utc::now() - Duration::minutes(1))
        .execute(&w.t.db)
        .await
        .unwrap();
    let again = sw::claim(&w.t, 20).await.unwrap();
    assert_eq!(again.iter().map(|c| c.id).collect::<Vec<_>>(), vec![ids[0]]);
}

#[tokio::test]
async fn a_due_schedule_is_pushed_with_a_ticket_and_its_result_is_read() {
    let w = world().await;
    let id = make(&w, &w.anna).await;
    due(&w, id, 1).await;
    tick(&w).await;

    let posts = w.fake.posts();
    assert_eq!(posts.len(), 1);
    let p = &posts[0];
    assert_eq!(p.path, "/schedules/run");
    assert_eq!(p.auth.as_deref(), Some("Bearer secret-key"));
    assert_eq!(p.body["tenant"], json!(w.anna.tenant.tenant_id));
    assert_eq!(p.body["user"], json!(w.anna.user.user_id));
    assert_eq!(p.body["schedule"], json!(id));
    assert_eq!(p.body["command"], "x");
    let token = p.body["ticket"].as_str().unwrap().to_string();
    assert_eq!(p.body["ticket_path"], format!("/api/run/{token}"));

    // the run is recorded with the id of the service; the schedule moved on and is leased
    let r = runs(&w, id).await;
    assert_eq!(r, vec![("running".to_string(), Some("run-1".to_string()), None)]);
    let (status, _, last, failures, next) = sched(&w, id).await;
    assert_eq!((status.as_str(), last.as_deref(), failures), ("active", Some("running"), 0));
    assert!(next.unwrap() > Utc::now());
    let lease: Option<DateTime<Utc>> =
        mosaikit_db::query_scalar("select claimed_until from core.schedules where id = $1")
            .bind(id)
            .fetch_one(&w.t.db)
            .await
            .unwrap();
    assert!(lease.unwrap() > Utc::now() + Duration::minutes(15));
    // the ticket belongs to the schedule, to the author, and only the run command works
    let row = mosaikit_db::query(
        "select user_id, schedule_id, commands from core.run_tickets where run_ref like 'schedule:sync:%'",
    )
    .fetch_one(&w.t.db)
    .await
    .unwrap();
    assert_eq!(row.get::<Uuid, _>(0), w.anna.user.user_id);
    assert_eq!(row.get::<Option<Uuid>, _>(1), Some(id));
    assert_eq!(row.get::<Value, _>(2), json!(["x"]));
    rt::call(&w.t, &token, PLUGIN, "x", json!({})).await.unwrap();
    assert_eq!(rt::call(&w.t, &token, OTHER, "x", json!({})).await.unwrap_err().code(), "run_wrong_plugin");
    assert_eq!(rt::call(&w.t, &token, PLUGIN, "y", json!({})).await.unwrap_err().code(), "run_wrong_command");

    // still running at the service: nothing changes
    tick(&w).await;
    assert_eq!(runs(&w, id).await[0].0, "running");
    assert!(w.fake.hits().iter().any(|h| h.method == "GET" && h.path == "/schedules/runs/run-1"));
    // no second run while it is in flight, even if the timetable says so
    due(&w, id, 1).await;
    tick(&w).await;
    assert_eq!(w.fake.posts().len(), 1);

    // done: the result is read, the ticket stops, the lease is released, the failures reset
    mosaikit_db::query("update core.schedules set consecutive_failures = 3 where id = $1")
        .bind(id)
        .execute(&w.t.db)
        .await
        .unwrap();
    *w.fake.run_status.lock().unwrap() = "succeeded".into();
    tick(&w).await;
    assert_eq!(runs(&w, id).await[0].0, "succeeded");
    let (_, _, last, failures, _) = sched(&w, id).await;
    assert_eq!((last.as_deref(), failures), (Some("succeeded"), 0));
    assert_eq!(
        rt::call(&w.t, &token, PLUGIN, "x", json!({})).await.unwrap_err().code(),
        "run_ticket_invalid"
    );
    assert_eq!(events(&w, "schedule.run").await.len(), 1);
}

#[tokio::test]
async fn without_a_run_id_the_run_ends_with_its_ticket() {
    let w = world().await;
    *w.fake.give_id.lock().unwrap() = false;
    let id = make(&w, &w.anna).await;
    let run = sc::run_now(&w.t, &w.anna, id).await.unwrap();
    assert_eq!(run.error, None);
    assert_eq!(
        (run.status.as_str(), run.started_by.as_str(), run.service_run_id.clone()),
        ("running", "manual", None)
    );
    let token = w.fake.posts()[0].body["ticket"].as_str().unwrap().to_string();
    tick(&w).await;
    assert_eq!(runs(&w, id).await[0].0, "running");
    rt::finish(&w.t, &token).await.unwrap();
    tick(&w).await;
    assert_eq!(runs(&w, id).await[0].0, "succeeded");
}

#[tokio::test]
async fn the_rights_of_the_author_are_checked_when_the_run_is_due() {
    let w = world().await;
    let (a, a2, b) = (make(&w, &w.anna).await, make(&w, &w.anna).await, make(&w, &w.bob).await);
    // lose the membership by a path that does not pause the schedules (the gate is the safety net)
    mosaikit_db::query("update core.memberships set status = 'suspended' where user_id = $1")
        .bind(w.anna.user.user_id)
        .execute(&w.t.db)
        .await
        .unwrap();
    for id in [a, a2, b] {
        due(&w, id, 1).await;
    }
    tick(&w).await;
    // anna: nothing sent, nothing minted, all her schedules paused; bob's one ran
    assert_eq!(w.fake.posts().len(), 1);
    assert_eq!(w.fake.posts()[0].body["user"], json!(w.bob.user.user_id));
    assert_eq!(sched(&w, a).await.0, "paused");
    assert_eq!(sched(&w, a).await.1.as_deref(), Some("author_inactive"));
    assert_eq!(sched(&w, a2).await.1.as_deref(), Some("author_inactive"));
    assert!(runs(&w, a).await.is_empty());
    assert_eq!(events(&w, "schedule.skipped").await.len(), 2);
    // the Tenant Manager is told
    let n: i64 = mosaikit_db::query_scalar(
        "select count(*) from core.notifications where user_id = $1 and data ->> 'code' = 'schedules_paused'",
    )
    .bind(w.mgr.user.user_id)
    .fetch_one(&w.t.db)
    .await
    .unwrap();
    assert_eq!(n, 1);
}

#[tokio::test]
async fn a_schedule_may_name_other_plugins_its_ticket_reaches() {
    let w = world().await;
    // the schedule names OTHER, which PLUGIN declares in run_targets: the same ticket calls both, as the author
    install(&w.t, PLUGIN, w.fake.port, &format!("targets = [\"{OTHER}\"]\n")).await;
    let id = make(&w, &w.anna).await;
    due(&w, id, 1).await;
    tick(&w).await;
    let p = &w.fake.posts()[0];
    assert_eq!(p.body["targets"], json!([OTHER]));
    let token = p.body["ticket"].as_str().unwrap().to_string();
    rt::call(&w.t, &token, PLUGIN, "x", json!({})).await.unwrap();
    let out = rt::call(&w.t, &token, OTHER, "x", json!({})).await;
    assert!(out.is_ok(), "{out:?}");
    assert_eq!(rt::call(&w.t, &token, OTHER, "y", json!({})).await.unwrap_err().code(), "run_wrong_command");
    // the entry of the ticket is the target's own run commands, no scope
    let targets: Value = mosaikit_db::query_scalar(
        "select targets from core.run_tickets where run_ref like 'schedule:sync:%'",
    )
    .fetch_one(&w.t.db)
    .await
    .unwrap();
    assert_eq!(targets, json!([{ "plugin": OTHER, "commands": ["x"] }]));
    let mints = events(&w, "run_ticket.mint").await;
    assert_eq!(mints[0]["targets"][0]["plugin"], OTHER);
}

#[tokio::test]
async fn a_target_the_author_can_no_longer_use_fails_the_run_instead_of_being_dropped() {
    let w = world().await;
    install(&w.t, PLUGIN, w.fake.port, &format!("targets = [\"{OTHER}\"]\n")).await;
    let id = make(&w, &w.anna).await;
    tenants::set_enabled(&w.t, &w.mgr, OTHER, false).await.unwrap();
    due(&w, id, 1).await;
    tick(&w).await;
    // nothing was pushed, no ticket exists, and the run says why
    assert!(w.fake.posts().is_empty());
    let r = runs(&w, id).await;
    assert_eq!(r[0].0, "failed", "{r:?}");
    assert!(r[0].2.as_deref().unwrap_or_default().contains(OTHER), "{r:?}");
    let n: i64 =
        mosaikit_db::query_scalar("select count(*) from core.run_tickets").fetch_one(&w.t.db).await.unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn a_plugin_that_is_off_pauses_the_schedule_with_its_own_reason() {
    let w = world().await;
    let id = make(&w, &w.anna).await;
    tenants::set_enabled(&w.t, &w.mgr, PLUGIN, false).await.unwrap();
    due(&w, id, 1).await;
    tick(&w).await;
    assert!(w.fake.posts().is_empty());
    assert_eq!(sched(&w, id).await.1.as_deref(), Some("plugin_off"));
}

#[tokio::test]
async fn a_run_past_its_deadline_is_timed_out() {
    let w = world().await;
    let id = make(&w, &w.anna).await;
    due(&w, id, 1).await;
    tick(&w).await;
    let token = w.fake.posts()[0].body["ticket"].as_str().unwrap().to_string();
    // the declaration says 20 minutes: that is the deadline (never more than 60)
    let (started, deadline): (DateTime<Utc>, DateTime<Utc>) =
        mosaikit_db::query("select started_at, deadline_at from core.schedule_runs where schedule_id = $1")
            .bind(id)
            .fetch_one(&w.t.db)
            .await
            .map(|r| (r.get(0), r.get(1)))
            .unwrap();
    assert!((1195..=1205).contains(&(deadline - started).num_seconds()));
    mosaikit_db::query("update core.schedule_runs set deadline_at = $2 where schedule_id = $1")
        .bind(id)
        .bind(Utc::now() - Duration::seconds(5))
        .execute(&w.t.db)
        .await
        .unwrap();
    tick(&w).await;
    let r = runs(&w, id).await;
    assert_eq!(r[0].0, "timed_out");
    assert!(r[0].2.as_deref().unwrap().contains("20 minutes"));
    let (_, _, last, failures, next) = sched(&w, id).await;
    assert_eq!((last.as_deref(), failures), (Some("timed_out"), 1));
    // the retry comes before the timetable (5 minutes after a first failure)
    assert!(next.unwrap() < Utc::now() + Duration::minutes(6));
    assert_eq!(
        rt::call(&w.t, &token, PLUGIN, "x", json!({})).await.unwrap_err().code(),
        "run_ticket_invalid"
    );
}

#[tokio::test]
async fn five_failures_in_a_row_pause_the_schedule_and_tell_the_author() {
    let w = world().await;
    *w.fake.push_status.lock().unwrap() = 500;
    let id = make(&w, &w.anna).await;
    for n in 1..=5 {
        due(&w, id, 1).await;
        tick(&w).await;
        let (status, reason, last, failures, next) = sched(&w, id).await;
        assert_eq!((last.as_deref(), failures), (Some("failed"), n));
        if n < 5 {
            assert_eq!(status, "active", "failure {n}");
            // backoff: 5, 10, 20, 40 minutes (or the timetable if sooner: every 15 here)
            let wait = (next.unwrap() - Utc::now()).num_minutes();
            let want = sw::retry_delay_minutes(n).min(15);
            assert!(wait <= want, "failure {n}: retry in {wait} minutes, wanted at most {want}");
        } else {
            assert_eq!((status.as_str(), reason.as_deref()), ("paused", Some("failures")));
        }
    }
    assert_eq!(w.fake.posts().len(), 5);
    assert!(runs(&w, id)
        .await
        .iter()
        .all(|r| r.0 == "failed" && r.2.as_deref() == Some("the service answered 500")));
    assert_eq!(events(&w, "schedule.paused").await.len(), 1);
    let n: i64 = mosaikit_db::query_scalar(
        "select count(*) from core.notifications where user_id = $1 and data ->> 'code' = 'schedule_paused_failures'",
    )
    .bind(w.anna.user.user_id)
    .fetch_one(&w.t.db)
    .await
    .unwrap();
    assert_eq!(n, 1);
    // paused: it does not run any more
    due(&w, id, 1).await;
    tick(&w).await;
    assert_eq!(w.fake.posts().len(), 5);
    // the key never reaches the log
    let all: Vec<Value> =
        mosaikit_db::query_scalar("select detail from core.events").fetch_all(&w.t.db).await.unwrap();
    assert!(!serde_json::to_string(&all).unwrap().contains("secret-key"));
}

#[tokio::test]
async fn a_late_schedule_skips_its_missed_runs_unless_it_catches_up_once() {
    let w = world().await;
    let skip = make(&w, &w.anna).await;
    let mut r = req("*/15 * * * *");
    r.catch_up_once = true;
    let catch = sc::create(&w.t, &w.bob, &r).await.unwrap().id;
    for id in [skip, catch] {
        due(&w, id, 180).await;
    }
    tick(&w).await;
    // skipped: no run, the timetable moved on
    let (status, _, last, _, next) = sched(&w, skip).await;
    assert_eq!((status.as_str(), last.as_deref()), ("active", Some("missed")));
    assert!(next.unwrap() > Utc::now());
    assert!(runs(&w, skip).await.is_empty());
    assert_eq!(events(&w, "schedule.missed").await.len(), 1);
    // caught up: one run only, however many were missed
    assert_eq!(runs(&w, catch).await.len(), 1);
    assert_eq!(w.fake.posts().len(), 1);
    assert!(sched(&w, catch).await.4.unwrap() > Utc::now());
    // a little late (the kernel was busy) still runs
    let ok = sc::create(&w.t, &w.mgr, &req("*/15 * * * *")).await.unwrap().id;
    due(&w, ok, 1).await;
    tick(&w).await;
    assert_eq!(runs(&w, ok).await.len(), 1);
}

#[tokio::test]
async fn the_time_zone_of_a_schedule_is_validated_and_used() {
    let w = world().await;
    let mut r = req("0 3 * * *");
    r.time_zone = Some("Europe/Rome".into());
    let made = sc::create(&w.t, &w.anna, &r).await.unwrap();
    let local = made.next_run_at.with_timezone(&chrono_tz::Europe::Rome);
    assert_eq!(chrono::Timelike::hour(&local), 3);
    let listed = sc::list(&w.t, &w.anna, None).await.unwrap();
    assert_eq!(listed[0].time_zone, "Europe/Rome");
    // no zone: UTC (tenants have none yet)
    let utc = sc::create(&w.t, &w.bob, &req("0 3 * * *")).await.unwrap();
    assert_eq!(chrono::Timelike::hour(&utc.next_run_at), 3);
    assert_eq!(sc::list(&w.t, &w.bob, None).await.unwrap()[0].time_zone, "UTC");
    for bad in ["Mars/Base", "CEST", "Europe/Rome; drop", "+02:00"] {
        let mut r = req("0 3 * * *");
        r.time_zone = Some(bad.into());
        let e = sc::create(&w.t, &w.anna, &r).await.unwrap_err();
        assert_eq!((e.kind, e.code()), (Kind::BadRequest, "bad_time_zone"), "{bad}");
    }
}

#[tokio::test]
async fn a_tenant_manager_takes_a_schedule_over_and_it_runs_as_them() {
    let w = world().await;
    let id = make(&w, &w.anna).await;
    // the author leaves: paused, and the manager is told
    mosaikit_db::query("update core.users set status = 'disabled' where id = $1")
        .bind(w.anna.user.user_id)
        .execute(&w.t.db)
        .await
        .unwrap();
    due(&w, id, 1).await;
    tick(&w).await;
    assert_eq!(sched(&w, id).await.1.as_deref(), Some("author_inactive"));
    // not by a person who is neither author nor manager (404), not by the author who is no manager (403)
    assert_eq!(sc::take_over(&w.t, &w.bob, id).await.unwrap_err().kind, Kind::NotFound);
    let bobs = make(&w, &w.bob).await;
    assert_eq!(sc::take_over(&w.t, &w.bob, bobs).await.unwrap_err().code(), "manager_only");
    // the manager takes it
    sc::take_over(&w.t, &w.mgr, id).await.unwrap();
    assert_eq!(sched(&w, id).await.0, "active");
    let ev = events(&w, "schedule.takeover").await;
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0]["from"], json!(w.anna.user.user_id));
    assert_eq!(ev[0]["to"], json!(w.mgr.user.user_id));
    assert_eq!(sc::take_over(&w.t, &w.mgr, id).await.unwrap_err().code(), "already_yours");
    due(&w, id, 1).await;
    tick(&w).await;
    let post = w.fake.posts().into_iter().last().unwrap();
    assert_eq!(post.body["user"], json!(w.mgr.user.user_id));
    let uid: Uuid = mosaikit_db::query_scalar("select user_id from core.run_tickets where schedule_id = $1")
        .bind(id)
        .fetch_one(&w.t.db)
        .await
        .unwrap();
    assert_eq!(uid, w.mgr.user.user_id);
}

#[tokio::test]
async fn run_now_goes_through_the_same_gate_and_never_overlaps() {
    let w = world().await;
    let id = make(&w, &w.anna).await;
    // somebody else is not told it exists
    assert_eq!(sc::run_now(&w.t, &w.bob, id).await.unwrap_err().kind, Kind::NotFound);
    let run = sc::run_now(&w.t, &w.anna, id).await.unwrap();
    assert_eq!(run.started_by, "manual");
    assert_eq!(w.fake.posts().len(), 1);
    // the timetable is untouched
    let (_, _, _, _, next) = sched(&w, id).await;
    assert!(next.unwrap() > Utc::now());
    // one run at a time
    assert_eq!(sc::run_now(&w.t, &w.mgr, id).await.unwrap_err().code(), "already_running");
    assert_eq!(sc::runs(&w.t, &w.anna, id).await.unwrap().len(), 1);
    assert_eq!(sc::runs(&w.t, &w.bob, id).await.unwrap_err().kind, Kind::NotFound);
    // paused: no
    let other = make(&w, &w.anna).await;
    sc::pause(&w.t, &w.anna, other).await.unwrap();
    assert_eq!(sc::run_now(&w.t, &w.anna, other).await.unwrap_err().code(), "schedule_paused");
    // a failed push is a failure, shown in the run
    *w.fake.push_status.lock().unwrap() = 503;
    let third = make(&w, &w.bob).await;
    let r = sc::run_now(&w.t, &w.bob, third).await.unwrap();
    assert_eq!((r.status.as_str(), r.error.as_deref()), ("failed", Some("the service answered 503")));
    assert_eq!(sched(&w, third).await.3, 1);
    // the author lost the right: refused and paused
    mosaikit_db::query("update core.memberships set status = 'suspended' where user_id = $1")
        .bind(w.bob.user.user_id)
        .execute(&w.t.db)
        .await
        .unwrap();
    let again = make_unchecked(&w, third).await;
    assert_eq!(sc::run_now(&w.t, &w.mgr, again).await.unwrap_err().code(), "author_inactive");
    // a ticket cannot run a schedule
    let mut c = w.anna.clone();
    c.run = Some(mosaikit_kernel::RunCall {
        ticket: Uuid::new_v4(),
        run_ref: "r".into(),
        resources: None,
        scheduled_by: None,
        schedule_name: None,
    });
    assert!(sc::run_now(&w.t, &c, id).await.is_err());
}

/// Makes the schedule claimable again (no lease, active) so that a second run-now can be tried.
async fn make_unchecked(w: &World, id: Uuid) -> Uuid {
    mosaikit_db::query("update core.schedules set claimed_until = null, status = 'active', paused_reason = null where id = $1")
        .bind(id)
        .execute(&w.t.db)
        .await
        .unwrap();
    id
}

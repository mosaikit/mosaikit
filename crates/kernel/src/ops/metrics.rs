//! Lightweight metrics of the requests: counted in memory by the server, one snapshot per minute in
//! `core.metrics` (kept 8 days), read by the Monitoring pages and the alerts. Optional text export in the
//! Prometheus format (`/metrics`, docs/architecture.md).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::{Kernel, Result};

/// Latencies kept per minute (a uniform sample beyond).
const SAMPLE: usize = 2000;
/// Tenants counted per minute.
const TENANTS: usize = 1000;
/// Snapshots kept.
pub const KEEP_DAYS: i64 = 8;

#[derive(Default)]
pub(crate) struct Window {
    pub requests: u64,
    pub errors: u64,
    pub latencies: Vec<f64>,
    seen: u64,
    pub tenants: HashMap<String, u64>,
}

/// Counters of the current minute and totals since the start (for `/metrics`).
#[derive(Default)]
pub struct Metrics {
    window: Mutex<Window>,
    total_requests: AtomicU64,
    total_errors: AtomicU64,
}

impl Metrics {
    /// One request answered with `status` in `ms` milliseconds, for the tenant `slug` if any.
    pub fn record(&self, ms: f64, status: u16, tenant: Option<&str>) {
        self.total_requests.fetch_add(1, Ordering::Relaxed);
        if status >= 500 {
            self.total_errors.fetch_add(1, Ordering::Relaxed);
        }
        let mut w = self.window.lock().expect("metrics");
        w.requests += 1;
        if status >= 500 {
            w.errors += 1;
        }
        w.seen += 1;
        if w.latencies.len() < SAMPLE {
            w.latencies.push(ms);
        } else {
            let j = (rand::random::<u64>() % w.seen) as usize;
            if j < SAMPLE {
                w.latencies[j] = ms;
            }
        }
        if let Some(t) = tenant {
            if w.tenants.len() < TENANTS || w.tenants.contains_key(t) {
                *w.tenants.entry(t.to_string()).or_default() += 1;
            }
        }
    }

    pub(crate) fn take(&self) -> Window {
        std::mem::take(&mut *self.window.lock().expect("metrics"))
    }

    pub fn totals(&self) -> (u64, u64) {
        (self.total_requests.load(Ordering::Relaxed), self.total_errors.load(Ordering::Relaxed))
    }
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let i = ((sorted.len() - 1) as f64 * p).round() as usize;
    sorted[i.min(sorted.len() - 1)]
}

/// Time of a trivial query, in milliseconds.
pub(crate) async fn db_ping(k: &Kernel) -> Result<f64> {
    let t = Instant::now();
    let _: i64 = mosaikit_db::query_scalar("select 1::bigint").fetch_one(&k.db).await?;
    Ok(t.elapsed().as_secs_f64() * 1000.0)
}

/// Queues of the emails: (waiting, failed in the last 24 hours).
pub(crate) async fn mail_queue(k: &Kernel) -> Result<(i64, i64)> {
    let r = mosaikit_db::query(
        "select (select count(*) from core.mail_outbox where status in ('pending', 'sending')),
                (select count(*) from core.mail_outbox where status = 'failed' and created_at > $1)",
    )
    .bind(Utc::now() - Duration::days(1))
    .fetch_one(&k.db)
    .await?;
    Ok((r.get(0), r.get(1)))
}

/// Writes the snapshot of the last minute and forgets the old ones.
pub async fn snapshot(k: &Kernel) -> Result<()> {
    let mut w = k.ops.metrics.take();
    w.latencies.sort_by(|a, b| a.total_cmp(b));
    let db_ms = db_ping(k).await?;
    let now = Utc::now();
    let sessions: i64 = mosaikit_db::query_scalar("select count(*) from core.sessions where expires_at > $1")
        .bind(now)
        .fetch_one(&k.db)
        .await?;
    let (pending, failed) = mail_queue(k).await?;
    let tenants: Map<String, Value> = w.tenants.into_iter().map(|(t, n)| (t, json!(n))).collect();
    mosaikit_db::query(
        "insert into core.metrics (ts, requests, errors, p50_ms, p95_ms, p99_ms, sessions, mail_pending, mail_failed, db_ms, tenants)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    )
    .bind(now)
    .bind(w.requests as i64)
    .bind(w.errors as i64)
    .bind(percentile(&w.latencies, 0.5))
    .bind(percentile(&w.latencies, 0.95))
    .bind(percentile(&w.latencies, 0.99))
    .bind(sessions as i32)
    .bind(pending as i32)
    .bind(failed as i32)
    .bind(db_ms)
    .bind(Value::Object(tenants))
    .execute(&k.db)
    .await?;
    mosaikit_db::query("delete from core.metrics where ts < $1")
        .bind(now - Duration::days(KEEP_DAYS))
        .execute(&k.db)
        .await?;
    Ok(())
}

/// One point of the charts: a minute or the aggregate of several.
#[derive(Debug, Clone, Serialize, Default)]
pub struct Point {
    pub ts: DateTime<Utc>,
    pub requests: i64,
    pub errors: i64,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub p99_ms: f64,
    pub sessions: i64,
    pub mail_pending: i64,
    pub db_ms: f64,
}

/// Length of a period of the Monitoring pages and the size of its buckets.
pub fn period(p: &str) -> (Duration, Duration) {
    match p {
        "7d" => (Duration::days(7), Duration::hours(2)),
        "12h" => (Duration::hours(12), Duration::minutes(10)),
        _ => (Duration::hours(1), Duration::minutes(1)),
    }
}

/// The points of a period, aggregated in buckets (latencies weighted by the requests; sessions and
/// queues as their maximum).
pub async fn series(k: &Kernel, p: &str) -> Result<Vec<Point>> {
    let (len, bucket) = period(p);
    let since = Utc::now() - len;
    let rows = mosaikit_db::query(
        "select ts, requests, errors, p50_ms, p95_ms, p99_ms, sessions, mail_pending, db_ms
         from core.metrics where ts >= $1 order by ts",
    )
    .bind(since)
    .fetch_all(&k.db)
    .await?;
    let step = bucket.num_seconds().max(60);
    let mut out: Vec<Point> = Vec::new();
    let mut weight: Vec<f64> = Vec::new();
    for r in rows {
        let ts: DateTime<Utc> = r.get(0);
        let slot = since + Duration::seconds((ts - since).num_seconds() / step * step);
        let (req, err): (i64, i64) = (r.get(1), r.get(2));
        let w = req.max(1) as f64;
        if out.last().map(|p| p.ts) != Some(slot) {
            out.push(Point { ts: slot, ..Point::default() });
            weight.push(0.0);
        }
        let (p, total) = (out.last_mut().expect("point"), weight.last_mut().expect("weight"));
        let mix = |a: f64, b: f64| (a * *total + b * w) / (*total + w);
        p.p50_ms = mix(p.p50_ms, r.get(3));
        p.p95_ms = mix(p.p95_ms, r.get(4));
        p.p99_ms = mix(p.p99_ms, r.get(5));
        p.db_ms = mix(p.db_ms, r.get(8));
        *total += w;
        p.requests += req;
        p.errors += err;
        p.sessions = p.sessions.max(r.get::<i32, _>(6) as i64);
        p.mail_pending = p.mail_pending.max(r.get::<i32, _>(7) as i64);
    }
    Ok(out)
}

/// Requests per tenant (slug) in a period.
pub async fn requests_by_tenant(k: &Kernel, since: DateTime<Utc>) -> Result<HashMap<String, i64>> {
    let rows: Vec<Value> = mosaikit_db::query_scalar("select tenants from core.metrics where ts >= $1")
        .bind(since)
        .fetch_all(&k.db)
        .await?;
    let mut out: HashMap<String, i64> = HashMap::new();
    for v in rows {
        if let Value::Object(m) = v {
            for (t, n) in m {
                *out.entry(t).or_default() += n.as_i64().unwrap_or(0);
            }
        }
    }
    Ok(out)
}

/// Text in the Prometheus format: totals since the start and the state of the last minute.
pub async fn prometheus(k: &Kernel) -> Result<String> {
    let (req, err) = k.ops.metrics.totals();
    let last = series(k, "1h").await?.pop().unwrap_or_default();
    let (pending, failed) = mail_queue(k).await?;
    let mut s = String::new();
    let mut add = |name: &str, help: &str, kind: &str, v: String| {
        s.push_str(&format!("# HELP {name} {help}\n# TYPE {name} {kind}\n{name} {v}\n"));
    };
    add("mosaikit_requests_total", "Requests answered since the start.", "counter", req.to_string());
    add(
        "mosaikit_errors_total",
        "Requests answered with a server error since the start.",
        "counter",
        err.to_string(),
    );
    add(
        "mosaikit_latency_p95_ms",
        "95th percentile of the latency in the last minute.",
        "gauge",
        format!("{:.1}", last.p95_ms),
    );
    add("mosaikit_sessions", "Open sessions.", "gauge", last.sessions.to_string());
    add("mosaikit_mail_pending", "Emails waiting to be sent.", "gauge", pending.to_string());
    add("mosaikit_mail_failed_24h", "Emails failed in the last 24 hours.", "gauge", failed.to_string());
    add(
        "mosaikit_db_ping_ms",
        "Time of a trivial query to the database.",
        "gauge",
        format!("{:.2}", last.db_ms),
    );
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentiles_and_window() {
        let m = Metrics::default();
        for i in 1..=100 {
            m.record(i as f64, if i % 10 == 0 { 500 } else { 200 }, Some("alfa"));
        }
        let mut w = m.take();
        w.latencies.sort_by(|a, b| a.total_cmp(b));
        assert_eq!((w.requests, w.errors), (100, 10));
        assert_eq!(w.tenants["alfa"], 100);
        assert_eq!(percentile(&w.latencies, 0.5), 51.0);
        assert_eq!(percentile(&w.latencies, 0.99), 99.0);
        assert_eq!(m.take().requests, 0, "the window starts again");
        assert_eq!(m.totals(), (100, 10));
    }
}

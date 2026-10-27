//! Operations of the platform (Administrator): metrics, monitoring and alerts, backups, maintenance mode,
//! and the background work that runs them (docs/architecture.md, "Operations").

pub mod backup;
pub mod backup_item;
pub mod maintenance;
pub mod metrics;
pub mod monitor;

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration as StdDuration, Instant};

use chrono::{DateTime, Utc};

use crate::Kernel;

/// When, error code (`None`: delivered) and detail of the last delivery to the mail server.
pub(crate) type MailResult = (DateTime<Utc>, Option<&'static str>, String);

/// State of the operations kept by the kernel.
pub struct Ops {
    pub metrics: metrics::Metrics,
    /// last run of each background job ("mail", "ops")
    ticks: Mutex<HashMap<&'static str, DateTime<Utc>>>,
    pub(crate) maintenance: Mutex<Option<(Instant, maintenance::Maintenance)>>,
    pub(crate) providers: Mutex<Option<(Instant, Vec<monitor::Service>)>>,
    /// the last attempt to hand a message to the mail server: when, error code (`None`: delivered), detail
    pub(crate) mail_last: Mutex<Option<MailResult>>,
    /// reachability of the mail server, checked at most every minute
    pub(crate) mail_probe: Mutex<Option<(Instant, monitor::Service)>>,
    pub backup_running: AtomicBool,
    pub(crate) started: Instant,
}

impl Default for Ops {
    fn default() -> Ops {
        Ops {
            metrics: metrics::Metrics::default(),
            ticks: Mutex::new(HashMap::new()),
            maintenance: Mutex::new(None),
            providers: Mutex::new(None),
            mail_last: Mutex::new(None),
            mail_probe: Mutex::new(None),
            backup_running: AtomicBool::new(false),
            started: Instant::now(),
        }
    }
}

impl Ops {
    /// Records the outcome of a delivery to the mail server (monitoring shows it).
    pub(crate) fn mail_result(&self, err: Option<&crate::Error>) {
        let v = (Utc::now(), err.map(|e| e.code()), err.map(|e| e.message.clone()).unwrap_or_default());
        *self.mail_last.lock().expect("mail_last") = Some(v);
        // the next look at Monitoring checks the server again
        *self.mail_probe.lock().expect("mail_probe") = None;
    }

    pub(crate) fn tick(&self, job: &'static str) {
        self.ticks.lock().expect("ticks").insert(job, Utc::now());
    }

    pub fn ticks(&self) -> HashMap<&'static str, DateTime<Utc>> {
        self.ticks.lock().expect("ticks").clone()
    }

    /// Time since the start of the kernel.
    pub fn uptime(&self) -> StdDuration {
        self.started.elapsed()
    }
}

/// The background work of the operations: every minute the snapshot of the metrics, the alerts, the
/// planned maintenance and the scheduled backup; every 10 minutes the trial periods. Stops with the kernel.
pub(crate) fn spawn_worker(k: &Arc<Kernel>) {
    let weak: Weak<Kernel> = Arc::downgrade(k);
    tokio::spawn(async move {
        if let Some(k) = weak.upgrade() {
            if let Err(e) = backup::recover(&k).await {
                tracing::warn!("backups interrupted: {e}");
            }
        }
        let mut minute: u64 = 0;
        loop {
            tokio::time::sleep(StdDuration::from_secs(60)).await;
            let Some(k) = weak.upgrade() else { break };
            k.ops.tick("ops");
            if let Err(e) = metrics::snapshot(&k).await {
                tracing::warn!("snapshot of the metrics: {e}");
            }
            if let Err(e) = monitor::check_alerts(&k).await {
                tracing::warn!("alerts: {e}");
            }
            if let Err(e) = maintenance::start_planned(&k).await {
                tracing::warn!("planned maintenance: {e}");
            }
            if minute.is_multiple_of(10) {
                if let Err(e) = crate::tenancy::lifecycle::check_trials(&k).await {
                    tracing::warn!("trial periods: {e}");
                }
            }
            if !k.ops.backup_running.load(std::sync::atomic::Ordering::SeqCst) {
                let k2 = k.clone();
                tokio::spawn(async move {
                    if let Err(e) = backup::scheduled(&k2).await {
                        tracing::warn!("scheduled backup: {e}");
                    }
                });
            }
            minute += 1;
        }
    });
}

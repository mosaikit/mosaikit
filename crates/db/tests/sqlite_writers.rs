//! SQLite with concurrent writers: they wait for their turn instead of failing with "database is
//! locked" when SQLite's busy timeout runs out, and readers do not wait for them.

use std::sync::Arc;
use std::time::{Duration, Instant};

use mosaikit_db::{query, query_scalar, Db};

async fn db(dir: &tempfile::TempDir, busy_ms: u64) -> Arc<Db> {
    // a busy timeout far shorter than the time the writers need all together
    let db = Db::open_sqlite_with_busy_timeout(&dir.path().join("t.db"), 8, Duration::from_millis(busy_ms))
        .await
        .unwrap();
    query("insert into core.tenants (slug, name) values ('alfa', 'alfa')").execute(&db).await.unwrap();
    Arc::new(db)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_writers_wait_for_their_turn() {
    let dir = tempfile::tempdir().unwrap();
    let db = db(&dir, 50).await;
    // 24 transactions that each hold the write lock for 40 ms: about a second in all, twenty times the
    // busy timeout; without the queue most of them would fail with "database is locked"
    let mut tasks = Vec::new();
    for i in 0..24 {
        let db = db.clone();
        tasks.push(tokio::spawn(async move {
            let mut tx = db.begin_app().await?;
            query("insert into core.tenants (slug, name) values ($1, $1)")
                .bind(format!("t{i:02}"))
                .execute(&mut *tx)
                .await?;
            tokio::time::sleep(Duration::from_millis(40)).await;
            tx.commit().await
        }));
    }
    // and writes outside a transaction at the same time
    for i in 0..8 {
        let db = db.clone();
        tasks.push(tokio::spawn(async move {
            query("insert into core.tenants (slug, name) values ($1, $1)")
                .bind(format!("a{i:02}"))
                .execute(&*db)
                .await
                .map(|_| ())
        }));
    }
    for t in tasks {
        t.await.unwrap().expect("a writer failed");
    }
    let n: i64 = query_scalar("select count(*) from core.tenants").fetch_one(&*db).await.unwrap();
    assert_eq!(n, 1 + 24 + 8);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn readers_do_not_wait_for_the_writer() {
    let dir = tempfile::tempdir().unwrap();
    let db = db(&dir, 50).await;
    let ctx = mosaikit_db::Ctx::default();
    // a writer holds the lock for half a second
    let w = db.clone();
    let writer = tokio::spawn(async move {
        let mut tx = w.begin_app().await.unwrap();
        query("insert into core.tenants (slug, name) values ('beta', 'beta')")
            .execute(&mut *tx)
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(500)).await;
        tx.commit().await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    // a read transaction starts and reads at once, seeing what was committed before the writer
    let t = Instant::now();
    let mut tx = db.begin_read(&ctx).await.unwrap();
    let n: i64 = query_scalar("select count(*) from core.tenants").fetch_one(&mut *tx).await.unwrap();
    assert_eq!(n, 1);
    tx.commit().await.unwrap();
    assert!(t.elapsed() < Duration::from_millis(300), "the reader waited {:?}", t.elapsed());
    writer.await.unwrap();
}

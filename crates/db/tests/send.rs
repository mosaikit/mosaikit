//! Le future del crate devono essere `Send` (usate dai gestori HTTP).

use std::sync::Arc;

use mosaikit_db::{query, Ctx, Db, PluginSchema};

#[allow(dead_code)]
fn send<F: std::future::Future + Send + 'static>(_: F) {}

#[allow(dead_code)]
fn checks(db: Arc<Db>, ps: Arc<PluginSchema>) {
    let (d, p) = (db.clone(), ps.clone());
    send(async move {
        let mut tx = d.begin_app().await.unwrap();
        p.provision(&mut tx, "x").await?;
        p.thaw(&mut tx).await?;
        p.run_as_plugin(&mut tx, &[]).await?;
        p.freeze(&mut tx).await?;
        PluginSchema::drop(&p, &mut tx).await
    });
    let d = db.clone();
    send(async move {
        let mut tx = d.begin_plugin("x", &Ctx::default()).await.unwrap();
        query("select 1").execute(&mut *tx).await?;
        tx.create_resource("a", "b", None, &serde_json::json!({})).await?;
        tx.plugin_sql("select 1", true, true, &[]).await?;
        tx.commit().await
    });
    send(async move { query("select 1").fetch_all(&*db).await.map(|_| ()) });
}

//! REST and SSE API of the real-time channels of the plugins (docs/realtime-design.md): the stream of a channel, the
//! messages and the presence state. The kernel (`mosaikit_kernel::realtime`) decides who may do what.

use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::StreamExt;
use mosaikit_kernel::realtime::{self, Frame, Subscription};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

use crate::api::{ok, uuid};
use crate::auth::Tenant;
use crate::{bad, ApiResult, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/t/{t}/p/{plugin}/rt/{resource}/{name}/stream", get(stream))
        .route("/api/t/{t}/p/{plugin}/rt/{resource}/{name}", post(send))
        .route("/api/t/{t}/p/{plugin}/rt/{resource}/{name}/state", post(state))
}

#[derive(Deserialize)]
struct Chan {
    #[allow(dead_code)]
    t: String,
    plugin: String,
    resource: String,
    name: String,
}

#[derive(Deserialize)]
struct StreamQuery {
    /// the presence state of the person, a JSON object (at most 1 KB)
    #[serde(default)]
    state: Option<String>,
}

#[derive(Deserialize)]
struct Send {
    data: Value,
    #[serde(default)]
    to: Option<String>,
}

#[derive(Deserialize)]
struct State_ {
    state: Value,
}

fn event(f: &Frame) -> Event {
    Event::default().id(f.seq.to_string()).event(f.kind).data(serde_json::to_string(f).unwrap_or_default())
}

/// What a listener starts from: who is there, then the messages it missed (and a `gap` when some are gone).
fn first(sub: &Subscription) -> Vec<Event> {
    let mut out = vec![Event::default()
        .event("presence")
        .id(sub.seq().to_string())
        .data(json!({ "people": sub.people, "me": sub.me }).to_string())];
    if sub.gap {
        out.push(Event::default().event("gap").data("{}"));
    }
    out.extend(sub.replay.iter().map(|f| event(f)));
    out
}

async fn stream(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<Chan>,
    Query(q): Query<StreamQuery>,
    headers: HeaderMap,
) -> ApiResult<Response> {
    let resource = uuid(&p.resource)?;
    let state = match q.state.as_deref().filter(|v| !v.is_empty()) {
        Some(v) => serde_json::from_str::<Value>(v).map_err(|_| bad("the state is not JSON"))?,
        None => json!({}),
    };
    let last = headers.get("last-event-id").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok());
    let sub = realtime::subscribe(&s.k, &c, &p.plugin, resource, &p.name, last, state).await?;
    let head = first(&sub);
    let (plugin, name) = (p.plugin.clone(), p.name.clone());
    let k = s.k.clone();
    let mut tick = tokio::time::interval(realtime::RECHECK);
    tick.tick().await;
    // the stream owns the subscription: when the client goes, or the stream ends, the person leaves the channel
    let live = futures_util::stream::unfold((sub, tick, c, false), move |(mut sub, mut tick, c, closing)| {
        let (k, plugin, name) = (k.clone(), plugin.clone(), name.clone());
        async move {
            // after the `closed` event the stream ends
            if closing {
                return None;
            }
            loop {
                tokio::select! {
                    r = sub.recv() => match r {
                        Ok(f) => return Some((event(&f), (sub, tick, c, false))),
                        // this client was too slow and lost messages: it must catch up from its own copy of the state
                        Err(RecvError::Lagged(_)) => return Some((Event::default().event("gap").data("{}"), (sub, tick, c, false))),
                        Err(RecvError::Closed) => return None,
                    },
                    _ = tick.tick() => {
                        // the person may have logged out, been removed from the resource or lost the right to read it
                        if !realtime::session_open(&k, &c).await
                            || realtime::authorize(&k, &c, &plugin, resource, &name, mosaikit_kernel::acl::Level::Read).await.is_err()
                        {
                            return Some((Event::default().event("closed").data("{}"), (sub, tick, c, true)));
                        }
                    }
                }
            }
        }
    });
    let body = futures_util::stream::iter(head).chain(live).map(Ok::<_, std::convert::Infallible>);
    Ok(Sse::new(body).keep_alive(KeepAlive::default()).into_response())
}

async fn send(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<Chan>,
    Json(r): Json<Send>,
) -> ApiResult<Json<Value>> {
    let resource = uuid(&p.resource)?;
    let to =
        r.to.as_deref()
            .filter(|v| !v.is_empty())
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| bad("invalid recipient"))?;
    let seq = realtime::publish(&s.k, &c, &p.plugin, resource, &p.name, r.data, to).await?;
    Ok(Json(json!({ "seq": seq })))
}

async fn state(
    State(s): State<AppState>,
    Tenant(c): Tenant,
    Path(p): Path<Chan>,
    Json(r): Json<State_>,
) -> ApiResult<Json<Value>> {
    realtime::set_state(&s.k, &c, &p.plugin, uuid(&p.resource)?, &p.name, r.state).await?;
    Ok(ok())
}

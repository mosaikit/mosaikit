//! Real-time channels for plugins (docs/realtime-design.md): ephemeral messages and presence between the people who may
//! see a resource. A channel is `(tenant, plugin, resource, name)`; who may listen and send is decided by the access rule
//! of the resource (read to listen, write to send), the plugin must declare `[permissions] realtime`. Nothing is stored:
//! a small ring buffer lets a client that reconnects catch up, durable data stays in the data of the plugin.
//!
//! The fan-out is in the process (one server, and the SQLite desktop). Several servers on PostgreSQL need the relay of
//! the design note (§4), which is not built yet: until then a channel only reaches the people connected to the same
//! server.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::acl::Level;
use crate::{Caller, Error, Kernel, Kind, Result};

/// Largest `data` of a message, serialized (16 KB).
pub const MAX_MESSAGE: usize = 16 * 1024;
/// Largest presence `state` of a person, serialized.
pub const MAX_STATE: usize = 1024;
/// Messages kept for a client that reconnects.
const RING: usize = 200;
/// How long a message is kept for a client that reconnects.
const RING_AGE: Duration = Duration::from_secs(60);
/// Messages a person may send per second in a channel.
pub const PER_SECOND: u32 = 30;
/// Channels a person may listen to at the same time.
pub const MAX_OPEN_PER_USER: usize = 20;
/// People (connections) on a channel.
pub const MAX_LISTENERS: usize = 500;
/// How often an open stream asks again whether the person may still listen.
pub const RECHECK: Duration = Duration::from_secs(30);

/// Who a frame comes from: the kernel sets it, never the body of the request.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Person {
    pub id: Uuid,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<Value>,
}

/// What a listener receives. `kind` is `message`, `join`, `leave` or `state`.
#[derive(Debug, Clone, Serialize)]
pub struct Frame {
    pub seq: u64,
    pub kind: &'static str,
    pub from: Person,
    pub data: Value,
    /// set: only this person receives it (signalling); never sent to the others
    #[serde(skip)]
    pub to: Option<Uuid>,
}

impl Frame {
    /// Whether `user` receives the frame.
    pub fn is_for(&self, user: Uuid) -> bool {
        self.to.is_none_or(|t| t == user || self.from.id == user)
    }
}

struct Entry {
    name: String,
    state: Value,
    conns: usize,
    /// presence channel only: the status of each tab (`true` = available); the person is available if any tab is
    tabs: HashMap<String, bool>,
}

/// The state of a person on the presence channel given the status of their tabs.
fn aggregate(tabs: &HashMap<String, bool>) -> Value {
    serde_json::json!({ "status": if tabs.values().any(|a| *a) { "available" } else { "away" } })
}

#[derive(Default)]
struct Inner {
    seq: u64,
    ring: VecDeque<(Instant, Arc<Frame>)>,
    people: HashMap<Uuid, Entry>,
    conns: usize,
}

struct Channel {
    tx: broadcast::Sender<Arc<Frame>>,
    inner: Mutex<Inner>,
}

type Key = (Uuid, Uuid, String, String);

/// The channels of the server.
#[derive(Default)]
pub struct Hub {
    chans: Mutex<HashMap<Key, Arc<Channel>>>,
    opens: Mutex<HashMap<Uuid, usize>>,
}

fn bad(code: &'static str, m: &str) -> Error {
    Error::bad(m).with_code(code)
}

/// A name of a channel: 1 to 64 characters of `a-z 0-9 _ - .`.
pub fn valid_name(n: &str) -> bool {
    !n.is_empty()
        && n.len() <= 64
        && n.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'_' | b'-' | b'.'))
}

fn size(v: &Value) -> usize {
    serde_json::to_vec(v).map(|b| b.len()).unwrap_or(usize::MAX)
}

fn person_of(c: &Caller, state: Option<Value>) -> Person {
    let name =
        if c.user.display_name.is_empty() { c.user.username.clone() } else { c.user.display_name.clone() };
    Person { id: c.user.user_id, name, state }
}

impl Hub {
    fn channel(&self, key: &Key) -> Arc<Channel> {
        let mut m = self.chans.lock().expect("lock channels");
        m.entry(key.clone())
            .or_insert_with(|| {
                Arc::new(Channel { tx: broadcast::channel(256).0, inner: Mutex::new(Inner::default()) })
            })
            .clone()
    }

    /// Removes the channel when nobody is on it any more.
    fn tidy(&self, key: &Key) {
        let mut m = self.chans.lock().expect("lock channels");
        if let Some(ch) = m.get(key) {
            let empty = ch.inner.lock().expect("lock channel").conns == 0;
            if empty && ch.tx.receiver_count() == 0 {
                m.remove(key);
            }
        }
    }

    /// Number of channels alive (tests and the usage page).
    pub fn channels(&self) -> usize {
        self.chans.lock().expect("lock channels").len()
    }
}

fn push(ch: &Channel, kind: &'static str, from: Person, data: Value, to: Option<Uuid>) -> Arc<Frame> {
    let mut g = ch.inner.lock().expect("lock channel");
    g.seq += 1;
    let f = Arc::new(Frame { seq: g.seq, kind, from, data, to });
    let now = Instant::now();
    g.ring.push_back((now, f.clone()));
    while g.ring.len() > RING || g.ring.front().is_some_and(|(t, _)| now.duration_since(*t) > RING_AGE) {
        g.ring.pop_front();
    }
    // sent inside the lock: the order of the frames is the order of the sequence
    let _ = ch.tx.send(f.clone());
    f
}

/// Checks that `c` may use the channel: the plugin is on, declares `realtime`, the resource is the plugin's and
/// visible to the caller with at least `need`.
pub async fn authorize(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
    resource: Uuid,
    name: &str,
    need: Level,
) -> Result<()> {
    if !valid_name(name) {
        return Err(bad("rt_name", "the name of a channel is 1 to 64 characters of a-z 0-9 _ - ."));
    }
    if c.run.is_some() {
        return Err(Error::forbidden("real-time channels are not available in a call on behalf of a run")
            .with_code("permission_denied"));
    }
    let (p, _perms) = crate::access::plugin_for(k, c, plugin).await?;
    if !p.manifest.permissions.realtime {
        return Err(Error::forbidden("the plugin does not declare `realtime` in [permissions]")
            .with_code("permission_denied"));
    }
    let m = crate::acl::meta(k, c, resource).await?;
    if m.plugin_id != plugin {
        return Err(Error::not_found("resource not found"));
    }
    if m.level < need {
        return Err(Error::forbidden("access denied").with_code("rt_forbidden"));
    }
    Ok(())
}

/// Whether the session of `c` is still open.
pub async fn session_open(k: &Kernel, c: &Caller) -> bool {
    mosaikit_db::query_scalar::<i64>(
        "select count(*) from core.sessions where token_hash = $1 and expires_at > now()",
    )
    .bind(c.user.token_hash.clone())
    .fetch_one(&k.db)
    .await
    .map(|n| n > 0)
    .unwrap_or(false)
}

/// A person listening to a channel. Dropping it leaves the channel (and tells the others).
pub struct Subscription {
    pub rx: broadcast::Receiver<Arc<Frame>>,
    /// the people on the channel when this one joined
    pub people: Vec<Person>,
    /// messages the client missed, oldest first (those it may see)
    pub replay: Vec<Arc<Frame>>,
    /// the client asked to resume but part of what it missed is gone
    pub gap: bool,
    pub me: Uuid,
    /// the `join` frame of this very connection: the person has the list of people, so it is not sent to them
    own_join: Option<u64>,
    guard: Guard,
}

impl Subscription {
    /// The next frame this person receives: not the ones addressed to someone else, not their own arrival.
    /// `Lagged` means the listener did not keep up and lost frames.
    pub async fn recv(&mut self) -> std::result::Result<Arc<Frame>, broadcast::error::RecvError> {
        loop {
            let f = self.rx.recv().await?;
            if f.is_for(self.me) && Some(f.seq) != self.own_join {
                return Ok(f);
            }
        }
    }

    /// The sequence number of the last frame of the channel when the client joined.
    pub fn seq(&self) -> u64 {
        self.guard.ch.inner.lock().expect("lock channel").seq
    }
}

struct Guard {
    k: Arc<Kernel>,
    key: Key,
    ch: Arc<Channel>,
    who: Person,
    counted: bool,
    tab: Option<String>,
}

impl Drop for Guard {
    fn drop(&mut self) {
        let mut changed = None;
        let gone = {
            let mut g = self.ch.inner.lock().expect("lock channel");
            g.conns = g.conns.saturating_sub(1);
            match g.people.get_mut(&self.who.id) {
                Some(e) if e.conns > 1 => {
                    e.conns -= 1;
                    if let Some(t) = &self.tab {
                        e.tabs.remove(t);
                        let now = aggregate(&e.tabs);
                        if now != e.state {
                            e.state = now.clone();
                            changed = Some(now);
                        }
                    }
                    false
                }
                Some(_) => {
                    g.people.remove(&self.who.id);
                    true
                }
                None => false,
            }
        };
        if let Some(now) = changed {
            push(&self.ch, "state", Person { state: Some(now), ..self.who.clone() }, Value::Null, None);
        }
        if gone {
            push(&self.ch, "leave", Person { state: None, ..self.who.clone() }, Value::Null, None);
        }
        if self.counted {
            let mut o = self.k.rt.opens.lock().expect("lock opens");
            if let Some(n) = o.get_mut(&self.who.id) {
                *n = n.saturating_sub(1);
                if *n == 0 {
                    o.remove(&self.who.id);
                }
            }
        }
        self.k.rt.tidy(&self.key);
    }
}

/// Starts listening: checks the right to read, joins the presence with `state` and returns what the stream starts from.
/// `last_seq` is the `Last-Event-ID` of a client that reconnects.
pub async fn subscribe(
    k: &Arc<Kernel>,
    c: &Caller,
    plugin: &str,
    resource: Uuid,
    name: &str,
    last_seq: Option<u64>,
    state: Value,
) -> Result<Subscription> {
    authorize(k, c, plugin, resource, name, Level::Read).await?;
    if size(&state) > MAX_STATE {
        return Err(bad("rt_too_large", "the state is too large"));
    }
    let key: Key = (c.tenant.tenant_id, resource, plugin.to_string(), name.to_string());
    join(k, c, key, last_seq, state, MAX_LISTENERS, true, None)
}

/// Joins the channel `key` (the right to do so is already checked). `counted`: the connection counts against
/// `MAX_OPEN_PER_USER`; `max` is the largest number of connections of the channel.
#[allow(clippy::too_many_arguments)]
fn join(
    k: &Arc<Kernel>,
    c: &Caller,
    key: Key,
    last_seq: Option<u64>,
    state: Value,
    max: usize,
    counted: bool,
    tab: Option<&str>,
) -> Result<Subscription> {
    let me = c.user.user_id;
    if counted {
        let mut o = k.rt.opens.lock().expect("lock opens");
        let n = o.entry(me).or_insert(0);
        if *n >= MAX_OPEN_PER_USER {
            return Err(Error::new(Kind::TooMany, "too many open channels").with_code("rt_rate"));
        }
        *n += 1;
    }
    let ch = k.rt.channel(&key);
    let who = person_of(c, None);
    let (rx, joined, state, changed, people, replay, gap) = {
        let mut g = ch.inner.lock().expect("lock channel");
        if g.conns >= max {
            drop(g);
            if counted {
                let mut o = k.rt.opens.lock().expect("lock opens");
                if let Some(n) = o.get_mut(&me) {
                    *n = n.saturating_sub(1);
                }
            }
            k.rt.tidy(&key);
            return Err(Error::new(Kind::TooMany, "too many people on this channel").with_code("rt_rate"));
        }
        g.conns += 1;
        let rx = ch.tx.subscribe();
        let mut state = state;
        let mut changed = false;
        let joined = match g.people.get_mut(&me) {
            Some(e) => {
                e.conns += 1;
                match tab {
                    // presence: the person is available if any tab is
                    Some(t) => {
                        e.tabs.insert(
                            t.to_string(),
                            state.get("status").and_then(Value::as_str) == Some("available"),
                        );
                        state = aggregate(&e.tabs);
                        changed = state != e.state;
                        e.state = state.clone();
                    }
                    // the newest tab sets the state
                    None => e.state = state.clone(),
                }
                false
            }
            None => {
                let tabs = tab
                    .map(|t| {
                        HashMap::from([(
                            t.to_string(),
                            state.get("status").and_then(Value::as_str) == Some("available"),
                        )])
                    })
                    .unwrap_or_default();
                g.people.insert(me, Entry { name: who.name.clone(), state: state.clone(), conns: 1, tabs });
                true
            }
        };
        let people: Vec<Person> = g
            .people
            .iter()
            .map(|(id, e)| Person { id: *id, name: e.name.clone(), state: Some(e.state.clone()) })
            .collect();
        let oldest = g.ring.front().map(|(_, f)| f.seq);
        let replay: Vec<Arc<Frame>> = match last_seq {
            Some(last) => g
                .ring
                .iter()
                .filter(|(_, f)| f.seq > last && f.kind == "message" && f.is_for(me))
                .map(|(_, f)| f.clone())
                .collect(),
            None => Vec::new(),
        };
        let gap = last_seq.is_some_and(|last| last < g.seq && oldest.is_none_or(|o| o > last + 1));
        (rx, joined, state, changed, people, replay, gap)
    };
    if changed {
        push(&ch, "state", Person { state: Some(state.clone()), ..who.clone() }, Value::Null, None);
    }
    let own_join = joined
        .then(|| push(&ch, "join", Person { state: Some(state), ..who.clone() }, Value::Null, None).seq);
    Ok(Subscription {
        rx,
        people,
        replay,
        gap,
        me,
        own_join,
        guard: Guard { k: k.clone(), key, ch, who, counted, tab: tab.map(String::from) },
    })
}

/// Sends a message to the channel (to one person with `to`): needs the right to write. Returns its sequence number.
pub async fn publish(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
    resource: Uuid,
    name: &str,
    data: Value,
    to: Option<Uuid>,
) -> Result<u64> {
    authorize(k, c, plugin, resource, name, Level::Write).await?;
    if size(&data) > MAX_MESSAGE {
        return Err(bad("rt_too_large", "the message is too large (16 KB at most)"));
    }
    if !k.limiter.hit(&format!("rt:{}:{resource}:{name}", c.user.user_id), PER_SECOND, Duration::from_secs(1))
    {
        return Err(Error::new(Kind::TooMany, "too many messages: slow down").with_code("rt_rate"));
    }
    let key: Key = (c.tenant.tenant_id, resource, plugin.to_string(), name.to_string());
    let ch = k.rt.channel(&key);
    let f = push(&ch, "message", person_of(c, None), data, to);
    k.rt.tidy(&key);
    Ok(f.seq)
}

/// Sets the presence state of the caller (typing, cursor, muted): the person must be listening to the channel.
pub async fn set_state(
    k: &Kernel,
    c: &Caller,
    plugin: &str,
    resource: Uuid,
    name: &str,
    state: Value,
) -> Result<()> {
    authorize(k, c, plugin, resource, name, Level::Read).await?;
    if size(&state) > MAX_STATE {
        return Err(bad("rt_too_large", "the state is too large"));
    }
    if !k.limiter.hit(&format!("rt:{}:{resource}:{name}", c.user.user_id), PER_SECOND, Duration::from_secs(1))
    {
        return Err(Error::new(Kind::TooMany, "too many messages: slow down").with_code("rt_rate"));
    }
    let key: Key = (c.tenant.tenant_id, resource, plugin.to_string(), name.to_string());
    let ch = k.rt.channel(&key);
    let who = person_of(c, Some(state.clone()));
    {
        let mut g = ch.inner.lock().expect("lock channel");
        match g.people.get_mut(&c.user.user_id) {
            Some(e) => e.state = state,
            None => {
                drop(g);
                k.rt.tidy(&key);
                return Err(bad("rt_not_connected", "listen to the channel first"));
            }
        }
    }
    push(&ch, "state", who, Value::Null, None);
    Ok(())
}

// ------------------------------------------------------------------------------------------------------ platform presence

/// Largest number of connections (tabs) on the presence channel of a tenant.
pub const MAX_PRESENCE: usize = 5000;
/// Version of the presence protocol (the `v` of the stream); grows only when a field changes meaning.
pub const PRESENCE_VERSION: u32 = 1;

/// Reserved channel of the platform: the people of a tenant that have the shell open. It is `(tenant, nil, "_kernel",
/// "presence")`: no plugin can reach it (the name of a plugin cannot start with `_`, and the plugin routes check the
/// resource), and nothing is stored.
fn presence_key(c: &Caller) -> Key {
    (c.tenant.tenant_id, Uuid::nil(), "_kernel".to_string(), "presence".to_string())
}

/// The state of a person on the presence channel: `{"status": "available" | "away"}` and nothing else.
pub fn presence_state(v: &Value) -> Result<Value> {
    match v.get("status").and_then(Value::as_str) {
        Some(s @ ("available" | "away")) => Ok(serde_json::json!({ "status": s })),
        _ => Err(bad("presence_state", "the status is `available` or `away`")),
    }
}

/// A person with the shell open starts to be seen as online by the other members of the tenant. A person with several
/// tabs is one entry (the state of the newest tab; the clients send the state of the whole browser). When the last
/// connection goes, the others receive `leave`.
pub fn subscribe_presence(k: &Arc<Kernel>, c: &Caller, tab: &str, state: &Value) -> Result<Subscription> {
    if c.run.is_some() {
        return Err(Error::forbidden("presence is not available in a call on behalf of a run")
            .with_code("permission_denied"));
    }
    if !valid_name(tab) {
        return Err(bad("rt_name", "the tab is 1 to 64 characters of a-z 0-9 _ - ."));
    }
    let state = presence_state(state)?;
    join(k, c, presence_key(c), None, state, MAX_PRESENCE, false, Some(tab))
}

/// Changes the presence state of the caller (away, back): the caller must have the stream open.
pub fn set_presence(k: &Kernel, c: &Caller, tab: &str, state: &Value) -> Result<()> {
    if !valid_name(tab) {
        return Err(bad("rt_name", "the tab is 1 to 64 characters of a-z 0-9 _ - ."));
    }
    let state = presence_state(state)?;
    if !k.limiter.hit(&format!("presence:{}", c.user.user_id), 20, Duration::from_secs(10)) {
        return Err(Error::new(Kind::TooMany, "too many changes: slow down").with_code("rt_rate"));
    }
    let key = presence_key(c);
    let ch = k.rt.channel(&key);
    let mut who = person_of(c, Some(state.clone()));
    {
        let mut g = ch.inner.lock().expect("lock channel");
        match g.people.get_mut(&c.user.user_id) {
            Some(e) if e.tabs.contains_key(tab) => {
                e.tabs.insert(
                    tab.to_string(),
                    state.get("status").and_then(Value::as_str) == Some("available"),
                );
                let now = aggregate(&e.tabs);
                if now == e.state {
                    return Ok(());
                }
                e.state = now;
                who.state = Some(e.state.clone());
            }
            _ => {
                drop(g);
                k.rt.tidy(&key);
                return Err(bad("rt_not_connected", "open the presence stream first"));
            }
        }
    }
    push(&ch, "state", who, Value::Null, None);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert!(valid_name("chat"));
        assert!(valid_name("doc.1_a-b"));
        assert!(!valid_name(""));
        assert!(!valid_name("Chat"));
        assert!(!valid_name("a/b"));
        assert!(!valid_name(&"a".repeat(65)));
    }

    fn ch() -> Channel {
        Channel { tx: broadcast::channel(16).0, inner: Mutex::new(Inner::default()) }
    }
    fn who(n: u128) -> Person {
        Person { id: Uuid::from_u128(n), name: format!("p{n}"), state: None }
    }

    #[test]
    fn sequence_and_ring() {
        let c = ch();
        let mut rx = c.tx.subscribe();
        for i in 0..(RING + 10) {
            push(&c, "message", who(1), serde_json::json!(i), None);
        }
        let g = c.inner.lock().unwrap();
        assert_eq!(g.seq as usize, RING + 10);
        assert_eq!(g.ring.len(), RING);
        assert_eq!(g.ring.front().unwrap().1.seq, 11);
        drop(g);
        // a listener that does not keep up is told it lost frames (the stream turns this into a `gap`)
        assert!(matches!(rx.try_recv(), Err(broadcast::error::TryRecvError::Lagged(_))));
    }

    #[test]
    fn direct_frames_are_for_the_recipient_and_the_sender() {
        let f =
            Frame { seq: 1, kind: "message", from: who(1), data: Value::Null, to: Some(Uuid::from_u128(2)) };
        assert!(f.is_for(Uuid::from_u128(2)));
        assert!(f.is_for(Uuid::from_u128(1)));
        assert!(!f.is_for(Uuid::from_u128(3)));
        let all = Frame { to: None, ..f };
        assert!(all.is_for(Uuid::from_u128(3)));
    }

    #[test]
    fn presence_state_is_closed() {
        assert_eq!(
            presence_state(&serde_json::json!({"status": "away", "x": 1})).unwrap(),
            serde_json::json!({"status": "away"})
        );
        assert!(presence_state(&serde_json::json!({"status": "busy"})).is_err());
        assert!(presence_state(&serde_json::json!({})).is_err());
        assert!(presence_state(&Value::Null).is_err());
    }

    #[test]
    fn size_is_the_serialized_one() {
        assert_eq!(size(&serde_json::json!({"a": 1})), 7);
        assert!(size(&Value::String("x".repeat(MAX_MESSAGE))) > MAX_MESSAGE);
    }
}

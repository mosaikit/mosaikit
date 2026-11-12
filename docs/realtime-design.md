# Mosaikit — Design note: real-time channels for plugins

Status: approved 2026-11-11 (SSE + POST; channels bound to a resource; no storage; TURN credentials only with phase 7 option B). Built: routes, in-process fan-out, presence, limits, host and package (architecture §8.18). Not built: the PostgreSQL relay (§4), `rt.publish` from the logic. Phase 5 of [plugins-plan.md](plugins-plan.md). 

## 1. What and why

Chat, calls (signalling) and live co-editing need to push small messages to the people who are looking at the
same thing, within a second. Today the kernel has no such service: presence is only data a plugin writes
(architecture §8, «the kernel has no real-time service»). The kernel already pushes to the bell with
server-sent events (`GET /api/me/stream`, `crates/server/src/api.rs`, an in-process `broadcast` channel); this
note generalises that pattern to plugins.

The service is **generic and domain-agnostic**: ephemeral messages between the people who may see a resource.
It stores nothing: durable data (chat history, document snapshots) stays in the data of the plugin.

## 2. Model

- A **channel** is `(tenant, plugin, resource, name)`. It is bound to a resource of the plugin, so the access rule
  is the one that exists: `core.can_access(resource, read)` to listen, `write` to send. A public link has no
  channel. No resource, no channel: there are no free-floating topics.
- A **message** is JSON, at most 16 KB, with the sender (id, name) added by the kernel and a sequence number
  per channel. Messages are not stored; a ring buffer of the last 200 messages or 60 seconds lets a client that
  reconnects with `Last-Event-ID` catch up, and tells it (`gap`) when it cannot.
- **Presence** is kernel-kept and in memory: who is connected to the channel, with a plugin-defined JSON
  `state` (≤ 1 KB, cursor, typing, muted). Events `join`, `leave`, `state`; a client that stops sending
  heartbeats (25 s) is dropped after 60 s. A person with two tabs counts once.
- **Direct messages** inside a channel: `to: <user id>` delivers to one person only (WebRTC signalling:
  offer, answer, candidate). The media never goes through the server.

## 3. Transport: SSE + POST (recommended) or WebSocket

| | SSE + POST | WebSocket |
|---|---|---|
| Reuse | same session cookie, same CSRF and rate-limit layers, same pattern as `/api/me/stream` | new upgrade path, new auth and limit code |
| Proxies and desktop | plain HTTP, works behind every proxy | some proxies break upgrades |
| Cost | one POST per message | one socket |
| Fit | chat, presence, signalling, document updates (≤ 16 KB) | same, a little lower latency |

Recommendation: **SSE for receiving, `POST` for sending**. A WebSocket can replace it later behind the same plugin
API without a change to the plugins.

```
GET  /api/t/{t}/plugins/{plugin}/rt/{resource}/{name}/stream   text/event-stream, Last-Event-ID, ?state=<json>
POST /api/t/{t}/plugins/{plugin}/rt/{resource}/{name}          { "data": {...}, "to": "<user id>"? }
POST /api/t/{t}/plugins/{plugin}/rt/{resource}/{name}/state    { "state": {...} }   (presence, also the heartbeat)
```

## 4. Fan-out

- One process (SQLite desktop, a single server): an in-process `tokio::sync::broadcast` per channel, created on
  the first listener and dropped with the last.
- Several servers on PostgreSQL: `pg_notify` on one channel per tenant (payload limit 8000 bytes: messages over
  the limit are sent as a pointer to a row of a small unlogged table `rt_overflow`, deleted after 60 s) and a
  `LISTEN` task per server. Presence is rebuilt from the heartbeats each server sees.
- No new durable table. `rt_overflow` is `unlogged` and exists only on PostgreSQL.

## 5. Plugin side

Manifest (additive key of API 1, sensitive, shown in «What it asks»; needs `[requires] mosaikit = ">=1.0"`):

```toml
[permissions]
realtime = true
```

Bridge and package (`@mosaikit/plugin-api`, additive, no version bump):

```ts
const ch = msk.realtime.open({ resource, name: 'chat' , state: { typing: false } })
ch.onMessage((m) => ...)        // { seq, from: {id, name}, data }
ch.onPresence((people) => ...)  // [{ id, name, state }]
ch.onStatus((s) => ...)         // 'connecting' | 'live' | 'reconnecting' | 'gap'
await ch.send(data, { to })     // errors: rt_forbidden, rt_too_large, rt_rate
ch.setState({ typing: true })
ch.close()
```

The host holds the `EventSource` (the plugin iframe has no origin of its own) and relays by `postMessage`; one
connection per (channel, tab) however many frames ask for it. Logic (WASM) can publish with a host operation
`rt.publish` (server-side events: «a ticket changed»), never listen.

## 6. Limits and safety

- 16 KB per message, 30 messages per second per person per channel, 20 open channels per person, 500 listeners
  per channel; quotas in `usage` (messages sent, connections) like the other platform quotas.
- Closes at once when the session ends, the person is suspended or removed from the resource, the tenant is
  suspended or the plugin is turned off (the same events that already stop a plugin).
- The message is delivered as data, never interpreted by the host; the sender is set by the kernel, never taken
  from the body.
- Audit log: connection opened/closed per channel (not message contents).

## 7. Compatibility (the four rules of plugins-plan §4b)

1. Additive: new routes, a new manifest key, a new bridge operation. Nothing that exists changes its meaning;
   `[[public_commands]]` is untouched.
2. No bump of plugin API 1; entries in the CHANGELOGs of `@mosaikit/plugin-api` and `mosaikit-plugin-sdk`.
3. No kernel migration on SQLite; on PostgreSQL one additive `unlogged` table.
4. `cargo xtask --dist ../geoportal test` passes before the merge; Geoportal does not declare `realtime`, so it
   sees no difference.

## 8. WebRTC support (for phase 7, option B)

Only the signalling above plus a setting `rtc.ice_servers` (STUN/TURN list, tenant and platform level, with the
usual inheritance: «with a limit» is not needed) exposed to plugins through `msk.realtime.iceServers()`. Credentials
of a TURN server are short-lived (REST API of coturn) and minted by the kernel per person.

## 9. Work

| Step | Effort |
|---|---|
| Routes, in-process fan-out, presence, limits, ACL, tests (HTTP, kernel) | 5 d |
| PostgreSQL fan-out (`LISTEN/NOTIFY`, overflow), SQLite path, tests on both | 3 d |
| Manifest key, bridge in the host, `msk.realtime` in the package, tests | 3 d |
| Usage, audit, documentation (architecture §8, guide), manual checks | 1 d |
| **Total** | **12 d** |

## 10. Decisions (taken 2026-11-11)

1. SSE + POST (recommended) or WebSocket?
2. Channels only bound to a resource (recommended) or also free names per tenant?
3. No message storage in the kernel (recommended), or a short retention (for example 5 minutes) for late joiners?
4. TURN credentials in phase 5, or only when phase 7 option B starts?

Answers: 1 SSE + POST. 2 Only bound to a resource. 3 No storage in the kernel. 4 TURN credentials only when phase 7 option B starts.

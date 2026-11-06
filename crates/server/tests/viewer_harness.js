// Runs the script of the public viewer page (crates/server/src/pages.rs) against a fake DOM and a fake fetch, and prints
// what it did as JSON. Used by `public_embed_over_http` in http.rs. Arguments: script file, plugin origin.
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const PO = process.argv[3];
const replies = [];
const fetches = [];
let listener = null;
const frameWindow = { postMessage: (x, o) => replies.push({ msg: x, origin: o }) };
let next = { ok: true, status: 200, body: { ok: { url: 'U', expires_at: 'E', resource: 'R' } } };
global.document = { getElementById: () => ({ contentWindow: frameWindow }) };
global.window = { addEventListener: (_t, f) => (listener = f) };
global.fetch = async (u, o) => {
  fetches.push({ url: u, method: o && o.method, type: o && o.headers && o.headers['content-type'], body: o && o.body });
  const n = next;
  return { ok: n.ok, status: n.status, json: async () => n.body };
};
eval(src);

async function send(data, opts) {
  const o = opts || {};
  const before = replies.length;
  listener({ source: o.source === undefined ? frameWindow : o.source, origin: o.origin || PO, data });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  return replies.slice(before).map((r) => ({ ...r.msg, _origin: r.origin }));
}

(async () => {
  const out = {};
  const args = { plugin: 'com.x.maps', name: 'map', resource: 'R1', extra: 'dropped' };
  out.ok = await send({ msk: 1, id: 7, op: 'embed.url', args });
  out.fetchedOk = fetches.slice();
  fetches.length = 0;
  next = { ok: false, status: 403, body: { error: 'refused', code: 'permission_denied' } };
  out.refused = await send({ msk: 1, id: 8, op: 'embed.url', args });
  next = { ok: true, status: 200, body: { ok: 1 } };
  fetches.length = 0;
  out.wrongOrigin = await send({ msk: 1, id: 9, op: 'embed.url', args }, { origin: 'https://evil.example' });
  out.wrongSource = await send({ msk: 1, id: 10, op: 'embed.url', args }, { source: {} });
  out.noEnvelope = await send({ id: 11, op: 'embed.url', args });
  out.fetchedIgnored = fetches.slice();
  out.unknown = await send({ msk: 1, id: 12, op: 'plugin.call', args: {} });
  out.mint = await send({ msk: 1, id: 13, op: 'runs.mint', args: {} });
  out.noArgs = await send({ msk: 1, id: 14, op: 'embed.url' });
  console.log(JSON.stringify(out));
})();

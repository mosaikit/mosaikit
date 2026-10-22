//! Minimal HTML pages of the untrusted origin (public links).

pub fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

const STYLE: &str = "
  :root { color-scheme: light dark; --bg:#f6f4ef; --fg:#1d1b17; --dim:#6b665c; --line:#ddd7cb; --acc:#b9781a; --panel:#fff; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b0c0f; --fg:#ece7db; --dim:#8f887a; --line:#2a2e37; --acc:#f0b23e; --panel:#14161b; } }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--fg); }
  main { max-width: 880px; margin: 0 auto; padding: 32px 16px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: var(--dim); font-size: 13px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--dim); font-weight: 600; width: 30%; }
  a { color: var(--acc); }
  form { display: flex; gap: 8px; flex-wrap: wrap; }
  input { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--fg); }
  button { font: inherit; padding: 8px 14px; border: 0; border-radius: 8px; background: var(--acc); color: #221806; font-weight: 600; cursor: pointer; }
  .err { color: #d0453f; margin-top: 10px; }
  pre { white-space: pre-wrap; margin: 0; font: inherit; }
  footer { margin-top: 28px; color: var(--dim); font-size: 12px; }
";

pub fn page(title: &str, body: &str) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
         <meta name=\"robots\" content=\"noindex\"><title>{}</title><style>{STYLE}</style></head>\
         <body><main>{body}<footer>Shared with Mosaikit</footer></main></body></html>",
        esc(title)
    )
}

pub fn not_found() -> String {
    page("Link not available", "<h1>Link not available</h1><p class=\"sub\">The link does not exist, has expired or has been revoked.</p>")
}

pub fn password(title: &str, wrong: bool) -> String {
    let err = if wrong { "<p class=\"err\">Wrong password.</p>" } else { "" };
    page(
        title,
        &format!(
            "<h1>Protected content</h1><p class=\"sub\">Enter the password you received with the link.</p>\
             <form method=\"post\" action=\"unlock\"><input type=\"password\" name=\"password\" autofocus \
             required aria-label=\"Password\"><button type=\"submit\">Open</button></form>{err}"
        ),
    )
}

pub fn record(title: &str, plugin: &str, fields: &[(String, String)]) -> String {
    let rows: String = fields
        .iter()
        .map(|(k, v)| format!("<tr><th>{}</th><td><pre>{}</pre></td></tr>", esc(k), esc(v)))
        .collect();
    page(title, &format!("<h1>{}</h1><p class=\"sub\">{}</p><table>{rows}</table>", esc(title), esc(plugin)))
}

pub fn folder(title: &str, items: &[(String, String, String, i64)]) -> String {
    let rows: String = if items.is_empty() {
        "<tr><td>Empty folder</td></tr>".into()
    } else {
        items
            .iter()
            .map(|(href, name, kind, size)| {
                let icon = if kind == "folder" { "📁" } else { "📄" };
                let size = if kind == "folder" { String::new() } else { human(*size) };
                format!("<tr><td>{icon} <a href=\"{}\">{}</a></td><td>{size}</td></tr>", esc(href), esc(name))
            })
            .collect()
    };
    page(
        title,
        &format!(
            "<h1>📁 {}</h1><p class=\"sub\">Shared folder (read only)</p><table>{rows}</table>",
            esc(title)
        ),
    )
}

fn human(n: i64) -> String {
    let n = n as f64;
    if n < 1024.0 {
        format!("{n} B")
    } else if n < 1024.0 * 1024.0 {
        format!("{:.1} KB", n / 1024.0)
    } else {
        format!("{:.1} MB", n / 1024.0 / 1024.0)
    }
}

/// Page that embeds the public viewer of the plugin and answers it via postMessage.
pub fn viewer(title: &str, frame_src: &str, plugin_origin: &str, nonce: &str) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"robots\" content=\"noindex\">\
         <title>{t}</title><style>html,body{{margin:0;height:100%;background:#0b0c0f}}iframe{{border:0;width:100%;height:100%;display:block}}</style>\
         </head><body><iframe id=\"v\" title=\"{t}\" src=\"{src}\" \
         sandbox=\"allow-scripts allow-same-origin allow-popups allow-forms allow-downloads\" allow=\"fullscreen; geolocation\"></iframe>\
         <script nonce=\"{nonce}\">\
         (function(){{var f=document.getElementById('v');var PO={po};\
         window.addEventListener('message',function(ev){{\
           if(ev.source!==f.contentWindow||ev.origin!==PO)return;var m=ev.data;if(!m||m.msk!==1||!m.id)return;\
           function reply(x){{x.msk=1;x.id=m.id;f.contentWindow.postMessage(x,PO);}}\
           if(m.op==='hello'||m.op==='public.get'){{fetch('api',{{cache:'no-store'}}).then(function(r){{return r.json();}})\
             .then(function(j){{reply({{ok:m.op==='hello'?{{public:true,resource:j}}:j}});}},function(e){{reply({{err:String(e)}});}});return;}}\
           reply({{err:'operation not available in a public link'}});\
         }});}})();</script></body></html>",
        t = esc(title),
        src = esc(frame_src),
        po = serde_json::to_string(plugin_origin).unwrap_or_default(),
    )
}

// Mosaikit plugin UI — File Manager (modello GeoLibre: codice trusted).
// Storage = VFS utente del kernel, operazioni = REST /files/*:
//   list, stat, mkdir, rename, move, copy, delete, upload, download, zip, preview.
// download/preview/zip richiedono il Bearer token: vengono letti via fetch
// come Blob (un <a href>/<img src> diretto non porterebbe l'header).
// UX: lista o griglia, selezione multipla (ctrl/shift), menu contestuale,
// drag & drop (upload da desktop, sposta su cartella), pannello dettagli con
// anteprima, visualizzatore a tutto schermo, dialoghi interni (no prompt()).
// api: { container, user, get(path), post(path, body), upload(url, file) }
// Ritorna una funzione di cleanup.

(function (api) {
  if (!api || !api.container) { console.error("[fm] api/container mancante"); return; }

  var el = api.container;
  el.classList.add("fm");

  var PREF_KEY = "msk_fm_prefs";
  var TEXT_MAX = 512 * 1024; // anteprima testo: primi 512 KB
  var THUMB_MAX = 8 * 1024 * 1024; // niente miniature oltre 8 MB

  var prefs = loadPrefs();
  var state = {
    cwd: "",
    entries: [],
    sel: {},          // name -> true
    anchor: null,     // ultimo elemento cliccato (range con shift)
    filter: "",
    view: prefs.view || "list",
    sortKey: prefs.sortKey || "name",
    sortDir: prefs.sortDir || 1,
    loading: false,
    detail: null,     // { key, stat?, url?, text?, error? } per il pannello
  };
  var urls = [];      // object URL da revocare
  var thumbs = {};    // path -> object URL (miniature griglia)
  var disposed = false;

  // ------------------------------------------------------------------ util

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ view: state.view, sortKey: state.sortKey, sortDir: state.sortDir })); } catch (e) { /* ignore */ }
  }
  function token() { try { return localStorage.getItem("msk_token") || ""; } catch (e) { return ""; } }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtSize(n) {
    if (n == null) return "—";
    if (n < 1024) return n + " B";
    var u = ["KB", "MB", "GB", "TB"], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (n < 10 ? n.toFixed(1) : Math.round(n)) + " " + u[i];
  }
  function fmtDate(sec, long) {
    if (!sec) return "—";
    var d = new Date(sec * 1000), now = new Date();
    var time = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    if (long) return d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) + ", " + time;
    if (d.toDateString() === now.toDateString()) return "Oggi, " + time;
    var y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Ieri, " + time;
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  }
  function join(dir, name) { return dir ? dir + "/" + name : name; }
  function parentOf(p) { var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
  function ext(name) { var i = name.lastIndexOf("."); return i > 0 ? name.slice(i + 1).toLowerCase() : ""; }
  function byName(name) { for (var i = 0; i < state.entries.length; i++) if (state.entries[i].name === name) return state.entries[i]; return null; }
  function selNames() { return Object.keys(state.sel).filter(function (n) { return byName(n); }); }
  function selEntries() { return selNames().map(byName); }
  function q(s) { return wrap.querySelector(s); }
  function qa(s) { return Array.prototype.slice.call(wrap.querySelectorAll(s)); }

  var KINDS = {
    image: { re: /^(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/, label: "Immagine", color: "#4fc3a1" },
    video: { re: /^(mp4|webm|ogv|mov)$/, label: "Video", color: "#a78bfa" },
    audio: { re: /^(mp3|wav|ogg|oga|m4a|flac)$/, label: "Audio", color: "#f472b6" },
    pdf: { re: /^pdf$/, label: "Documento PDF", color: "#ef6461" },
    code: { re: /^(js|mjs|ts|tsx|jsx|json|geojson|html?|css|rs|py|sh|sql|xml|ya?ml|toml|ini)$/, label: "Codice", color: "#60a5fa" },
    text: { re: /^(txt|md|log|csv|tsv)$/, label: "Testo", color: "#c9c2b3" },
    archive: { re: /^(zip|rar|7z|tar|gz|tgz|mskp)$/, label: "Archivio", color: "#f59e5b" },
    doc: { re: /^(docx?|odt|rtf|xlsx?|ods|pptx?|odp)$/, label: "Documento", color: "#38bdf8" },
  };
  function kindOf(e) {
    if (e.is_dir) return "dir";
    var x = ext(e.name);
    for (var k in KINDS) if (KINDS[k].re.test(x)) return k;
    return "file";
  }
  function kindLabel(e) {
    var k = kindOf(e);
    if (k === "dir") return "Cartella";
    if (KINDS[k]) return KINDS[k].label + (ext(e.name) ? " · " + ext(e.name).toUpperCase() : "");
    return ext(e.name) ? "File " + ext(e.name).toUpperCase() : "File";
  }
  function previewable(e) { return !e.is_dir && /^(image|video|audio|pdf|code|text)$/.test(kindOf(e)); }

  function icon(e, big) {
    var k = kindOf(e), s = big ? 64 : 22;
    if (k === "dir") {
      return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M2.5 6.5a2 2 0 0 1 2-2h4.6l2 2.2h8.4a2 2 0 0 1 2 2v9.8a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill="#c98d24"/>' +
        '<path d="M2.5 9.2a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2z" fill="#f0b23e"/></svg>';
    }
    var c = (KINDS[k] || { color: "#8f887a" }).color;
    var x = ext(e.name).slice(0, 4).toUpperCase();
    return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M5 2.5h9.5L20 8v12.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 20.5v-16.5A1.5 1.5 0 0 1 5.5 2.5z" fill="#232730" stroke="' + c + '" stroke-width="1.2"/>' +
      '<path d="M14.5 2.5V7a1 1 0 0 0 1 1H20" fill="none" stroke="' + c + '" stroke-width="1.2"/>' +
      (x ? '<rect x="2" y="12.5" width="' + Math.max(9, x.length * 3.6 + 3) + '" height="6.5" rx="1.4" fill="' + c + '"/>' +
        '<text x="' + (2 + Math.max(9, x.length * 3.6 + 3) / 2) + '" y="17.4" text-anchor="middle" font-size="4.6" font-weight="700" font-family="system-ui,sans-serif" fill="#111">' + esc(x) + '</text>' : "") +
      "</svg>";
  }

  var I = {
    upload: '<path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/>',
    folderPlus: '<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10.5v5m-2.5-2.5h5"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    grid: '<path d="M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z"/>',
    search: '<path d="m20 20-4.2-4.2M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z"/>',
    home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    download: '<path d="M12 4v12m0 0-4.5-4.5M12 16l4.5-4.5M4 20h16"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
    move: '<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 13h6m-2.5-2.5L15 13l-2.5 2.5"/>',
    copy: '<path d="M8.5 8.5h10v11h-10zM15.5 8.5V4.5h-10v11h3"/>',
    trash: '<path d="M4.5 7h15M10 11v6m4-6v6M6 7l1 12.5h10L18 7M9 7V4.5h6V7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    open: '<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    left: '<path d="M15 5l-7 7 7 7"/>',
    right: '<path d="M9 5l7 7-7 7"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
    zip: '<path d="M6 3.5h12v17H6zM11 3.5v2h2v2h-2v2h2v2h-2M10.5 14h3v3h-3z"/>',
    check: '<path d="M5 12.5 10 17 19 7"/>',
  };
  function svg(name, cls) {
    return '<svg class="si' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + I[name] + "</svg>";
  }

  // ------------------------------------------------------------ rete / blob

  function authFetch(path) {
    return fetch(path, { headers: { Authorization: "Bearer " + token() } }).then(function (r) {
      if (r.ok) return r;
      return r.text().then(function (t) { throw new Error(t || "HTTP " + r.status); });
    });
  }
  function blobOf(path) {
    return authFetch("/files/preview?path=" + encodeURIComponent(path)).then(function (r) { return r.blob(); });
  }
  function objUrl(blob) { var u = URL.createObjectURL(blob); urls.push(u); return u; }
  function saveBlob(blob, name) {
    var u = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = u; a.download = name; a.style.display = "none";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 30000);
  }
  function uploadOne(path, file, onProgress) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open("POST", "/files/upload?path=" + encodeURIComponent(path));
      x.setRequestHeader("Authorization", "Bearer " + token());
      x.upload.onprogress = function (ev) { if (ev.lengthComputable) onProgress(ev.loaded / ev.total); };
      x.onload = function () { x.status < 300 ? resolve() : reject(new Error(x.responseText || "HTTP " + x.status)); };
      x.onerror = function () { reject(new Error("errore di rete")); };
      x.send(file);
    });
  }

  // ---------------------------------------------------------------- stili

  var styles = document.createElement("style");
  styles.textContent = [
    ".fm { --fm-acc: var(--acc, #f0b23e); --fm-line: var(--line, #2a2e37); --fm-p1: var(--panel, #14161b); --fm-p2: var(--panel2, #1b1e24); --fm-fg: var(--fg, #ece7db); --fm-dim: var(--dim, #8f887a); --fm-err: var(--err, #e0615c); --fm-ok: var(--ok, #5cb887); position: relative; color: var(--fm-fg); font-family: var(--font-ui, system-ui, sans-serif); }",
    ".fm *, .fm *::before, .fm *::after { box-sizing: border-box; }",
    ".fm-root { display: flex; flex-direction: column; gap: 12px; outline: none; }",
    ".fm .si { width: 17px; height: 17px; flex: 0 0 auto; }",
    ".fm .ic { flex: 0 0 auto; display: block; }",
    // header
    ".fm-head { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }",
    ".fm-title { display: flex; align-items: center; gap: 10px; }",
    ".fm-title h2 { font-size: 22px; font-weight: 700; letter-spacing: .2px; margin: 0; }",
    ".fm-title .badge { font-family: var(--font-mono, monospace); font-size: 11px; color: var(--fm-dim); border: 1px solid var(--fm-line); border-radius: 99px; padding: 2px 8px; }",
    ".fm-grow { flex: 1; }",
    ".fm-btn { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 13px; border-radius: 9px; border: 1px solid var(--fm-line); background: var(--fm-p2); color: var(--fm-fg); font: 600 13px var(--font-ui, system-ui, sans-serif); cursor: pointer; transition: background .15s, border-color .15s, color .15s, transform .08s; white-space: nowrap; }",
    ".fm-btn:hover:not(:disabled) { border-color: var(--acc-line, rgba(240,178,62,.45)); background: #22262e; }",
    ".fm-btn:active:not(:disabled) { transform: translateY(1px); }",
    ".fm-btn:disabled { opacity: .4; cursor: not-allowed; }",
    ".fm-btn.primary { background: var(--fm-acc); border-color: var(--fm-acc); color: #1a1408; }",
    ".fm-btn.primary:hover:not(:disabled) { background: #f6c25f; border-color: #f6c25f; box-shadow: 0 6px 22px var(--acc-glow, rgba(240,178,62,.22)); }",
    ".fm-btn.danger { color: var(--fm-err); }",
    ".fm-btn.danger:hover:not(:disabled) { border-color: var(--fm-err); background: rgba(224,97,92,.1); }",
    ".fm-btn.danger.solid { background: var(--fm-err); border-color: var(--fm-err); color: #fff; }",
    ".fm-btn.icon { width: 34px; padding: 0; justify-content: center; }",
    ".fm-btn.ghost { background: transparent; border-color: transparent; }",
    ".fm-btn.ghost:hover:not(:disabled) { background: var(--fm-p2); border-color: var(--fm-line); }",
    ".fm-seg { display: inline-flex; border: 1px solid var(--fm-line); border-radius: 9px; overflow: hidden; }",
    ".fm-seg button { height: 32px; width: 34px; display: grid; place-items: center; background: var(--fm-p2); border: 0; color: var(--fm-dim); cursor: pointer; }",
    ".fm-seg button.on { background: var(--acc-soft, rgba(240,178,62,.12)); color: var(--fm-acc); }",
    ".fm-search { position: relative; }",
    ".fm-search .si { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--fm-dim); pointer-events: none; }",
    ".fm-search input { height: 34px; width: 220px; max-width: 46vw; padding: 0 10px 0 33px; border-radius: 9px; border: 1px solid var(--fm-line); background: var(--fm-p1); color: var(--fm-fg); font: 13px var(--font-ui, system-ui, sans-serif); outline: none; transition: border-color .15s, box-shadow .15s; }",
    ".fm-search input:focus { border-color: var(--fm-acc); box-shadow: 0 0 0 3px var(--acc-soft, rgba(240,178,62,.12)); }",
    // breadcrumb
    ".fm-crumbs { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; min-height: 32px; padding: 3px; border: 1px solid var(--fm-line); border-radius: 10px; background: var(--fm-p1); }",
    ".fm-crumb { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 9px; border-radius: 7px; border: 1px dashed transparent; background: none; color: var(--fm-dim); font: 500 13px var(--font-ui, system-ui, sans-serif); cursor: pointer; }",
    ".fm-crumb:hover { background: var(--fm-p2); color: var(--fm-fg); }",
    ".fm-crumb.cur { color: var(--fm-fg); font-weight: 650; }",
    ".fm-crumb.drop { border-color: var(--fm-acc); background: var(--acc-soft, rgba(240,178,62,.12)); color: var(--fm-acc); }",
    ".fm-crumb .si { width: 15px; height: 15px; }",
    ".fm-sep { color: var(--fm-line); font-size: 14px; user-select: none; }",
    // action bar
    ".fm-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-height: 44px; padding: 5px 6px 5px 12px; border-radius: 11px; background: var(--fm-p1); border: 1px solid var(--fm-line); }",
    ".fm-bar.has { border-color: var(--acc-line, rgba(240,178,62,.45)); background: linear-gradient(90deg, rgba(240,178,62,.07), var(--fm-p1) 60%); }",
    ".fm-bar .count { font-size: 13px; font-weight: 650; margin-right: 6px; }",
    ".fm-bar .hint { font-size: 12.5px; color: var(--fm-dim); }",
    ".fm-bar .fm-btn { height: 32px; }",
    // body
    ".fm-body { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 12px; align-items: start; }",
    "@media (max-width: 900px) { .fm-body { grid-template-columns: minmax(0, 1fr); } }",
    ".fm-main { position: relative; min-height: 340px; border: 1px solid var(--fm-line); border-radius: 13px; background: var(--fm-p1); overflow: hidden; }",
    // list
    ".fm table { width: 100%; border-collapse: collapse; table-layout: fixed; }",
    ".fm th { position: sticky; top: 0; z-index: 1; text-align: left; padding: 0 12px; height: 36px; font-size: 11px; font-weight: 650; letter-spacing: .7px; text-transform: uppercase; color: var(--fm-dim); background: var(--fm-p2); border-bottom: 1px solid var(--fm-line); user-select: none; }",
    ".fm th.sortable { cursor: pointer; }",
    ".fm th.sortable:hover { color: var(--fm-fg); }",
    ".fm th .arr { color: var(--fm-acc); margin-left: 4px; }",
    ".fm td { padding: 0 12px; height: 44px; border-bottom: 1px solid rgba(42,46,55,.6); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".fm tbody tr:last-child td { border-bottom: 0; }",
    ".fm tr.it { cursor: default; transition: background .1s; }",
    ".fm tr.it:hover td { background: rgba(255,255,255,.025); }",
    ".fm tr.it.sel td { background: var(--acc-soft, rgba(240,178,62,.12)); }",
    ".fm tr.it.sel td:first-child { box-shadow: inset 3px 0 0 var(--fm-acc); }",
    ".fm tr.it.drop td { background: rgba(240,178,62,.2); }",
    ".fm .c-chk { width: 42px; padding-right: 0; }",
    ".fm .c-size { width: 96px; text-align: right; font-variant-numeric: tabular-nums; color: var(--fm-dim); }",
    ".fm th.c-size { text-align: right; }",
    ".fm .c-date { width: 140px; color: var(--fm-dim); }",
    ".fm .c-kind { width: 150px; color: var(--fm-dim); }",
    "@media (max-width: 700px) { .fm .c-kind, .fm .c-date { display: none; } }",
    ".fm .nm { display: flex; align-items: center; gap: 10px; min-width: 0; }",
    ".fm .nm span { overflow: hidden; text-overflow: ellipsis; }",
    ".fm .nm .is-dir { font-weight: 600; }",
    ".fm .chk { width: 18px; height: 18px; border-radius: 5px; border: 1.5px solid #4a4f5b; display: grid; place-items: center; cursor: pointer; transition: all .12s; background: transparent; padding: 0; color: #1a1408; }",
    ".fm .chk .si { width: 13px; height: 13px; stroke-width: 3; opacity: 0; }",
    ".fm .chk.on { background: var(--fm-acc); border-color: var(--fm-acc); }",
    ".fm .chk.on .si { opacity: 1; }",
    ".fm .chk.part { background: var(--fm-acc); border-color: var(--fm-acc); }",
    ".fm .chk.part::after { content: ''; width: 8px; height: 2px; background: #1a1408; border-radius: 2px; }",
    // grid
    ".fm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 10px; padding: 12px; }",
    ".fm-card { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 12px 8px 10px; border-radius: 11px; border: 1px solid transparent; cursor: default; transition: background .12s, border-color .12s, transform .12s; user-select: none; }",
    ".fm-card:hover { background: var(--fm-p2); }",
    ".fm-card.sel { background: var(--acc-soft, rgba(240,178,62,.12)); border-color: var(--acc-line, rgba(240,178,62,.45)); }",
    ".fm-card.drop { border-color: var(--fm-acc); background: rgba(240,178,62,.2); transform: scale(1.03); }",
    ".fm-card .th { width: 100%; aspect-ratio: 4/3; display: grid; place-items: center; border-radius: 8px; overflow: hidden; background: rgba(0,0,0,.18); }",
    ".fm-card .th img { width: 100%; height: 100%; object-fit: cover; display: block; }",
    ".fm-card .nm2 { width: 100%; font-size: 12.5px; text-align: center; line-height: 1.3; word-break: break-word; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }",
    ".fm-card .meta { font-size: 11px; color: var(--fm-dim); }",
    ".fm-card .chk { position: absolute; top: 8px; left: 8px; opacity: 0; background: rgba(20,22,27,.8); }",
    ".fm-card:hover .chk, .fm-card.sel .chk { opacity: 1; }",
    ".fm-card.sel .chk { background: var(--fm-acc); }",
    // empty / loading
    ".fm-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 64px 20px; text-align: center; color: var(--fm-dim); }",
    ".fm-empty .big { width: 74px; height: 74px; border-radius: 22px; display: grid; place-items: center; background: var(--acc-soft, rgba(240,178,62,.12)); color: var(--fm-acc); margin-bottom: 6px; }",
    ".fm-empty .big .si { width: 34px; height: 34px; }",
    ".fm-empty b { color: var(--fm-fg); font-size: 15px; }",
    ".fm-skel { height: 44px; margin: 0 12px; border-bottom: 1px solid rgba(42,46,55,.6); display: flex; align-items: center; gap: 12px; }",
    ".fm-skel i { display: block; height: 10px; border-radius: 5px; background: linear-gradient(90deg, #1e2128, #282c35, #1e2128); background-size: 200% 100%; animation: fm-sh 1.2s infinite linear; }",
    "@keyframes fm-sh { to { background-position: -200% 0; } }",
    // drop overlay
    ".fm-dropzone { position: absolute; inset: 6px; z-index: 5; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 10px; border: 2px dashed var(--fm-acc); border-radius: 11px; background: rgba(20,22,27,.88); color: var(--fm-acc); font-weight: 650; pointer-events: none; }",
    ".fm-dropzone .si { width: 40px; height: 40px; }",
    ".fm-main.dragover .fm-dropzone { display: flex; }",
    // side panel
    ".fm-side { position: sticky; top: 12px; border: 1px solid var(--fm-line); border-radius: 13px; background: var(--fm-p1); overflow: hidden; }",
    ".fm-side .pv { position: relative; min-height: 170px; display: grid; place-items: center; background: repeating-conic-gradient(#171a20 0% 25%, #1b1e25 0% 50%) 50% / 18px 18px; border-bottom: 1px solid var(--fm-line); }",
    ".fm-side .pv.plain { background: radial-gradient(circle at 50% 40%, rgba(240,178,62,.08), transparent 70%), var(--fm-p2); }",
    ".fm-side .pv img, .fm-side .pv video { max-width: 100%; max-height: 260px; display: block; }",
    ".fm-side .pv audio { width: calc(100% - 24px); }",
    ".fm-side .pv iframe { width: 100%; height: 260px; border: 0; background: #fff; }",
    ".fm-side .pv pre { margin: 0; width: 100%; max-height: 260px; overflow: auto; padding: 12px; font: 11.5px/1.55 var(--font-mono, monospace); color: #d8d2c4; background: #101216; white-space: pre-wrap; word-break: break-word; align-self: stretch; }",
    ".fm-side .pv .zoom { position: absolute; right: 8px; bottom: 8px; }",
    ".fm-side .pv .zoom .fm-btn { height: 30px; background: rgba(20,22,27,.85); backdrop-filter: blur(4px); }",
    ".fm-side .hd { padding: 14px 16px 6px; }",
    ".fm-side .hd .n { font-size: 15px; font-weight: 700; word-break: break-word; line-height: 1.3; }",
    ".fm-side .hd .k { font-size: 12px; color: var(--fm-dim); margin-top: 3px; }",
    ".fm-side dl { margin: 0; padding: 6px 16px 12px; display: grid; grid-template-columns: auto 1fr; gap: 7px 14px; font-size: 12.5px; }",
    ".fm-side dt { color: var(--fm-dim); }",
    ".fm-side dd { margin: 0; text-align: right; word-break: break-all; font-variant-numeric: tabular-nums; }",
    ".fm-side dd.mono { font-family: var(--font-mono, monospace); font-size: 11.5px; }",
    ".fm-side .acts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 0 12px 14px; }",
    ".fm-side .acts .fm-btn { justify-content: center; height: 32px; font-size: 12.5px; }",
    ".fm-side .acts .wide { grid-column: span 2; }",
    ".fm-side .note { padding: 10px 16px 14px; font-size: 12px; color: var(--fm-dim); }",
    ".fm-side .spin, .fm-lb .spin { width: 26px; height: 26px; border-radius: 50%; border: 2.5px solid rgba(240,178,62,.2); border-top-color: var(--fm-acc); animation: fm-rot .8s linear infinite; }",
    "@keyframes fm-rot { to { transform: rotate(360deg); } }",
    ".fm-side .err, .fm-lb .err { color: var(--fm-err); font-size: 12.5px; padding: 16px; text-align: center; }",
    ".fm-stack { position: relative; width: 84px; height: 84px; }",
    ".fm-stack .ic { position: absolute; }",
    // status
    ".fm-status { display: flex; gap: 14px; font-family: var(--font-mono, monospace); font-size: 11.5px; color: var(--fm-dim); padding: 0 4px; }",
    // overlay comuni (modal, lightbox, menu, toast) — position fixed
    ".fm-layer { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; background: rgba(5,6,8,.66); backdrop-filter: blur(3px); animation: fm-fade .16s ease both; }",
    "@keyframes fm-fade { from { opacity: 0; } }",
    "@keyframes fm-pop { from { opacity: 0; transform: translateY(8px) scale(.97); } }",
    ".fm-dlg { width: 440px; max-width: 94vw; max-height: 86vh; display: flex; flex-direction: column; background: var(--fm-p1); border: 1px solid var(--fm-line); border-radius: 16px; box-shadow: 0 30px 80px rgba(0,0,0,.6); animation: fm-pop .22s cubic-bezier(.2,.9,.3,1.15) both; color: var(--fm-fg); font-family: var(--font-ui, system-ui, sans-serif); }",
    ".fm-dlg.wide { width: 520px; }",
    ".fm-dlg h3 { margin: 0; padding: 20px 22px 4px; font-size: 17px; font-weight: 700; display: flex; align-items: center; gap: 10px; }",
    ".fm-dlg h3 .si { width: 20px; height: 20px; color: var(--fm-acc); }",
    ".fm-dlg h3.danger .si { color: var(--fm-err); }",
    ".fm-dlg .bd { padding: 10px 22px 6px; font-size: 13.5px; color: var(--fm-dim); overflow: auto; }",
    ".fm-dlg .bd b { color: var(--fm-fg); }",
    ".fm-dlg input.tx { width: 100%; height: 40px; margin-top: 8px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--fm-line); background: var(--fm-p2); color: var(--fm-fg); font: 14px var(--font-ui, system-ui, sans-serif); outline: none; }",
    ".fm-dlg input.tx:focus { border-color: var(--fm-acc); box-shadow: 0 0 0 3px var(--acc-soft, rgba(240,178,62,.12)); }",
    ".fm-dlg .ferr { min-height: 18px; margin-top: 6px; font-size: 12px; color: var(--fm-err); }",
    ".fm-dlg .ft { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 22px 20px; }",
    ".fm-dlg ul.names { margin: 10px 0 0; padding: 8px 12px; list-style: none; max-height: 160px; overflow: auto; border-radius: 10px; background: var(--fm-p2); border: 1px solid var(--fm-line); }",
    ".fm-dlg ul.names li { display: flex; align-items: center; gap: 8px; padding: 4px 0; color: var(--fm-fg); font-size: 13px; }",
    ".fm-pick { margin-top: 10px; border: 1px solid var(--fm-line); border-radius: 11px; overflow: hidden; background: var(--fm-p2); }",
    ".fm-pick .pc { display: flex; align-items: center; gap: 2px; flex-wrap: wrap; padding: 6px; border-bottom: 1px solid var(--fm-line); background: var(--fm-p1); }",
    ".fm-pick .pl { height: 230px; overflow: auto; padding: 4px; }",
    ".fm-pick .pi { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0; border-radius: 8px; background: none; color: var(--fm-fg); font: 13px var(--font-ui, system-ui, sans-serif); text-align: left; cursor: pointer; }",
    ".fm-pick .pi:hover:not(:disabled) { background: rgba(255,255,255,.04); }",
    ".fm-pick .pi:disabled { opacity: .35; cursor: not-allowed; }",
    ".fm-pick .pi .si { margin-left: auto; color: var(--fm-dim); width: 15px; height: 15px; }",
    ".fm-pick .pe { padding: 30px; text-align: center; color: var(--fm-dim); font-size: 12.5px; }",
    // lightbox
    ".fm-lb { position: fixed; inset: 0; z-index: 70; display: flex; flex-direction: column; background: rgba(6,7,9,.94); backdrop-filter: blur(6px); animation: fm-fade .16s ease both; color: var(--fm-fg); font-family: var(--font-ui, system-ui, sans-serif); }",
    ".fm-lb .top { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,.06); }",
    ".fm-lb .top .n { font-weight: 650; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".fm-lb .top .k { font-size: 12px; color: var(--fm-dim); white-space: nowrap; }",
    ".fm-lb .stage { position: relative; flex: 1; min-height: 0; display: grid; place-items: center; padding: 18px 70px; }",
    ".fm-lb .stage img, .fm-lb .stage video { max-width: 100%; max-height: calc(100vh - 110px); object-fit: contain; border-radius: 6px; box-shadow: 0 20px 60px rgba(0,0,0,.5); animation: fm-pop .2s ease both; }",
    ".fm-lb .stage iframe { width: 100%; height: calc(100vh - 110px); border: 0; border-radius: 8px; background: #fff; }",
    ".fm-lb .stage pre { margin: 0; width: 100%; max-width: 1000px; height: calc(100vh - 110px); overflow: auto; padding: 18px 20px; border-radius: 10px; background: #101216; border: 1px solid var(--fm-line); font: 12.5px/1.6 var(--font-mono, monospace); color: #d8d2c4; white-space: pre-wrap; word-break: break-word; }",
    ".fm-lb .stage audio { width: min(520px, 90%); }",
    ".fm-lb .nav { position: absolute; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border-radius: 50%; border: 1px solid rgba(255,255,255,.1); background: rgba(27,30,36,.8); color: var(--fm-fg); display: grid; place-items: center; cursor: pointer; }",
    ".fm-lb .nav:hover { border-color: var(--fm-acc); color: var(--fm-acc); }",
    ".fm-lb .nav.l { left: 14px; } .fm-lb .nav.r { right: 14px; }",
    ".fm-lb .nav .si { width: 22px; height: 22px; }",
    ".fm-lb .trunc { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); font-size: 12px; color: var(--fm-dim); background: var(--fm-p1); border: 1px solid var(--fm-line); border-radius: 99px; padding: 4px 12px; }",
    // context menu
    ".fm-menu { position: fixed; z-index: 80; min-width: 200px; padding: 5px; border-radius: 11px; background: #1b1e24; border: 1px solid var(--fm-line); box-shadow: 0 16px 40px rgba(0,0,0,.55); animation: fm-pop .12s ease both; font-family: var(--font-ui, system-ui, sans-serif); }",
    ".fm-menu button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 10px; border: 0; border-radius: 7px; background: none; color: var(--fm-fg); font: 13px var(--font-ui, system-ui, sans-serif); text-align: left; cursor: pointer; }",
    ".fm-menu button:hover:not(:disabled) { background: var(--acc-soft, rgba(240,178,62,.12)); }",
    ".fm-menu button:disabled { opacity: .35; cursor: not-allowed; }",
    ".fm-menu button.danger { color: var(--fm-err); }",
    ".fm-menu button.danger:hover { background: rgba(224,97,92,.12); }",
    ".fm-menu button kbd { margin-left: auto; font: 10.5px var(--font-mono, monospace); color: var(--fm-dim); }",
    ".fm-menu hr { border: 0; border-top: 1px solid var(--fm-line); margin: 4px 2px; }",
    // toast / upload
    ".fm-toasts { position: fixed; right: 18px; bottom: 58px; z-index: 90; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; pointer-events: none; font-family: var(--font-ui, system-ui, sans-serif); }",
    ".fm-toast { pointer-events: auto; display: flex; align-items: center; gap: 10px; max-width: 380px; padding: 10px 14px; border-radius: 11px; background: #1b1e24; border: 1px solid var(--fm-line); box-shadow: 0 12px 30px rgba(0,0,0,.45); font-size: 13px; color: var(--fm-fg); animation: fm-pop .2s ease both; }",
    ".fm-toast::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--fm-ok); flex: 0 0 auto; }",
    ".fm-toast.err::before { background: var(--fm-err); }",
    ".fm-toast.err { border-color: rgba(224,97,92,.45); }",
    ".fm-up { pointer-events: auto; width: 320px; padding: 12px 14px; border-radius: 12px; background: #1b1e24; border: 1px solid var(--acc-line, rgba(240,178,62,.45)); box-shadow: 0 12px 30px rgba(0,0,0,.45); font-size: 12.5px; color: var(--fm-fg); }",
    ".fm-up .r { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 7px; }",
    ".fm-up .r span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".fm-up .r span:last-child { color: var(--fm-dim); font-family: var(--font-mono, monospace); }",
    ".fm-up .bar { height: 5px; border-radius: 3px; background: rgba(255,255,255,.06); overflow: hidden; }",
    ".fm-up .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #d99a2b, var(--fm-acc)); transition: width .15s; }",
  ].join("\n");

  var wrap = document.createElement("div");
  wrap.className = "fm-root";
  wrap.tabIndex = -1;
  var toasts = document.createElement("div");
  toasts.className = "fm-toasts fm";
  el.appendChild(styles);
  el.appendChild(wrap);
  document.body.appendChild(toasts);

  // ----------------------------------------------------------- feedback

  function toast(text, isErr) {
    var t = document.createElement("div");
    t.className = "fm-toast" + (isErr ? " err" : "");
    t.textContent = text;
    toasts.appendChild(t);
    setTimeout(function () { t.style.transition = "opacity .3s"; t.style.opacity = "0"; }, isErr ? 5200 : 2800);
    setTimeout(function () { t.remove(); }, isErr ? 5600 : 3200);
  }
  function errMsg(e) {
    var m = e && e.message ? e.message : String(e);
    try { var j = JSON.parse(m); if (j && (j.error || j.message)) m = j.error || j.message; } catch (x) { /* testo semplice */ }
    return m;
  }

  // ----------------------------------------------------------- dati

  function sorted() {
    var f = state.filter.trim().toLowerCase();
    var list = state.entries.filter(function (e) { return !f || e.name.toLowerCase().indexOf(f) >= 0; });
    var k = state.sortKey, d = state.sortDir;
    list.sort(function (a, b) {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      var r = 0;
      if (k === "size") r = (a.is_dir ? 0 : a.size) - (b.is_dir ? 0 : b.size);
      else if (k === "modified") r = (a.modified || 0) - (b.modified || 0);
      else if (k === "kind") r = kindLabel(a).localeCompare(kindLabel(b), "it");
      if (!r) r = a.name.localeCompare(b.name, "it", { numeric: true, sensitivity: "base" });
      return r * d;
    });
    return list;
  }

  function refresh(keepSel) {
    state.loading = true;
    if (!state.entries.length) render();
    return api.get("/files/list?path=" + encodeURIComponent(state.cwd)).then(function (r) {
      if (disposed) return;
      state.loading = false;
      state.entries = r.entries || [];
      if (!keepSel) { state.sel = {}; state.anchor = null; }
      var s = {}; selNames().forEach(function (n) { s[n] = true; }); state.sel = s; // via i nomi spariti
      setDetail(null);
      render();
    }).catch(function (e) {
      state.loading = false;
      if (state.cwd && /no such file|cannot find|impossibile trovare/i.test(errMsg(e))) {
        state.cwd = parentOf(state.cwd); return refresh();
      }
      render();
      toast(errMsg(e), true);
    });
  }

  function go(path) {
    state.cwd = path;
    state.filter = "";
    state.sel = {};
    state.anchor = null;
    clearThumbs();
    refresh();
  }

  // --------------------------------------------------------- operazioni

  function seq(items, fn) {
    var errors = [];
    return items.reduce(function (p, it) {
      return p.then(function () { return fn(it); }).catch(function (e) { errors.push(it.name + ": " + errMsg(e)); });
    }, Promise.resolve()).then(function () { return errors; });
  }
  function report(errors, okText) {
    if (errors.length) toast(errors.length === 1 ? errors[0] : errors.length + " errori — " + errors[0], true);
    else if (okText) toast(okText);
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function doNewFolder() {
    dialog({
      title: "Nuova cartella", icon: "folderPlus", input: "Nuova cartella", ok: "Crea",
      validate: validName,
      run: function (name) {
        return api.post("/files/mkdir", { path: state.cwd, name: name }).then(function () {
          toast("Cartella “" + name + "” creata");
          return refresh().then(function () { selectOnly(name); });
        });
      },
    });
  }

  function doRename(e) {
    dialog({
      title: "Rinomina", icon: "edit", input: e.name, ok: "Rinomina", selectBase: !e.is_dir,
      label: e.is_dir ? "Nuovo nome della cartella" : "Nuovo nome del file",
      validate: function (v) { return validName(v) || (v !== e.name && byName(v) ? "esiste già un elemento con questo nome" : ""); },
      run: function (name) {
        if (name === e.name) return Promise.resolve();
        return api.post("/files/rename", { path: join(state.cwd, e.name), name: name }).then(function () {
          toast("Rinominato in “" + name + "”");
          return refresh().then(function () { selectOnly(name); });
        });
      },
    });
  }

  function doDelete(items) {
    if (!items.length) return;
    var dirs = items.filter(function (e) { return e.is_dir; }).length;
    dialog({
      title: items.length === 1 ? "Eliminare “" + items[0].name + "”?" : "Eliminare " + items.length + " elementi?",
      icon: "trash", danger: true, ok: "Elimina",
      body: (dirs ? "Le cartelle verranno eliminate con <b>tutto il loro contenuto</b>. " : "") + "L'operazione non può essere annullata." +
        (items.length > 1 ? '<ul class="names">' + items.map(function (e) { return "<li>" + icon(e) + esc(e.name) + "</li>"; }).join("") + "</ul>" : ""),
      run: function () {
        return seq(items, function (e) { return api.post("/files/delete", { path: join(state.cwd, e.name) }); }).then(function (errs) {
          report(errs, items.length === 1 ? "“" + items[0].name + "” eliminato" : plural(items.length, "elemento eliminato", "elementi eliminati"));
          return refresh();
        });
      },
    });
  }

  function doTransfer(items, mode) {
    if (!items.length) return;
    pickFolder({
      title: (mode === "move" ? "Sposta " : "Copia ") + (items.length === 1 ? "“" + items[0].name + "”" : items.length + " elementi"),
      icon: mode === "move" ? "move" : "copy",
      ok: mode === "move" ? "Sposta qui" : "Copia qui",
      start: state.cwd,
      blocked: items.filter(function (e) { return e.is_dir; }).map(function (e) { return join(state.cwd, e.name); }),
      sameOk: mode === "copy",
      run: function (to) { return transfer(items, to, mode); },
    });
  }

  function transfer(items, to, mode) {
    var url = mode === "move" ? "/files/move" : "/files/copy";
    return seq(items, function (e) { return api.post(url, { from: join(state.cwd, e.name), to: to }); }).then(function (errs) {
      var where = to ? "“" + to.split("/").pop() + "”" : "Home";
      var verb = (mode === "move" ? "spostat" : "copiat") + (items.length === 1 ? "o" : "i");
      report(errs, (items.length === 1 ? "“" + items[0].name + "”" : items.length + " elementi") + " " + verb + (to === state.cwd ? " qui" : " in " + where));
      return refresh(mode === "copy");
    });
  }

  function doDownload(items) {
    seq(items, function (e) {
      var p = join(state.cwd, e.name);
      if (e.is_dir) {
        toast("Preparo lo zip di “" + e.name + "”…");
        return authFetch("/files/zip?path=" + encodeURIComponent(p)).then(function (r) { return r.blob(); })
          .then(function (b) { saveBlob(b, e.name + ".zip"); });
      }
      return authFetch("/files/download?path=" + encodeURIComponent(p)).then(function (r) { return r.blob(); })
        .then(function (b) { saveBlob(b, e.name); });
    }).then(function (errs) { report(errs); });
  }

  function doUpload(files, dir) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length) return;
    dir = dir == null ? state.cwd : dir;
    // conflitti verificabili solo sulla cartella corrente (le altre non sono in memoria)
    var clash = dir === state.cwd ? files.filter(function (f) { return byName(f.name); }) : [];
    if (clash.length) {
      dialog({
        title: clash.length === 1 ? "“" + clash[0].name + "” esiste già" : clash.length + " file esistono già",
        icon: "info", ok: "Sostituisci",
        body: "Vuoi sostituire " + (clash.length === 1 ? "il file esistente" : "i file esistenti") + " o mantenere entrambe le versioni?" +
          (clash.length > 1 ? '<ul class="names">' + clash.map(function (f) { return "<li>" + icon({ name: f.name }) + esc(f.name) + "</li>"; }).join("") + "</ul>" : ""),
        alt: { label: "Mantieni entrambi", run: function () { startUpload(files, dir, true); } },
        run: function () { startUpload(files, dir, false); },
      });
      return;
    }
    startUpload(files, dir, false);
  }

  // primo nome libero "nome (n).ext" fra quelli della cartella corrente e quelli gia' presi
  function freeName(name, taken) {
    var i = name.lastIndexOf("."), base = i > 0 ? name.slice(0, i) : name, x = i > 0 ? name.slice(i) : "";
    for (var n = 1; ; n++) { var c = base + " (" + n + ")" + x; if (!byName(c) && !taken[c]) return c; }
  }

  function startUpload(files, dir, keepBoth) {
    var total = files.reduce(function (s, f) { return s + f.size; }, 0) || 1;
    var done = 0;
    var box = document.createElement("div");
    box.className = "fm-up";
    box.innerHTML = '<div class="r"><span></span><span></span></div><div class="bar"><i></i></div>';
    toasts.appendChild(box);
    var label = box.querySelector(".r span"), pct = box.querySelector(".r span:last-child"), bar = box.querySelector(".bar i");
    var i = 0;
    var taken = {};
    var jobs = files.map(function (f) {
      var name = keepBoth && byName(f.name) ? freeName(f.name, taken) : f.name;
      taken[name] = true;
      return { name: name, file: f };
    });
    seq(jobs, function (it) {
      i++;
      label.textContent = (files.length > 1 ? i + "/" + files.length + " · " : "") + it.name;
      return uploadOne(join(dir, it.name), it.file, function (fr) {
        var p = Math.min(100, Math.round(((done + fr * it.file.size) / total) * 100));
        bar.style.width = p + "%"; pct.textContent = p + "%";
      }).then(function () { done += it.file.size; });
    }).then(function (errs) {
      bar.style.width = "100%"; pct.textContent = "100%";
      setTimeout(function () { box.remove(); }, 500);
      report(errs, jobs.length === 1 ? "“" + jobs[0].name + "” caricato" : plural(jobs.length, "file caricato", "file caricati"));
      if (dir === state.cwd) {
        return refresh().then(function () {
          var s = {}; jobs.forEach(function (j) { if (byName(j.name)) s[j.name] = true; }); state.sel = s; render();
        });
      }
      return refresh(true);
    });
  }

  function validName(v) {
    if (!v) return "il nome non può essere vuoto";
    if (/[\/\\]/.test(v)) return "il nome non può contenere / o \\";
    if (v === "." || v === "..") return "nome non valido";
    if (v.charAt(0) === ".") return "i nomi che iniziano con un punto sono nascosti";
    return "";
  }

  // ------------------------------------------------------------ selezione

  function selectOnly(name) { state.sel = {}; if (name && byName(name)) state.sel[name] = true; state.anchor = name; render(); }
  function clickItem(name, ev) {
    var list = sorted().map(function (e) { return e.name; });
    if (ev.shiftKey && state.anchor && list.indexOf(state.anchor) >= 0) {
      var a = list.indexOf(state.anchor), b = list.indexOf(name);
      if (!(ev.ctrlKey || ev.metaKey)) state.sel = {};
      list.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(function (n) { state.sel[n] = true; });
    } else if (ev.ctrlKey || ev.metaKey || ev.toggle) {
      if (state.sel[name]) delete state.sel[name]; else state.sel[name] = true;
      state.anchor = name;
    } else {
      state.sel = {}; state.sel[name] = true; state.anchor = name;
    }
    render();
  }
  function openItem(e) {
    if (e.is_dir) go(join(state.cwd, e.name));
    else if (previewable(e)) lightbox(e);
    else doDownload([e]);
  }

  // --------------------------------------------------------------- render

  function render() {
    if (disposed) return;
    var list = sorted();
    var names = selNames();
    var n = names.length;
    var one = n === 1 ? byName(names[0]) : null;
    var h = "";

    // header
    h += '<div class="fm-head">';
    h += '<div class="fm-title"><h2>File</h2><span class="badge">' + esc(api.user || "") + "</span></div>";
    h += '<div class="fm-grow"></div>';
    h += '<label class="fm-search">' + svg("search") + '<input id="fm-q" type="search" placeholder="Cerca in questa cartella" value="' + esc(state.filter) + '"/></label>';
    h += '<div class="fm-seg" role="group" aria-label="Vista">' +
      '<button data-view="list" class="' + (state.view === "list" ? "on" : "") + '" title="Elenco">' + svg("list") + "</button>" +
      '<button data-view="grid" class="' + (state.view === "grid" ? "on" : "") + '" title="Griglia">' + svg("grid") + "</button></div>";
    h += '<button class="fm-btn icon" data-act="refresh" title="Aggiorna">' + svg("refresh") + "</button>";
    h += '<button class="fm-btn" data-act="mkdir">' + svg("folderPlus") + "Nuova cartella</button>";
    h += '<button class="fm-btn primary" data-act="upload">' + svg("upload") + "Carica</button>";
    h += "</div>";

    // breadcrumb
    var parts = state.cwd.split("/").filter(Boolean);
    h += '<nav class="fm-crumbs" aria-label="Percorso">';
    h += '<button class="fm-crumb' + (parts.length ? "" : " cur") + '" data-nav="" data-drop="">' + svg("home") + "Home</button>";
    parts.forEach(function (p, i) {
      var path = parts.slice(0, i + 1).join("/");
      h += '<span class="fm-sep">›</span><button class="fm-crumb' + (i === parts.length - 1 ? " cur" : "") + '" data-nav="' + esc(path) + '" data-drop="' + esc(path) + '">' + esc(p) + "</button>";
    });
    h += "</nav>";

    // action bar
    h += '<div class="fm-bar' + (n ? " has" : "") + '">';
    if (n) {
      h += '<span class="count">' + plural(n, "selezionato", "selezionati") + "</span>";
      if (one) h += '<button class="fm-btn ghost" data-act="open">' + svg(one.is_dir ? "open" : previewable(one) ? "eye" : "download") + (one.is_dir ? "Apri" : previewable(one) ? "Anteprima" : "Scarica") + "</button>";
      h += '<button class="fm-btn ghost" data-act="download">' + svg(names.some(function (x) { return byName(x).is_dir; }) ? "zip" : "download") + "Scarica</button>";
      h += '<button class="fm-btn ghost" data-act="rename"' + (one ? "" : " disabled") + ">" + svg("edit") + "Rinomina</button>";
      h += '<button class="fm-btn ghost" data-act="move">' + svg("move") + "Sposta</button>";
      h += '<button class="fm-btn ghost" data-act="copy">' + svg("copy") + "Copia</button>";
      h += '<button class="fm-btn ghost danger" data-act="delete">' + svg("trash") + "Elimina</button>";
      h += '<div class="fm-grow"></div><button class="fm-btn icon ghost" data-act="clear" title="Annulla selezione (Esc)">' + svg("x") + "</button>";
    } else {
      h += '<span class="hint">Seleziona un elemento per vederne i dettagli · doppio clic per aprire · tasto destro per il menu · trascina qui i file per caricarli</span>';
    }
    h += "</div>";

    // body
    h += '<div class="fm-body"><div class="fm-main" id="fm-main">';
    if (state.loading && !state.entries.length) {
      for (var s = 0; s < 6; s++) h += '<div class="fm-skel"><i style="width:22px;height:22px;border-radius:6px"></i><i style="width:' + (30 + (s * 13) % 40) + '%"></i></div>';
    } else if (!list.length) {
      h += state.filter
        ? '<div class="fm-empty"><div class="big">' + svg("search") + "</div><b>Nessun risultato</b><span>Nessun elemento contiene “" + esc(state.filter) + "”</span></div>"
        : '<div class="fm-empty"><div class="big">' + svg("upload") + "</div><b>Questa cartella è vuota</b><span>Trascina qui dei file oppure</span>" +
          '<div style="display:flex;gap:8px;margin-top:6px"><button class="fm-btn primary" data-act="upload">' + svg("upload") + 'Carica file</button><button class="fm-btn" data-act="mkdir">' + svg("folderPlus") + "Nuova cartella</button></div></div>";
    } else if (state.view === "grid") {
      h += '<div class="fm-grid">';
      list.forEach(function (e) {
        var p = join(state.cwd, e.name);
        var th = kindOf(e) === "image" && thumbs[p] ? '<img src="' + thumbs[p] + '" alt="" draggable="false"/>' : icon(e, true);
        h += '<div class="fm-card it' + (state.sel[e.name] ? " sel" : "") + '" draggable="true" data-name="' + esc(e.name) + '"' + (e.is_dir ? ' data-drop="' + esc(p) + '"' : "") + ' title="' + esc(e.name) + '">' +
          '<button class="chk' + (state.sel[e.name] ? " on" : "") + '" data-chk="' + esc(e.name) + '" aria-label="Seleziona">' + svg("check") + "</button>" +
          '<div class="th">' + th + '</div><div class="nm2">' + esc(e.name) + '</div><div class="meta">' + (e.is_dir ? "Cartella" : fmtSize(e.size)) + "</div></div>";
      });
      h += "</div>";
    } else {
      var allOn = list.length && list.every(function (e) { return state.sel[e.name]; });
      var someOn = !allOn && list.some(function (e) { return state.sel[e.name]; });
      h += "<table><thead><tr>";
      h += '<th class="c-chk"><button class="chk' + (allOn ? " on" : someOn ? " part" : "") + '" data-chkall="1" aria-label="Seleziona tutto">' + (someOn ? "" : svg("check")) + "</button></th>";
      [["name", "Nome", ""], ["kind", "Tipo", "c-kind"], ["modified", "Modificato", "c-date"], ["size", "Dimensione", "c-size"]].forEach(function (c) {
        h += '<th class="sortable ' + c[2] + '" data-sort="' + c[0] + '">' + c[1] + (state.sortKey === c[0] ? '<span class="arr">' + (state.sortDir > 0 ? "↑" : "↓") + "</span>" : "") + "</th>";
      });
      h += "</tr></thead><tbody>";
      list.forEach(function (e) {
        var p = join(state.cwd, e.name);
        h += '<tr class="it' + (state.sel[e.name] ? " sel" : "") + '" draggable="true" data-name="' + esc(e.name) + '"' + (e.is_dir ? ' data-drop="' + esc(p) + '"' : "") + ">";
        h += '<td class="c-chk"><button class="chk' + (state.sel[e.name] ? " on" : "") + '" data-chk="' + esc(e.name) + '" aria-label="Seleziona">' + svg("check") + "</button></td>";
        h += '<td><div class="nm">' + icon(e) + '<span class="' + (e.is_dir ? "is-dir" : "") + '" title="' + esc(e.name) + '">' + esc(e.name) + "</span></div></td>";
        h += '<td class="c-kind">' + esc(kindLabel(e)) + "</td>";
        h += '<td class="c-date" title="' + esc(fmtDate(e.modified, true)) + '">' + fmtDate(e.modified) + "</td>";
        h += '<td class="c-size">' + (e.is_dir ? "—" : fmtSize(e.size)) + "</td></tr>";
      });
      h += "</tbody></table>";
    }
    h += '<div class="fm-dropzone">' + svg("upload") + "<span>Rilascia per caricare in " + esc(parts.length ? parts[parts.length - 1] : "Home") + "</span></div>";
    h += "</div>";
    h += '<aside class="fm-side" id="fm-side"></aside></div>';

    // status
    var files = state.entries.filter(function (e) { return !e.is_dir; });
    var dirs = state.entries.length - files.length;
    h += '<div class="fm-status"><span>' + plural(dirs, "cartella", "cartelle") + " · " + plural(files.length, "file", "file") + "</span><span>" +
      fmtSize(files.reduce(function (s, e) { return s + e.size; }, 0)) + "</span>" + (state.filter ? "<span>filtro: " + list.length + " visibili</span>" : "") + "</div>";

    var focused = document.activeElement && document.activeElement.id === "fm-q";
    var caret = focused ? document.activeElement.selectionStart : 0;
    wrap.innerHTML = h;
    if (focused) { var qi = q("#fm-q"); qi.focus(); try { qi.setSelectionRange(caret, caret); } catch (x) { /* ignore */ } }

    bind();
    renderSide();
    if (state.view === "grid") loadThumbs(list);
  }

  // ------------------------------------------------------- pannello dettagli

  function detailKey() {
    var names = selNames();
    if (names.length === 1) return "1:" + join(state.cwd, names[0]);
    if (names.length > 1) return "n:" + names.length;
    return "d:" + state.cwd;
  }

  function renderSide() {
    var side = q("#fm-side");
    if (!side) return;
    var names = selNames();
    var key = detailKey();
    var d = state.detail && state.detail.key === key ? state.detail : null;
    if (!d) { d = setDetail({ key: key }); loadDetail(d, names); }
    var h = "";

    if (names.length > 1) {
      var items = selEntries();
      var sz = items.reduce(function (s, e) { return s + (e.is_dir ? 0 : e.size); }, 0);
      var nd = items.filter(function (e) { return e.is_dir; }).length;
      h += '<div class="pv plain"><div class="fm-stack">' +
        items.slice(0, 3).map(function (e, i) { return '<div style="left:' + (i * 10) + "px;top:" + (i * 8) + 'px">' + icon(e, true) + "</div>"; }).join("") + "</div></div>";
      h += '<div class="hd"><div class="n">' + plural(names.length, "elemento", "elementi") + ' selezionati</div><div class="k">' +
        plural(nd, "cartella", "cartelle") + " · " + plural(items.length - nd, "file", "file") + "</div></div>";
      h += "<dl><dt>Dimensione file</dt><dd>" + fmtSize(sz) + (nd ? " + cartelle" : "") + "</dd></dl>";
      h += '<div class="acts"><button class="fm-btn" data-act="download">' + svg("download") + 'Scarica</button><button class="fm-btn" data-act="move">' + svg("move") +
        'Sposta</button><button class="fm-btn" data-act="copy">' + svg("copy") + 'Copia</button><button class="fm-btn danger" data-act="delete">' + svg("trash") + "Elimina</button></div>";
    } else if (names.length === 1) {
      var e = byName(names[0]);
      h += '<div class="pv' + (d.url || d.text != null ? "" : " plain") + '">' + previewHtml(e, d, false) +
        (previewable(e) && !d.error ? '<div class="zoom"><button class="fm-btn" data-act="open">' + svg("eye") + "Apri</button></div>" : "") + "</div>";
      h += '<div class="hd"><div class="n">' + esc(e.name) + '</div><div class="k">' + esc(kindLabel(e)) + "</div></div>";
      h += "<dl>";
      if (e.is_dir) {
        h += "<dt>Contenuto</dt><dd>" + (d.stat ? plural(d.stat.files, "file", "file") + ", " + plural(d.stat.dirs, "cartella", "cartelle") : d.noStat ? "—" : "…") + "</dd>";
        h += "<dt>Dimensione</dt><dd>" + (d.stat ? fmtSize(d.stat.size) : d.noStat ? "—" : "…") + "</dd>";
      } else {
        h += "<dt>Dimensione</dt><dd>" + fmtSize(e.size) + (e.size >= 1024 ? ' <span style="color:var(--fm-dim)">(' + e.size.toLocaleString("it-IT") + " B)</span>" : "") + "</dd>";
        if (d.dims) h += "<dt>Risoluzione</dt><dd>" + d.dims + "</dd>";
        if (d.lines != null) h += "<dt>Righe</dt><dd>" + d.lines.toLocaleString("it-IT") + (d.truncated ? "+" : "") + "</dd>";
        if (d.duration) h += "<dt>Durata</dt><dd>" + d.duration + "</dd>";
      }
      h += "<dt>Modificato</dt><dd>" + esc(fmtDate(e.modified, true)) + "</dd>";
      h += '<dt>Percorso</dt><dd class="mono">/' + esc(join(state.cwd, e.name)) + "</dd>";
      h += "</dl>";
      h += '<div class="acts">';
      h += e.is_dir
        ? '<button class="fm-btn primary wide" data-act="open">' + svg("open") + "Apri cartella</button>"
        : (previewable(e) ? '<button class="fm-btn primary wide" data-act="open">' + svg("eye") + "Anteprima</button>" : "");
      h += '<button class="fm-btn" data-act="download">' + svg(e.is_dir ? "zip" : "download") + (e.is_dir ? "Scarica zip" : "Scarica") + "</button>";
      h += '<button class="fm-btn" data-act="rename">' + svg("edit") + "Rinomina</button>";
      h += '<button class="fm-btn" data-act="move">' + svg("move") + "Sposta</button>";
      h += '<button class="fm-btn" data-act="copy">' + svg("copy") + "Copia</button>";
      h += '<button class="fm-btn danger wide" data-act="delete">' + svg("trash") + "Elimina</button>";
      h += "</div>";
    } else {
      var parts = state.cwd.split("/").filter(Boolean);
      h += '<div class="pv plain">' + icon({ is_dir: true, name: "" }, true) + "</div>";
      h += '<div class="hd"><div class="n">' + esc(parts.length ? parts[parts.length - 1] : "Home") + '</div><div class="k">Cartella corrente</div></div>';
      h += "<dl><dt>Elementi</dt><dd>" + state.entries.length + "</dd>";
      h += "<dt>Contenuto totale</dt><dd>" + (d.stat ? fmtSize(d.stat.size) : d.noStat ? "—" : "…") + "</dd>";
      if (d.stat) h += "<dt>In profondità</dt><dd>" + plural(d.stat.files, "file", "file") + ", " + plural(d.stat.dirs, "cartella", "cartelle") + "</dd>";
      h += '<dt>Percorso</dt><dd class="mono">/' + esc(state.cwd) + "</dd></dl>";
      h += '<div class="acts"><button class="fm-btn" data-act="mkdir">' + svg("folderPlus") + 'Cartella</button><button class="fm-btn primary" data-act="upload">' + svg("upload") + "Carica</button>" +
        (state.entries.length ? '<button class="fm-btn wide" data-act="zipcwd">' + svg("zip") + "Scarica tutto (.zip)</button>" : "") + "</div>";
    }
    side.innerHTML = h;
    side.querySelectorAll("[data-act]").forEach(bindAct);
    var aud = side.querySelector("video, audio");
    if (aud) aud.addEventListener("loadedmetadata", function () {
      if (aud.duration && isFinite(aud.duration) && !d.duration) {
        d.duration = fmtDur(aud.duration);
        if (aud.videoWidth) d.dims = aud.videoWidth + " × " + aud.videoHeight + " px";
        renderSide();
      }
    });
  }

  function setDetail(d) {
    if (state.detail && state.detail.url) revoke(state.detail.url);
    return (state.detail = d);
  }
  function revoke(u) {
    var i = urls.indexOf(u);
    if (i >= 0) urls.splice(i, 1);
    try { URL.revokeObjectURL(u); } catch (x) { /* ignore */ }
  }

  function fmtDur(s) { s = Math.round(s); var m = Math.floor(s / 60); return m + ":" + ("0" + (s % 60)).slice(-2); }

  function previewHtml(e, d, big) {
    if (d.error) return '<div class="err">Anteprima non disponibile<br/><small>' + esc(d.error) + "</small></div>";
    var k = kindOf(e);
    if (!previewable(e)) return icon(e, true);
    if (!d.url && d.text == null) return '<div class="spin"></div>';
    if (k === "image") return '<img src="' + d.url + '" alt="' + esc(e.name) + '"/>';
    if (k === "video") return '<video src="' + d.url + '" controls preload="metadata"' + (big ? " autoplay" : "") + "></video>";
    if (k === "audio") return '<audio src="' + d.url + '" controls preload="metadata"></audio>';
    if (k === "pdf") return '<iframe src="' + d.url + (big ? "" : "#toolbar=0&view=FitH") + '" title="PDF"></iframe>';
    if (/^html?$/.test(ext(e.name)) && big) return '<iframe sandbox="" srcdoc="' + esc(d.text) + '" title="HTML"></iframe>';
    return "<pre>" + esc(big ? d.text : d.text.slice(0, 6000)) + "</pre>";
  }

  function loadDetail(d, names) {
    function upd() { if (state.detail === d) renderSide(); }
    if (names.length > 1) return;
    if (names.length === 0 || byName(names[0]).is_dir) {
      var path = names.length ? join(state.cwd, names[0]) : state.cwd;
      api.get("/files/stat?path=" + encodeURIComponent(path)).then(function (s) { d.stat = s; upd(); })
        .catch(function () { /* backend senza /files/stat: dettagli ridotti */ d.noStat = true; upd(); });
      return;
    }
    var e = byName(names[0]);
    if (!previewable(e)) return;
    loadContent(e, d).then(upd, function (err) { d.error = errMsg(err); upd(); });
  }

  // carica url/testo per anteprima (pannello o lightbox) nell'oggetto d
  function loadContent(e, d) {
    var k = kindOf(e);
    var path = join(state.cwd, e.name);
    if (k === "text" || k === "code") {
      return blobOf(path).then(function (b) {
        d.truncated = b.size > TEXT_MAX;
        return (d.truncated ? b.slice(0, TEXT_MAX) : b).text();
      }).then(function (t) {
        if (/^(json|geojson)$/.test(ext(e.name)) && !d.truncated) { try { t = JSON.stringify(JSON.parse(t), null, 2); } catch (x) { /* json non valido: testo grezzo */ } }
        d.text = t;
        d.lines = t ? t.split("\n").length : 0;
      });
    }
    return blobOf(path).then(function (b) {
      d.url = objUrl(b);
      if (k === "image") {
        return new Promise(function (res) {
          var im = new Image();
          im.onload = function () { d.dims = im.naturalWidth + " × " + im.naturalHeight + " px"; res(); };
          im.onerror = function () { res(); };
          im.src = d.url;
        });
      }
    });
  }

  function clearThumbs() {
    for (var p in thumbs) { try { URL.revokeObjectURL(thumbs[p]); } catch (x) { /* ignore */ } }
    thumbs = {};
  }
  var thumbQueue = [], thumbBusy = 0;
  function loadThumbs(list) {
    list.forEach(function (e) {
      var p = join(state.cwd, e.name);
      if (kindOf(e) === "image" && !(p in thumbs) && e.size <= THUMB_MAX) { thumbs[p] = ""; thumbQueue.push(p); }
    });
    pumpThumbs();
  }
  function pumpThumbs() {
    while (thumbBusy < 4 && thumbQueue.length) {
      (function (p) {
        thumbBusy++;
        blobOf(p).then(function (b) {
          if (disposed || !(p in thumbs)) return;
          thumbs[p] = URL.createObjectURL(b);
          var card = wrap.querySelector('.fm-card[data-name="' + cssEsc(p.split("/").pop()) + '"] .th');
          if (card && parentOf(p) === state.cwd) card.innerHTML = '<img src="' + thumbs[p] + '" alt="" draggable="false"/>';
        }).catch(function () { /* resta l'icona */ }).then(function () { thumbBusy--; pumpThumbs(); });
      })(thumbQueue.shift());
    }
  }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&"); }

  // ------------------------------------------------------------- lightbox

  var lb = null;
  function lightbox(e) {
    closeLightbox();
    var all = sorted().filter(previewable);
    var idx = Math.max(0, all.map(function (x) { return x.name; }).indexOf(e.name));
    lb = document.createElement("div");
    lb.className = "fm-lb fm";
    document.body.appendChild(lb);
    function show(i) {
      idx = (i + all.length) % all.length;
      var cur = all[idx];
      var d = { key: "lb:" + cur.name };
      if (lb.d && lb.d.url) revoke(lb.d.url);
      lb.d = d;
      lb.innerHTML = '<div class="top">' + icon(cur) + '<div style="min-width:0"><div class="n">' + esc(cur.name) + '</div><div class="k">' + esc(kindLabel(cur)) + " · " + fmtSize(cur.size) +
        (all.length > 1 ? " · " + (idx + 1) + " di " + all.length : "") + '</div></div><div class="fm-grow"></div>' +
        '<button class="fm-btn" data-lb="dl">' + svg("download") + 'Scarica</button><button class="fm-btn icon" data-lb="x" title="Chiudi (Esc)">' + svg("x") + "</button></div>" +
        '<div class="stage"><div class="spin"></div>' +
        (all.length > 1 ? '<button class="nav l" data-lb="prev" title="Precedente (←)">' + svg("left") + '</button><button class="nav r" data-lb="next" title="Successivo (→)">' + svg("right") + "</button>" : "") + "</div>";
      bindLb();
      state.sel = {}; state.sel[cur.name] = true; state.anchor = cur.name; render();
      loadContent(cur, d).then(function () {
        if (!lb || lb.d !== d) return;
        var st = lb.querySelector(".stage");
        st.querySelector(".spin").outerHTML = previewHtml(cur, d, true) + (d.truncated ? '<div class="trunc">Mostrati i primi ' + fmtSize(TEXT_MAX) + " — scarica il file per vederlo tutto</div>" : "");
      }, function (err) {
        if (!lb || lb.d !== d) return;
        lb.querySelector(".stage .spin").outerHTML = '<div class="err">' + esc(errMsg(err)) + "</div>";
      });
    }
    function bindLb() {
      lb.querySelectorAll("[data-lb]").forEach(function (b) {
        b.onclick = function () {
          var a = b.getAttribute("data-lb");
          if (a === "x") closeLightbox();
          else if (a === "prev") show(idx - 1);
          else if (a === "next") show(idx + 1);
          else if (a === "dl") doDownload([all[idx]]);
        };
      });
      lb.querySelector(".stage").onclick = function (ev) { if (ev.target === ev.currentTarget) closeLightbox(); };
    }
    lb.step = function (dir) { if (all.length > 1) show(idx + dir); };
    show(idx);
  }
  function closeLightbox() { if (lb) { if (lb.d && lb.d.url) revoke(lb.d.url); lb.remove(); lb = null; } }

  // -------------------------------------------------------------- dialoghi

  var dlg = null;
  function closeDialog() { if (dlg) { dlg.remove(); dlg = null; wrap.focus(); } }

  // opts: title, icon, body, input, label, ok, danger, validate(v)->err, run(v)->Promise, selectBase
  function dialog(opts) {
    closeDialog(); closeMenu();
    dlg = document.createElement("div");
    dlg.className = "fm-layer fm";
    dlg.innerHTML = '<form class="fm-dlg" novalidate><h3 class="' + (opts.danger ? "danger" : "") + '">' + svg(opts.icon || "info") + esc(opts.title) + "</h3>" +
      '<div class="bd">' + (opts.body || "") + (opts.label ? esc(opts.label) : "") +
      (opts.input != null ? '<input class="tx" value="' + esc(opts.input) + '" spellcheck="false" autocomplete="off"/><div class="ferr"></div>' : "") + "</div>" +
      '<div class="ft"><button type="button" class="fm-btn" data-x="1">Annulla</button>' + (opts.alt ? '<button type="button" class="fm-btn" data-alt="1">' + esc(opts.alt.label) + "</button>" : "") +
      '<button type="submit" class="fm-btn ' + (opts.danger ? "danger solid" : "primary") + '">' + esc(opts.ok || "OK") + "</button></div></form>";
    document.body.appendChild(dlg);
    var form = dlg.querySelector("form"), inp = dlg.querySelector("input.tx"), ferr = dlg.querySelector(".ferr"), okb = dlg.querySelector("[type=submit]");
    dlg.onmousedown = function (ev) { if (ev.target === dlg) closeDialog(); };
    dlg.querySelector("[data-x]").onclick = closeDialog;
    if (opts.alt) dlg.querySelector("[data-alt]").onclick = function () { closeDialog(); opts.alt.run(); };
    if (inp) {
      setTimeout(function () {
        inp.focus();
        var dot = opts.selectBase ? inp.value.lastIndexOf(".") : -1;
        inp.setSelectionRange(0, dot > 0 ? dot : inp.value.length);
      }, 20);
      inp.oninput = function () { ferr.textContent = ""; };
    } else setTimeout(function () { okb.focus(); }, 20);
    form.onsubmit = function (ev) {
      ev.preventDefault();
      var v = inp ? inp.value.trim() : null;
      var bad = opts.validate ? opts.validate(v) : "";
      if (bad) { ferr.textContent = bad; inp.focus(); return; }
      okb.disabled = true; okb.textContent = "…";
      Promise.resolve().then(function () { return opts.run(v); }).then(closeDialog, function (e) {
        okb.disabled = false; okb.textContent = opts.ok || "OK";
        if (ferr) ferr.textContent = errMsg(e); else { closeDialog(); toast(errMsg(e), true); }
      });
    };
  }

  // selettore di cartella per sposta/copia
  function pickFolder(opts) {
    closeDialog(); closeMenu();
    var cur = opts.start;
    dlg = document.createElement("div");
    dlg.className = "fm-layer fm";
    dlg.innerHTML = '<div class="fm-dlg wide"><h3>' + svg(opts.icon) + esc(opts.title) + '</h3><div class="bd">Scegli la cartella di destinazione' +
      '<div class="fm-pick"><div class="pc"></div><div class="pl"></div></div><div class="ferr"></div></div>' +
      '<div class="ft"><button type="button" class="fm-btn" data-act="pmk">' + svg("folderPlus") + 'Nuova</button><div class="fm-grow"></div><button type="button" class="fm-btn" data-x="1">Annulla</button><button type="button" class="fm-btn primary" data-ok="1"></button></div></div>';
    document.body.appendChild(dlg);
    var pc = dlg.querySelector(".pc"), pl = dlg.querySelector(".pl"), okb = dlg.querySelector("[data-ok]"), ferr = dlg.querySelector(".ferr");
    dlg.onmousedown = function (ev) { if (ev.target === dlg) closeDialog(); };
    dlg.querySelector("[data-x]").onclick = closeDialog;
    function blocked(p) { return opts.blocked.some(function (b) { return p === b || p.indexOf(b + "/") === 0; }); }
    function load(path) {
      cur = path;
      ferr.textContent = "";
      var parts = path.split("/").filter(Boolean);
      pc.innerHTML = '<button class="fm-crumb' + (parts.length ? "" : " cur") + '" data-p="">' + svg("home") + "Home</button>" + parts.map(function (p, i) {
        return '<span class="fm-sep">›</span><button class="fm-crumb' + (i === parts.length - 1 ? " cur" : "") + '" data-p="' + esc(parts.slice(0, i + 1).join("/")) + '">' + esc(p) + "</button>";
      }).join("");
      var same = path === state.cwd && !opts.sameOk;
      okb.disabled = same;
      okb.textContent = opts.ok + (parts.length ? " · " + parts[parts.length - 1] : " · Home");
      okb.title = same ? "Gli elementi sono già in questa cartella" : "";
      pl.innerHTML = '<div class="pe"><div class="spin" style="margin:auto;width:20px;height:20px;border-radius:50%;border:2px solid rgba(240,178,62,.2);border-top-color:var(--fm-acc);animation:fm-rot .8s linear infinite"></div></div>';
      pc.querySelectorAll("[data-p]").forEach(function (b) { b.onclick = function () { load(b.getAttribute("data-p")); }; });
      api.get("/files/list?path=" + encodeURIComponent(path)).then(function (r) {
        if (cur !== path || !dlg) return;
        var ds = (r.entries || []).filter(function (e) { return e.is_dir; })
          .sort(function (a, b) { return a.name.localeCompare(b.name, "it", { numeric: true }); });
        pl.innerHTML = ds.length ? ds.map(function (e) {
          var p = join(path, e.name);
          return '<button class="pi" data-p="' + esc(p) + '"' + (blocked(p) ? ' disabled title="Non puoi scegliere una cartella selezionata"' : "") + ">" + icon(e) + esc(e.name) + svg("right") + "</button>";
        }).join("") : '<div class="pe">Nessuna sottocartella</div>';
        pl.querySelectorAll("[data-p]").forEach(function (b) { b.onclick = function () { load(b.getAttribute("data-p")); }; });
      }).catch(function (e) { pl.innerHTML = '<div class="pe" style="color:var(--fm-err)">' + esc(errMsg(e)) + "</div>"; });
    }
    okb.onclick = function () {
      okb.disabled = true;
      Promise.resolve(opts.run(cur)).then(closeDialog, function (e) { okb.disabled = false; ferr.textContent = errMsg(e); });
    };
    dlg.querySelector("[data-act=pmk]").onclick = function () {
      if (pl.querySelector(".pnew")) return pl.querySelector(".pnew input").focus();
      var row = document.createElement("form");
      row.className = "pnew";
      row.style.cssText = "display:flex;gap:6px;padding:6px";
      row.innerHTML = '<input class="tx" style="margin:0;height:34px" placeholder="Nome nuova cartella" spellcheck="false"/><button class="fm-btn primary" type="submit">Crea</button>';
      pl.insertBefore(row, pl.firstChild);
      var inp = row.querySelector("input");
      inp.focus();
      row.onsubmit = function (ev) {
        ev.preventDefault();
        var name = inp.value.trim(), bad = validName(name), parent = cur;
        if (bad) { ferr.textContent = bad; return; }
        api.post("/files/mkdir", { path: parent, name: name }).then(function () {
          if (parent === state.cwd) refresh(true);
          load(join(parent, name));
        }).catch(function (e) { ferr.textContent = errMsg(e); });
      };
    };
    load(cur);
  }

  // ---------------------------------------------------------- menu contesto

  var menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  function openMenu(x, y, forBackground) {
    closeMenu();
    var items = selEntries(), one = items.length === 1 ? items[0] : null, h = "";
    if (forBackground || !items.length) {
      h += '<button data-act="mkdir">' + svg("folderPlus") + "Nuova cartella</button>";
      h += '<button data-act="upload">' + svg("upload") + "Carica file…</button>";
      h += '<button data-act="selall">' + svg("check") + "Seleziona tutto<kbd>Ctrl+A</kbd></button>";
      h += "<hr/>";
      h += '<button data-act="refresh">' + svg("refresh") + "Aggiorna</button>";
      if (state.entries.length) h += '<button data-act="zipcwd">' + svg("zip") + "Scarica cartella (.zip)</button>";
    } else {
      if (one) h += '<button data-act="open">' + svg(one.is_dir ? "open" : previewable(one) ? "eye" : "download") + (one.is_dir ? "Apri" : previewable(one) ? "Anteprima" : "Scarica") + "<kbd>Invio</kbd></button><hr/>";
      h += '<button data-act="download">' + svg("download") + "Scarica" + (items.some(function (e) { return e.is_dir; }) ? " (zip per le cartelle)" : "") + "</button>";
      h += '<button data-act="rename"' + (one ? "" : " disabled") + ">" + svg("edit") + "Rinomina<kbd>F2</kbd></button>";
      h += '<button data-act="move">' + svg("move") + "Sposta in…</button>";
      h += '<button data-act="copy">' + svg("copy") + "Copia in…</button>";
      h += '<button data-act="duplicate">' + svg("copy") + "Duplica qui</button>";
      h += "<hr/>";
      h += '<button class="danger" data-act="delete">' + svg("trash") + "Elimina<kbd>Canc</kbd></button>";
    }
    menu = document.createElement("div");
    menu.className = "fm-menu fm";
    menu.innerHTML = h;
    document.body.appendChild(menu);
    var r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
    menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
    menu.querySelectorAll("[data-act]").forEach(function (b) { bindAct(b); });
  }

  // ---------------------------------------------------------------- azioni

  var picker = document.createElement("input");
  picker.type = "file"; picker.multiple = true; picker.style.display = "none";
  picker.onchange = function () { var f = picker.files; doUpload(f); picker.value = ""; };
  el.appendChild(picker);

  function act(a) {
    closeMenu();
    var items = selEntries(), one = items.length === 1 ? items[0] : null;
    switch (a) {
      case "upload": picker.click(); break;
      case "mkdir": doNewFolder(); break;
      case "refresh": state.detail = null; clearThumbs(); refresh(true); break;
      case "clear": state.sel = {}; render(); break;
      case "selall": sorted().forEach(function (e) { state.sel[e.name] = true; }); render(); break;
      case "open": if (one) openItem(one); break;
      case "download": doDownload(items); break;
      case "rename": if (one) doRename(one); break;
      case "move": doTransfer(items, "move"); break;
      case "copy": doTransfer(items, "copy"); break;
      case "duplicate": transfer(items, state.cwd, "copy"); break;
      case "delete": doDelete(items); break;
      case "zipcwd":
        toast("Preparo lo zip…");
        authFetch("/files/zip?path=" + encodeURIComponent(state.cwd)).then(function (r) { return r.blob(); })
          .then(function (b) { saveBlob(b, (state.cwd.split("/").pop() || "files") + ".zip"); })
          .catch(function (e) { toast(errMsg(e), true); });
        break;
    }
  }
  function bindAct(b) {
    b.addEventListener("click", function (ev) { ev.stopPropagation(); if (!b.disabled) act(b.getAttribute("data-act")); });
  }

  function bind() {
    qa("[data-act]").forEach(bindAct);
    qa("[data-view]").forEach(function (b) {
      b.onclick = function () { state.view = b.getAttribute("data-view"); savePrefs(); render(); };
    });
    qa("[data-sort]").forEach(function (th) {
      th.onclick = function () {
        var k = th.getAttribute("data-sort");
        if (state.sortKey === k) state.sortDir = -state.sortDir; else { state.sortKey = k; state.sortDir = k === "name" || k === "kind" ? 1 : -1; }
        savePrefs(); render();
      };
    });
    qa("[data-nav]").forEach(function (b) { b.onclick = function () { go(b.getAttribute("data-nav")); }; });
    var qi = q("#fm-q");
    qi.oninput = function () { state.filter = qi.value; render(); };
    qi.onkeydown = function (ev) { if (ev.key === "Escape") { qi.value = ""; state.filter = ""; render(); wrap.focus(); } ev.stopPropagation(); };

    qa("[data-chk]").forEach(function (b) {
      b.onclick = function (ev) { ev.stopPropagation(); clickItem(b.getAttribute("data-chk"), { toggle: true, shiftKey: ev.shiftKey }); };
      b.ondblclick = function (ev) { ev.stopPropagation(); };
    });
    var all = q("[data-chkall]");
    if (all) all.onclick = function () {
      var list = sorted(), on = list.every(function (e) { return state.sel[e.name]; });
      state.sel = {}; if (!on) list.forEach(function (e) { state.sel[e.name] = true; }); render();
    };

    qa(".it").forEach(function (row) {
      var name = row.getAttribute("data-name");
      row.onclick = function (ev) { clickItem(name, ev); wrap.focus(); };
      row.ondblclick = function () { var e = byName(name); if (e) openItem(e); };
      row.oncontextmenu = function (ev) {
        ev.preventDefault();
        if (!state.sel[name]) { state.sel = {}; state.sel[name] = true; state.anchor = name; render(); }
        openMenu(ev.clientX, ev.clientY, false);
      };
      row.ondragstart = function (ev) {
        if (!state.sel[name]) { state.sel = {}; state.sel[name] = true; state.anchor = name; }
        ev.dataTransfer.effectAllowed = "copyMove";
        ev.dataTransfer.setData("application/x-mosaikit-files", JSON.stringify(selNames()));
        dragNames = selNames();
        // niente render durante il drag: ricreare la sorgente annullerebbe dragend
        qa(".it").forEach(function (r) { r.classList.toggle("sel", !!state.sel[r.getAttribute("data-name")]); });
      };
      row.ondragend = function () { dragNames = null; };
    });

    var main = q("#fm-main");
    main.onclick = function (ev) { if (ev.target === main || ev.target.classList.contains("fm-grid")) { state.sel = {}; render(); } };
    main.oncontextmenu = function (ev) {
      if (ev.target.closest(".it")) return;
      ev.preventDefault(); state.sel = {}; render(); openMenu(ev.clientX, ev.clientY, true);
    };

    // drag & drop: file dal desktop -> upload; elementi interni -> sposta
    var depth = 0;
    function endOsDrag() { depth = 0; main.classList.remove("dragover"); }
    main.ondragenter = function (ev) { if (isOsFiles(ev)) { depth++; main.classList.add("dragover"); } };
    main.ondragleave = function (ev) { if (isOsFiles(ev) && --depth <= 0) endOsDrag(); };
    main.ondragover = function (ev) { if (isOsFiles(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; } };
    main.ondrop = function (ev) {
      if (!isOsFiles(ev)) return;
      ev.preventDefault(); endOsDrag();
      doUpload(ev.dataTransfer.files, state.cwd);
    };
    // cartelle (righe, card, breadcrumb): upload dal desktop o spostamento interno
    qa("[data-drop]").forEach(function (t) {
      var to = t.getAttribute("data-drop");
      t.addEventListener("dragover", function (ev) {
        if (isOsFiles(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = "copy"; t.classList.add("drop"); return; }
        if (!dragNames || !canDropOn(to)) return;
        ev.preventDefault(); ev.dataTransfer.dropEffect = ev.ctrlKey || ev.altKey ? "copy" : "move"; t.classList.add("drop");
      });
      t.addEventListener("dragleave", function () { t.classList.remove("drop"); });
      t.addEventListener("drop", function (ev) {
        t.classList.remove("drop");
        if (isOsFiles(ev)) {
          ev.preventDefault(); ev.stopPropagation(); endOsDrag();
          doUpload(ev.dataTransfer.files, to);
          return;
        }
        if (!dragNames || !canDropOn(to)) return;
        ev.preventDefault(); ev.stopPropagation();
        var items = dragNames.map(byName).filter(Boolean); dragNames = null;
        transfer(items, to, ev.ctrlKey || ev.altKey ? "copy" : "move");
      });
    });
  }

  var dragNames = null;
  function isOsFiles(ev) { var t = ev.dataTransfer && ev.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, "Files") >= 0 && !dragNames; }
  function canDropOn(to) {
    if (to === state.cwd) return false;
    return dragNames.every(function (n) { var p = join(state.cwd, n); return to !== p && to.indexOf(p + "/") !== 0; });
  }

  // --------------------------------------------------------------- tastiera

  function onKey(ev) {
    if (disposed || !el.isConnected) return;
    if (lb) {
      if (ev.key === "Escape") closeLightbox();
      else if (ev.key === "ArrowLeft") lb.step(-1);
      else if (ev.key === "ArrowRight") lb.step(1);
      return;
    }
    if (dlg) { if (ev.key === "Escape") closeDialog(); return; }
    if (menu && ev.key === "Escape") { closeMenu(); return; }
    var t = ev.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (!el.contains(t) && t !== document.body) return;
    var list = sorted(), items = selEntries(), one = items.length === 1 ? items[0] : null;
    var ctrl = ev.ctrlKey || ev.metaKey;
    if (ev.key === "Escape" && items.length) { state.sel = {}; render(); }
    else if ((ev.key === "Delete" || (ev.key === "Backspace" && ctrl)) && items.length) { ev.preventDefault(); doDelete(items); }
    else if (ev.key === "F2" && one) { ev.preventDefault(); doRename(one); }
    else if (ev.key === "Enter" && one) { ev.preventDefault(); openItem(one); }
    else if (ev.key === " " && one && previewable(one)) { ev.preventDefault(); lightbox(one); }
    else if (ev.key === "Backspace" && state.cwd) { ev.preventDefault(); go(parentOf(state.cwd)); }
    else if (ctrl && ev.key.toLowerCase() === "a") { ev.preventDefault(); list.forEach(function (e) { state.sel[e.name] = true; }); render(); }
    else if (ctrl && ev.key.toLowerCase() === "f") { ev.preventDefault(); q("#fm-q").focus(); }
    else if (/^Arrow(Up|Down|Left|Right)$/.test(ev.key) && list.length) {
      var horiz = /Left|Right/.test(ev.key);
      if (horiz && state.view !== "grid") return;
      ev.preventDefault();
      var cols = 1;
      if (state.view === "grid") { var g = q(".fm-grid"); if (g) cols = getComputedStyle(g).gridTemplateColumns.split(" ").length; }
      var step = horiz ? (ev.key === "ArrowLeft" ? -1 : 1) : (ev.key === "ArrowUp" ? -cols : cols);
      var i = list.map(function (e) { return e.name; }).indexOf(state.anchor);
      var ni = i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + step));
      clickItem(list[ni].name, { shiftKey: ev.shiftKey });
      var r = wrap.querySelector('.it[data-name="' + cssEsc(list[ni].name) + '"]');
      if (r) r.scrollIntoView({ block: "nearest" });
    }
  }
  function onDocDown(ev) { if (menu && !menu.contains(ev.target)) closeMenu(); }

  document.addEventListener("keydown", onKey);
  document.addEventListener("mousedown", onDocDown);
  window.addEventListener("blur", closeMenu);

  refresh();
  wrap.focus();

  return function cleanup() {
    disposed = true;
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("mousedown", onDocDown);
    window.removeEventListener("blur", closeMenu);
    closeLightbox(); closeDialog(); closeMenu();
    toasts.remove();
    clearThumbs();
    urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (x) { /* ignore */ } });
    el.classList.remove("fm");
    el.innerHTML = "";
  };
})(api)

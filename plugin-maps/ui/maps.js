// Mosaikit plugin UI — Mappe (modello GeoLibre: codice trusted).
//
// CRUD di mappe GeoLibre con lo stesso schema di Sestante
// (src/web/src/components/MapFrame.tsx + screens/Editor.tsx):
//
// ── Il ponte usato ──────────────────────────────────────────────────────────
// GeoLibre espone due ponti postMessage. L'API embed v2 (`{v:2, type, payload}`)
// comanda la mappa ma non sa *leggere* il progetto. Il ponte di stato
// `geolibre:*`, attivo con `?embed=1`, invece lo trasporta:
//   app -> host:  geolibre:ready | geolibre:state {project} | geolibre:error
//   host -> app:  geolibre:request-state | geolibre:load-project {project}
// `geolibre:state` arriva a ogni cambiamento dello store (debounce 250 ms).
//
// ── Perché tre fasi e non "carica al ready" ─────────────────────────────────
// Un `load-project` inviato troppo presto viene applicato e poi sovrascritto
// dall'avvio dell'app: il livello compare e sparisce, e se quello stato vuoto
// si salva il lavoro e' perso. Quindi:
//   probing    — solo `request-state` (innocuo), ripetuto: la prima risposta
//                certifica che l'avvio e' concluso;
//   restoring  — `load-project` + richiesta di conferma; la conferma si fa
//                sugli id dei livelli (GeoLibre normalizza il JSON), con
//                nuovi tentativi fino a un tetto;
//   live       — solo da qui gli snapshot vengono salvati.
// Per 5 s dopo il ripristino, uno snapshot che perde i livelli ripristinati e'
// letto come sovrascrittura dell'avvio: non si salva e si ricarica.
//
// ── Persistenza ─────────────────────────────────────────────────────────────
// Come in Sestante la mappa si crea subito ("Mappa senza titolo") e poi si
// salva da sola: ogni snapshot `live` va nel campo `config` con 1 s di
// accorpamento, nome e descrizione con 700 ms. Il PUT del kernel sostituisce
// l'intera riga, quindi ogni salvataggio porta tutti i campi.
//
// ── File GeoJSON ────────────────────────────────────────────────────────────
// Per i livelli aperti dal selettore di file *di GeoLibre*, il ponte scarta la
// geometria (`metadata.localFileReloadable`): alla riapertura la mappa sarebbe
// vuota. I file si aggiungono quindi da qui, come livello `type: "geojson"`
// con la geometria incorporata nel progetto (tetto 4 MB). Il modo "per URL" di
// Sestante qui non si usa: i ticket dello storage Mosaikit scadono e GeoLibre
// hosted in https non puo' leggere da un Mosaikit in http (mixed content).
//
// api: { container, user, get/post/put/del/upload autenticati }.
// Ritorna una funzione di cleanup (il `return` iniziale la consegna all'host,
// che esegue questo file con `new Function("api", js)`).

return (function (api) {
  if (!api || !api.container) { console.error("[maps] api/container mancante"); return; }

  var RESOURCE = "maps"; // contribution.resource.name del manifest
  var TITLE = "Mappe";
  var UNTITLED = "Mappa senza titolo";

  // Istanza GeoLibre da incorporare. Hosted = zero configurazione; per una
  // istanza self-hosted (anche relativa, es. "/gis/") basta cambiare questo.
  var GEOLIBRE_URL = "https://web.geolibre.app/";
  var THEME = "dark";
  var LOCALE = "it";

  var PROBE_INTERVAL_MS = 600;
  var PROBE_MAX_ATTEMPTS = 25;
  var RESTORE_MAX_ATTEMPTS = 5;
  var CONFIRM_DELAY_MS = 500;
  var RESTORE_GUARD_MS = 5000;
  var PROJECT_SAVE_DELAY_MS = 1000;
  var META_SAVE_DELAY_MS = 700;
  var INLINE_MAX_BYTES = 4 * 1024 * 1024;

  var GEOLIBRE_ORIGIN = (function () {
    try { return new URL(GEOLIBRE_URL, window.location.href).origin; } catch (e) { return ""; }
  })();

  var el = api.container;
  el.classList.add("mskm");

  var state = {
    rows: [],
    view: "list", // "list" | "edit" | "show"
    filter: "",
  };

  // ---------- stili ----------

  var styles = document.createElement("style");
  styles.textContent = [
    ".mskm { max-width: 1280px; }",
    ".mskm h2 { font-size: 24px; font-weight: 700; letter-spacing: 0.2px; }",
    ".mskm .toolbar { display: flex; gap: 10px; align-items: center; margin: 16px 0; flex-wrap: wrap; }",
    ".mskm .filter { width: 260px; max-width: 100%; }",
    ".mskm .rowcount { font-family: var(--font-mono, monospace); font-size: 12px; color: var(--dim, #8f887a); }",
    ".mskm .tablewrap { border: 1px solid var(--line, #2a2e37); border-radius: 12px; overflow: auto; background: var(--panel, #14161b); }",
    ".mskm table { border-collapse: collapse; width: 100%; }",
    ".mskm th, .mskm td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line, #2a2e37); font-size: 13px; }",
    ".mskm tbody tr:last-child td { border-bottom: none; }",
    ".mskm th { color: var(--dim, #8f887a); font-size: 11px; font-weight: 600; letter-spacing: 0.7px; text-transform: uppercase; background: var(--panel2, #1b1e24); }",
    ".mskm td.col-id { color: var(--acc, #f0b23e); width: 1%; white-space: nowrap; font-family: var(--font-mono, monospace); font-size: 12px; }",
    ".mskm td.cfg { font-family: var(--font-mono, monospace); font-size: 11px; color: var(--dim, #8f887a); white-space: nowrap; }",
    ".mskm tbody tr.data-row:hover td { background: rgba(27, 30, 36, 0.9); }",
    ".mskm tr.norows td { text-align: center; color: var(--dim, #8f887a); padding: 28px; cursor: default; }",
    ".mskm .rowacts { white-space: nowrap; width: 1%; }",
    ".mskm .editbar { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }",
    ".mskm .mv-name { font-size: 16px; font-weight: 700; min-width: 220px; flex: 0 1 320px; }",
    ".mskm .mv-desc { flex: 1 1 260px; min-width: 160px; }",
    ".mskm .mv-title { font-size: 18px; font-weight: 700; }",
    ".mskm .saved, .mskm .bstatus { font-family: var(--font-mono, monospace); font-size: 12px; color: var(--dim, #8f887a); white-space: nowrap; }",
    ".mskm .saved.err { color: var(--err, #e0615c); }",
    ".mskm .grow { flex: 1; }",
    ".mskm .hint { font-size: 12px; color: var(--dim, #8f887a); margin: 0 0 10px; line-height: 1.5; }",
    ".mskm .gframe { width: 100%; height: calc(100vh - 230px); min-height: 400px; border: 1px solid var(--line, #2a2e37); border-radius: 12px; background: #fff; display: block; }",
    ".mskm.show .gframe { height: calc(100vh - 190px); }",
    ".mskm button.b { font-weight: 600; font-size: 13px; border-radius: 9px; padding: 8px 14px; cursor: pointer; border: 1px solid transparent; color: #221806; background: var(--acc, #f0b23e); border-color: var(--acc, #f0b23e); }",
    ".mskm button.b.ghost { background: var(--panel2, #1b1e24); border-color: var(--line, #2a2e37); color: var(--fg, #ece7db); }",
    ".mskm button.b.ghost:hover { border-color: rgba(240, 178, 62, 0.45); color: var(--acc, #f0b23e); }",
    ".mskm button.b.danger { background: var(--err, #e0615c); border-color: var(--err, #e0615c); color: #2b0f0e; }",
    ".mskm button.b:disabled { opacity: 0.55; cursor: default; }",
    ".mskm button.b.mini { padding: 5px 9px; font-size: 12px; border-radius: 7px; margin-right: 4px; }",
    ".mskm .msg { color: var(--dim, #8f887a); font-family: var(--font-mono, monospace); font-size: 12px; margin-top: 10px; min-height: 1em; }",
    ".mskm .map-msg { margin: 0 0 8px; }",
  ].join("\n");
  el.appendChild(styles);

  var root = document.createElement("div");
  el.appendChild(root);

  root.innerHTML =
    '<div class="listview">' +
    "<h2>" + TITLE + "</h2>" +
    '<div class="toolbar">' +
    '<input type="text" class="filter" placeholder="🔍 filtra…" />' +
    '<button type="button" class="b act-new">➕ Nuova mappa</button>' +
    '<span class="rowcount"></span>' +
    "</div>" +
    '<div class="tablewrap"><table><thead>' +
    "<tr><th>#</th><th>Nome</th><th>Descrizione</th><th>Livelli</th><th>Config</th><th>Azioni</th></tr>" +
    '</thead><tbody class="rows"></tbody></table></div>' +
    '<div class="msg list-msg"></div>' +
    "</div>" +
    '<div class="mapview" style="display:none">' +
    '<div class="editbar">' +
    '<button type="button" class="b ghost act-back">⬅ Lista mappe</button>' +
    '<span class="mv-title"></span>' +
    '<input type="text" class="mv-name" data-k="name" placeholder="Nome della mappa" spellcheck="false" />' +
    '<input type="text" class="mv-desc" data-k="description" placeholder="Descrizione" />' +
    '<span class="saved"></span>' +
    '<span class="grow"></span>' +
    '<span class="bstatus"></span>' +
    '<button type="button" class="b ghost act-add-data" title="Aggiunge un file GeoJSON come livello salvato con la mappa">＋ Aggiungi dati</button>' +
    '<input type="file" class="file-input" accept=".geojson,.json,application/geo+json,application/json" style="display:none" />' +
    '<button type="button" class="b ghost act-modify" style="display:none">✏ Modifica questa mappa</button>' +
    "</div>" +
    '<div class="hint edit-hint">Le modifiche si salvano da sole. Per aggiungere un file GeoJSON usa <b>＋ Aggiungi dati</b>: ' +
    "i livelli aperti dal selettore di file di GeoLibre non vengono salvati con la mappa.</div>" +
    '<div class="msg map-msg"></div>' +
    '<iframe class="gframe" title="GeoLibre" allow="fullscreen; geolocation" loading="eager"></iframe>' +
    "</div>";

  var qs = function (s) { return root.querySelector(s); };
  var frame = qs(".gframe");

  function msg(t, which) {
    var m = qs(which === "map" ? ".map-msg" : ".list-msg");
    if (m) m.textContent = t || "";
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function valOf(row, k) {
    var v = row && row.values ? row.values[k] : null;
    return v == null ? "" : String(v);
  }
  function findRow(id) {
    return state.rows.find(function (r) { return r.id === id; });
  }
  function errText(e) {
    return (e && e.message) || String(e);
  }
  function parseConfig(row) {
    var raw = valOf(row, "config");
    if (!raw.trim()) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error("[maps] config non valida nel record", e);
      return null;
    }
  }
  function newLayerId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "lyr-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  /**
   * Identificativi dei livelli, ordinati: la firma con cui si riconosce se un
   * ripristino ha attecchito. Il JSON non si puo' confrontare perche' GeoLibre
   * lo normalizza al caricamento; gli id dei livelli sopravvivono.
   */
  function layerIds(project) {
    var layers = project && project.layers;
    if (!Array.isArray(layers)) return [];
    return layers
      .map(function (l) { return l && typeof l.id === "string" ? l.id : ""; })
      .filter(Boolean)
      .sort();
  }
  function containsAll(arrived, wanted) {
    return wanted.every(function (id) { return arrived.indexOf(id) !== -1; });
  }

  // ---------- MapFrame: iframe GeoLibre + ponte di stato ----------

  var mf = {
    phase: "closed", // "closed" | "probing" | "restoring" | "live"
    project: null, // ultimo progetto noto
    restoreAttempts: 0,
    restoreTarget: [],
    guardUntil: 0,
    probeTimer: null,
    confirmTimer: null,
    onChange: null, // chiamato solo sugli snapshot da persistere (fase live)
  };

  function setBridgeStatus(t) {
    var b = qs(".bstatus");
    if (b) b.textContent = t || "";
  }

  function post(message) {
    var win = frame.contentWindow;
    if (win && GEOLIBRE_ORIGIN) win.postMessage(message, GEOLIBRE_ORIGIN);
  }

  /** Sonda innocua: chiede uno snapshot e fa conoscere al ponte la nostra origine. */
  function probe() {
    if (mf.phase !== "probing") return;
    post({ type: "geolibre:request-state" });
  }

  /** Spinge il progetto salvato e programma la richiesta di conferma. */
  function restore() {
    var project = mf.project;
    if (!project || mf.restoreAttempts >= RESTORE_MAX_ATTEMPTS) {
      // Oltre il tetto si smette di litigare con l'app: meglio una mappa vuota
      // visibile che un ciclo di ricaricamenti. Il progetto resta nel record.
      if (project) console.warn("[maps] ripristino non confermato dopo " + RESTORE_MAX_ATTEMPTS + " tentativi");
      mf.phase = "live";
      return;
    }
    mf.phase = "restoring";
    mf.restoreAttempts += 1;
    mf.restoreTarget = layerIds(project);
    post({ type: "geolibre:load-project", project: project });
    clearTimeout(mf.confirmTimer);
    mf.confirmTimer = setTimeout(function () {
      post({ type: "geolibre:request-state" });
    }, CONFIRM_DELAY_MS);
  }

  function frameSource(readOnly) {
    var url = new URL(GEOLIBRE_URL, window.location.href);
    url.searchParams.set("theme", THEME);
    url.searchParams.set("lang", LOCALE);
    url.searchParams.set("locale", LOCALE);
    // Attiva il ponte di stato: senza, il progetto non si legge ne' si ricarica.
    url.searchParams.set("embed", "1");
    if (readOnly) url.searchParams.set("layout", "viewer");
    return url.toString();
  }

  function openFrame(project, readOnly, onChange) {
    closeFrame();
    mf.phase = "probing";
    mf.project = project || null;
    mf.restoreAttempts = 0;
    mf.restoreTarget = [];
    mf.guardUntil = 0;
    mf.onChange = onChange || null;
    setBridgeStatus("connessione a GeoLibre…");

    // `geolibre:ready` arriva una volta sola e puo' sfuggire: si sonda a ripetizione.
    var attempts = 0;
    mf.probeTimer = setInterval(function () {
      attempts += 1;
      if (mf.phase !== "probing" || attempts > PROBE_MAX_ATTEMPTS) {
        clearInterval(mf.probeTimer);
        if (mf.phase === "probing") setBridgeStatus("GeoLibre non risponde: verifica rete o ad-blocker");
        return;
      }
      probe();
    }, PROBE_INTERVAL_MS);

    frame.onload = probe;
    frame.src = frameSource(readOnly);
  }

  function closeFrame() {
    clearInterval(mf.probeTimer);
    clearTimeout(mf.confirmTimer);
    mf.phase = "closed";
    mf.onChange = null;
    frame.onload = null;
    if (frame.getAttribute("src") !== "about:blank") frame.src = "about:blank";
    setBridgeStatus("");
  }

  /**
   * Inserisce un livello nel progetto vivo e lo ricarica (`load-project` e'
   * l'unico ingresso del ponte di stato). Rifiuta prima della fase `live`: il
   * progetto in mano non e' ancora quello definitivo e verrebbe sovrascritto.
   */
  function addLayer(layer) {
    if (mf.phase !== "live") return false;
    var current = mf.project || {};
    var layers = Array.isArray(current.layers) ? current.layers : [];
    var next = Object.assign({}, current, { layers: layers.concat([layer]) });
    mf.project = next;
    post({ type: "geolibre:load-project", project: next });
    // Si persiste subito: lo snapshot che tornera' lo confermera' e basta.
    if (mf.onChange) mf.onChange(next);
    return true;
  }

  function onBridgeMessage(ev) {
    // Il container e' stato smontato senza cleanup: ci si stacca da soli.
    if (!root.isConnected) { dispose(); return; }
    // Due controlli: l'origine attesa e che il messaggio venga dal nostro iframe.
    if (ev.origin !== GEOLIBRE_ORIGIN) return;
    if (ev.source !== frame.contentWindow) return;
    if (mf.phase === "closed") return;
    var data = ev.data;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;

    if (data.type === "geolibre:ready") {
      setBridgeStatus("GeoLibre connesso");
      probe();
      return;
    }
    if (data.type === "geolibre:error") {
      msg("GeoLibre: " + (data.message || "errore sconosciuto"), "map");
      return;
    }
    if (data.type !== "geolibre:state" || !("project" in data)) return;
    setBridgeStatus("GeoLibre connesso");
    var arrived = layerIds(data.project);

    if (mf.phase === "probing") {
      // Prima risposta: l'avvio dell'app e' concluso.
      var wanted = layerIds(mf.project);
      if (wanted.length > 0 && !containsAll(arrived, wanted)) {
        restore();
        return;
      }
      mf.phase = "live";
      mf.project = data.project;
      if (mf.onChange) mf.onChange(data.project);
      return;
    }

    if (mf.phase === "restoring") {
      if (containsAll(arrived, mf.restoreTarget)) {
        mf.phase = "live";
        mf.guardUntil = Date.now() + RESTORE_GUARD_MS;
        mf.project = data.project;
        // Non si persiste: e' il progetto gia' salvato.
        return;
      }
      // I nostri livelli non ci sono: l'avvio li ha sovrascritti. Si riprova.
      restore();
      return;
    }

    // live, ancora sotto sorveglianza: la perdita dei livelli appena
    // ripristinati non e' una scelta dell'utente, e' l'avvio dell'app.
    if (
      Date.now() < mf.guardUntil &&
      mf.restoreTarget.length > 0 &&
      !containsAll(arrived, mf.restoreTarget)
    ) {
      restore();
      return;
    }

    mf.project = data.project;
    if (mf.onChange) mf.onChange(data.project);
  }
  window.addEventListener("message", onBridgeMessage);

  // ---------- editor: salvataggio automatico ----------

  var ed = {
    id: null,
    name: "",
    description: "",
    project: null, // progetto da scrivere nel campo config
    pending: false, // modifica non ancora scritta sul server
    timer: null,
    inflight: null, // promessa del salvataggio in corso
  };

  function setSaved(text, isErr) {
    var s = qs(".saved");
    if (!s) return;
    s.textContent = text || "";
    s.classList.toggle("err", !!isErr);
  }

  function scheduleSave(delay) {
    if (ed.id == null) return;
    ed.pending = true;
    clearTimeout(ed.timer);
    ed.timer = setTimeout(function () { flush(); }, delay);
  }

  /**
   * Scrive la modifica in sospeso. I salvataggi sono in fila: una PUT alla
   * volta, cosi' una risposta lenta non puo' sovrascrivere uno stato piu' nuovo.
   */
  function flush() {
    clearTimeout(ed.timer);
    if (ed.inflight) {
      return ed.inflight.then(function () { return ed.pending ? flush() : undefined; });
    }
    if (!ed.pending || ed.id == null) return Promise.resolve();
    ed.pending = false;
    var id = ed.id;
    var values = {
      name: ed.name.trim() || UNTITLED,
      description: ed.description,
      config: ed.project ? JSON.stringify(ed.project) : "",
    };
    setSaved("salvataggio…");
    ed.inflight = api.put("/resources/" + RESOURCE + "/rows/" + id, { values: values })
      .then(function () {
        ed.inflight = null;
        if (ed.id === id) setSaved(ed.pending ? "salvataggio…" : "✓ salvato");
      }, function (e) {
        ed.inflight = null;
        ed.pending = true; // si ritenta al prossimo cambiamento o all'uscita
        if (ed.id === id) setSaved("salvataggio non riuscito", true);
        throw e;
      });
    return ed.inflight;
  }

  function onProjectChange(project) {
    ed.project = project;
    scheduleSave(PROJECT_SAVE_DELAY_MS);
  }

  // ---------- lista ----------

  function cfgSize(row) {
    var n = valOf(row, "config").length;
    if (!n) return "—";
    return n < 1024 ? n + " B" : (n / 1024).toFixed(1) + " KB";
  }

  function layerCount(row) {
    var p = parseConfig(row);
    return p && Array.isArray(p.layers) ? String(p.layers.length) : "—";
  }

  function renderRows() {
    var f = state.filter.trim().toLowerCase();
    var shown = state.rows.filter(function (r) {
      if (!f) return true;
      return [valOf(r, "name"), valOf(r, "description")]
        .some(function (v) { return v.toLowerCase().indexOf(f) !== -1; });
    });
    qs(".rowcount").textContent = shown.length === 1 ? "1 mappa" : shown.length + " mappe";
    var h = "";
    shown.forEach(function (r) {
      var hasCfg = !!valOf(r, "config").trim();
      h += '<tr class="data-row" data-id="' + r.id + '">';
      h += '<td class="col-id">' + r.id + "</td>";
      h += "<td>" + esc(valOf(r, "name")) + "</td>";
      h += "<td>" + esc(valOf(r, "description")) + "</td>";
      h += '<td class="cfg">' + layerCount(r) + "</td>";
      h += '<td class="cfg">' + cfgSize(r) + "</td>";
      h += '<td class="rowacts">' +
        '<button class="b ghost mini act-show" data-id="' + r.id + '"' + (hasCfg ? "" : " disabled") + ">👁 Apri</button>" +
        '<button class="b ghost mini act-edit" data-id="' + r.id + '">✏ Modifica</button>' +
        '<button class="b danger mini act-del" data-id="' + r.id + '">🗑 Elimina</button>' +
        "</td>";
      h += "</tr>";
    });
    if (!shown.length) {
      h += '<tr class="norows"><td colspan="6">nessuna mappa: creane una con ➕ Nuova mappa</td></tr>';
    }
    qs(".rows").innerHTML = h;
  }

  function load() {
    return api.get("/resources/" + RESOURCE).then(function (r) {
      state.rows = r.rows || [];
      renderRows();
    }).catch(function (e) {
      msg(errText(e));
    });
  }

  // ---------- viste ----------

  function showView(view) {
    state.view = view;
    var isList = view === "list";
    var isShow = view === "show";
    qs(".listview").style.display = isList ? "" : "none";
    qs(".mapview").style.display = isList ? "none" : "";
    el.classList.toggle("show", isShow);
    qs(".mv-title").style.display = isShow ? "" : "none";
    qs(".mv-name").style.display = isShow ? "none" : "";
    qs(".mv-desc").style.display = isShow ? "none" : "";
    qs(".saved").style.display = isShow ? "none" : "";
    qs(".act-add-data").style.display = isShow ? "none" : "";
    qs(".edit-hint").style.display = isShow ? "none" : "";
    qs(".act-modify").style.display = isShow ? "" : "none";
  }

  function openEdit(id) {
    var row = findRow(id);
    if (!row) return;
    var project = parseConfig(row);
    if (valOf(row, "config").trim() && !project) {
      msg("la configurazione salvata non e' JSON valido: la mappa si apre vuota, e al primo salvataggio verra' sostituita");
    }
    ed.id = id;
    ed.name = valOf(row, "name");
    ed.description = valOf(row, "description");
    ed.project = project;
    ed.pending = false;
    qs(".mv-name").value = ed.name;
    qs(".mv-desc").value = ed.description;
    setSaved("✓ salvato");
    msg("", "map");
    showView("edit");
    openFrame(project, false, onProjectChange);
  }

  function openShow(id) {
    var row = findRow(id);
    if (!row) return;
    var project = parseConfig(row);
    if (!project) { msg("questa mappa non ha una configurazione salvata: usa Modifica"); return; }
    ed.id = id;
    ed.pending = false;
    qs(".mv-title").textContent = valOf(row, "name");
    msg("", "map");
    showView("show");
    // Sola lettura: nessun salvataggio.
    openFrame(project, true, null);
  }

  /** Crea subito la mappa, come Sestante, e apre l'editor. */
  function createMap() {
    msg("");
    var btn = qs(".act-new");
    btn.disabled = true;
    api.post("/resources/" + RESOURCE + "/rows", { values: { name: UNTITLED, description: "", config: "" } })
      .then(function (r) {
        return load().then(function () {
          openEdit(r.created);
          var name = qs(".mv-name");
          name.focus();
          name.select();
        });
      })
      .catch(function (e) { msg(errText(e)); })
      .then(function () { btn.disabled = false; });
  }

  /** Alla chiusura la modifica in sospeso va scritta, non buttata. */
  function backToList() {
    var leave = function () {
      closeFrame();
      ed.id = null;
      showView("list");
      return load();
    };
    if (state.view !== "edit") return leave();
    closeFrame(); // nessuno snapshot nuovo mentre si salva
    return flush().then(leave, function (e) {
      if (confirm("Salvataggio non riuscito (" + errText(e) + ").\nTornare comunque alla lista perdendo le ultime modifiche?")) {
        ed.pending = false;
        return leave();
      }
      // Si resta nell'editor: si riapre la mappa dall'ultimo stato noto.
      openFrame(ed.project, false, onProjectChange);
    });
  }

  function del(id) {
    var row = findRow(id);
    if (!row) return;
    if (!confirm("Eliminare la mappa \"" + valOf(row, "name") + "\" (#" + id + ")?")) return;
    msg("");
    api.del("/resources/" + RESOURCE + "/rows/" + id)
      .then(function () { msg("mappa eliminata"); return load(); })
      .catch(function (e) { msg(errText(e)); });
  }

  // ---------- dati GeoJSON ----------

  var GEOJSON_TYPES = ["FeatureCollection", "Feature", "GeometryCollection", "Point", "MultiPoint",
    "LineString", "MultiLineString", "Polygon", "MultiPolygon"];

  function isGeoJson(v) {
    return !!v && typeof v === "object" && typeof v.type === "string" && GEOJSON_TYPES.indexOf(v.type) !== -1;
  }

  /**
   * Livello GeoLibre da un GeoJSON. `type` deve valere esattamente "geojson"
   * (non il tipo geometrico): altrimenti il livello compare in legenda ma non
   * viene mai disegnato. `metadata` resta vuoto di proposito: i contrassegni
   * `localFileReloadable`/`externalNativeLayer` farebbero scartare la geometria.
   * Lo stile e' minimo: GeoLibre completa il resto alla normalizzazione.
   */
  function buildLayer(id, name, geojson) {
    return {
      id: id,
      name: name,
      type: "geojson",
      source: { type: "geojson" },
      geojson: geojson,
      visible: true,
      opacity: 1,
      style: {
        minZoom: 0,
        maxZoom: 24,
        fillColor: "#3b82f6",
        strokeColor: "#1e40af",
        strokeWidth: 2,
        fillOpacity: 0.6,
        circleRadius: 6,
      },
      metadata: {},
    };
  }

  function onFileChosen(file) {
    if (!file || state.view !== "edit") return;
    msg("", "map");
    if (mf.phase !== "live") { msg("la mappa non e' ancora pronta: riprova fra un istante", "map"); return; }
    if (file.size > INLINE_MAX_BYTES) {
      msg("file troppo grande: oltre 4 MB la geometria non puo' essere salvata dentro la mappa", "map");
      return;
    }
    var btn = qs(".act-add-data");
    btn.disabled = true;
    file.text().then(function (text) {
      var parsed;
      try { parsed = JSON.parse(text); } catch (e) { msg("il file non e' JSON valido", "map"); return; }
      if (!isGeoJson(parsed)) { msg("il file non e' un GeoJSON", "map"); return; }
      var label = file.name.replace(/\.[^.]+$/, "") || file.name;
      if (!addLayer(buildLayer(newLayerId(), label, parsed))) {
        msg("la mappa non e' ancora pronta: riprova fra un istante", "map");
        return;
      }
      msg("livello \"" + label + "\" aggiunto", "map");
    }).catch(function (e) {
      msg(errText(e), "map");
    }).then(function () {
      btn.disabled = false;
      // Senza questo, riscegliere lo stesso file non emette `change`.
      qs(".file-input").value = "";
    });
  }

  // ---------- eventi ----------

  qs(".filter").oninput = function () {
    state.filter = this.value;
    renderRows();
  };
  qs(".act-new").onclick = createMap;
  qs(".act-back").onclick = backToList;
  qs(".act-modify").onclick = function () { openEdit(ed.id); };
  qs(".act-add-data").onclick = function () { qs(".file-input").click(); };
  qs(".file-input").onchange = function () { onFileChosen(this.files && this.files[0]); };
  qs(".mv-name").oninput = function () { ed.name = this.value; scheduleSave(META_SAVE_DELAY_MS); };
  qs(".mv-desc").oninput = function () { ed.description = this.value; scheduleSave(META_SAVE_DELAY_MS); };

  qs(".rows").onclick = function (ev) {
    var b = ev.target.closest("button[data-id]");
    if (!b || b.disabled) return;
    var id = Number(b.getAttribute("data-id"));
    if (b.classList.contains("act-show")) openShow(id);
    else if (b.classList.contains("act-edit")) openEdit(id);
    else if (b.classList.contains("act-del")) del(id);
  };

  // Chiusura della pagina: si tenta di scrivere la modifica in sospeso.
  function onPageHide() { flush().catch(function () {}); }
  window.addEventListener("pagehide", onPageHide);

  // ---------- avvio ----------

  showView("list");
  load();

  var disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("message", onBridgeMessage);
    window.removeEventListener("pagehide", onPageHide);
    clearInterval(mf.probeTimer);
    clearTimeout(mf.confirmTimer);
    mf.phase = "closed";
    mf.onChange = null;
    flush().catch(function () {});
  }

  return function cleanup() {
    dispose();
    el.innerHTML = "";
  };
})(api);

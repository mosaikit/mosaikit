// Mosaikit plugin UI — Siti statici (modello GeoLibre: codice trusted).
// Un sito e' uno zip con index.html: lo zip viene estratto dall'host nello
// storage del plugin (permesso storage.files, una cartella per sito) e il
// record CRUD ne conserva nome, cartella e pagina iniziale. "Apri" chiede un
// ticket di lettura e mostra il sito in un iframe sandboxato nell'area content.
// Flussi: lista / nuovo (nome + zip) / modifica (nome e/o zip) / apri / elimina.
// api: { container, user, get/post/put/del/upload autenticati }.
// Ritorna una funzione di cleanup.

(function (api) {
  if (!api || !api.container) { console.error("[sites] api/container mancante"); return; }

  var RESOURCE = "sites"; // contribution.resource.name del manifest
  var PLUGIN_ID = "com.mosaikit.static-site";
  var STORAGE = "/plugins/" + encodeURIComponent(PLUGIN_ID) + "/storage";
  var TITLE = "Siti statici";
  var KEYS = ["name", "storage", "entry", "zip_name", "files", "size", "updated"];

  var el = api.container;
  el.classList.add("msks");

  var state = {
    rows: [],
    view: "list", // "list" | "edit" | "show"
    editId: null, // id riga in edit/show; null = nuovo sito
    file: null,   // zip scelto nel form
    filter: "",
    busy: false,
    siteUrl: "",
  };

  var styles = document.createElement("style");
  styles.textContent = [
    ".msks { max-width: 1180px; }",
    ".msks h2 { font-size: 24px; font-weight: 700; letter-spacing: 0.2px; }",
    ".msks .toolbar { display: flex; gap: 10px; align-items: center; margin: 16px 0; flex-wrap: wrap; }",
    ".msks .filter { width: 260px; max-width: 100%; }",
    ".msks .rowcount { font-family: var(--font-mono, monospace); font-size: 12px; color: var(--dim, #8f887a); }",
    ".msks .tablewrap { border: 1px solid var(--line, #2a2e37); border-radius: 12px; overflow: auto; background: var(--panel, #14161b); }",
    ".msks table { border-collapse: collapse; width: 100%; }",
    ".msks th, .msks td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line, #2a2e37); font-size: 13px; }",
    ".msks tbody tr:last-child td { border-bottom: none; }",
    ".msks th { color: var(--dim, #8f887a); font-size: 11px; font-weight: 600; letter-spacing: 0.7px; text-transform: uppercase; background: var(--panel2, #1b1e24); }",
    ".msks td.col-id { color: var(--acc, #f0b23e); width: 1%; white-space: nowrap; font-family: var(--font-mono, monospace); font-size: 12px; }",
    ".msks td.mono { font-family: var(--font-mono, monospace); font-size: 11px; color: var(--dim, #8f887a); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".msks td.num { white-space: nowrap; font-variant-numeric: tabular-nums; }",
    ".msks td a.open { color: var(--fg, #ece7db); font-weight: 600; text-decoration: none; cursor: pointer; }",
    ".msks td a.open:hover { color: var(--acc, #f0b23e); }",
    ".msks tbody tr.data-row:hover td { background: rgba(27, 30, 36, 0.9); }",
    ".msks tr.norows td { text-align: center; color: var(--dim, #8f887a); padding: 28px; cursor: default; }",
    ".msks .rowacts { white-space: nowrap; width: 1%; }",
    ".msks .editbar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }",
    ".msks .sv-title { font-size: 18px; font-weight: 700; }",
    ".msks .grow { flex: 1; }",
    ".msks .siteform { max-width: 660px; background: var(--panel, #14161b); border: 1px solid var(--line, #2a2e37); border-radius: 16px; padding: 20px 24px; box-shadow: 0 14px 40px rgba(0, 0, 0, 0.35); }",
    ".msks .frow { margin-bottom: 14px; }",
    ".msks .frow label { display: block; font-size: 12px; color: var(--dim, #8f887a); margin-bottom: 5px; }",
    ".msks .frow.required label { color: var(--fg, #ece7db); font-weight: 600; }",
    ".msks .req { color: var(--err, #e0615c); }",
    ".msks .frow label.drop { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 22px 16px; border: 1.5px dashed var(--line, #2a2e37); border-radius: 12px; background: var(--panel2, #1b1e24); cursor: pointer; text-align: center; transition: border-color 0.15s, background 0.15s; }",
    ".msks .drop:hover, .msks .drop.over { border-color: var(--acc, #f0b23e); background: var(--acc-soft, rgba(240, 178, 62, 0.08)); }",
    ".msks .drop .big { font-size: 26px; line-height: 1; }",
    ".msks .drop .fname { font-family: var(--font-mono, monospace); font-size: 12px; color: var(--acc, #f0b23e); }",
    ".msks .drop .sub { font-size: 12px; color: var(--dim, #8f887a); }",
    ".msks .drop input { display: none; }",
    ".msks .hint { font-size: 12px; color: var(--dim, #8f887a); margin: 6px 0 0; line-height: 1.5; }",
    ".msks .hint code { font-family: var(--font-mono, monospace); font-size: 11px; background: var(--panel2, #1b1e24); border: 1px solid var(--line, #2a2e37); border-radius: 5px; padding: 1px 5px; color: var(--acc, #f0b23e); }",
    ".msks .form-actions { display: flex; gap: 10px; margin-top: 18px; }",
    ".msks .sframe { width: 100%; height: calc(100vh - 200px); min-height: 420px; border: 1px solid var(--line, #2a2e37); border-radius: 12px; background: #fff; display: block; }",
    ".msks button.b, .msks a.b { font-weight: 600; font-size: 13px; border-radius: 9px; padding: 8px 14px; cursor: pointer; border: 1px solid transparent; color: #221806; background: var(--acc, #f0b23e); border-color: var(--acc, #f0b23e); text-decoration: none; display: inline-block; }",
    ".msks button.b.ghost, .msks a.b.ghost { background: var(--panel2, #1b1e24); border-color: var(--line, #2a2e37); color: var(--fg, #ece7db); }",
    ".msks button.b.ghost:hover, .msks a.b.ghost:hover { border-color: rgba(240, 178, 62, 0.45); color: var(--acc, #f0b23e); }",
    ".msks button.b.danger { background: var(--err, #e0615c); border-color: var(--err, #e0615c); color: #2b0f0e; }",
    ".msks button.b:disabled { opacity: 0.55; cursor: default; }",
    ".msks button.b.mini { padding: 5px 9px; font-size: 12px; border-radius: 7px; margin-right: 4px; }",
    ".msks .msg { color: var(--dim, #8f887a); font-family: var(--font-mono, monospace); font-size: 12px; margin-top: 10px; min-height: 1em; }",
    ".msks .msg.err { color: var(--err, #e0615c); }",
  ].join("\n");
  el.appendChild(styles);

  var root = document.createElement("div");
  el.appendChild(root);

  root.innerHTML =
    '<div class="listview">' +
    "<h2>" + TITLE + "</h2>" +
    '<div class="toolbar">' +
    '<input type="text" class="filter" placeholder="🔍 filtra…" />' +
    '<button type="button" class="b act-new">➕ Nuovo sito</button>' +
    '<span class="rowcount"></span>' +
    "</div>" +
    '<div class="tablewrap"><table><thead>' +
    "<tr><th>#</th><th>Nome</th><th>Pagina iniziale</th><th>File</th><th>Dimensione</th><th>Aggiornato</th><th>Azioni</th></tr>" +
    '</thead><tbody class="rows"></tbody></table></div>' +
    '<div class="msg list-msg"></div>' +
    "</div>" +
    '<div class="siteview" style="display:none">' +
    '<div class="editbar">' +
    '<button type="button" class="b ghost act-back">⬅ Lista siti</button>' +
    '<span class="sv-title"></span>' +
    '<span class="grow"></span>' +
    '<span class="show-only">' +
    '<button type="button" class="b ghost act-reload" title="Ricarica il sito">↻ Ricarica</button> ' +
    '<a class="b ghost act-tab" target="_blank" rel="noopener noreferrer" title="Apri in una nuova scheda">↗ Nuova scheda</a> ' +
    '<button type="button" class="b ghost act-modify">✏ Modifica</button>' +
    "</span>" +
    "</div>" +
    '<div class="siteform">' +
    '<div class="frow required"><label for="msks-name">Nome <b class="req">*</b></label>' +
    '<input id="msks-name" type="text" class="in-name" placeholder="es. Documentazione progetto" /></div>' +
    '<div class="frow zip-row"><label>Archivio zip <b class="req zip-req">*</b></label>' +
    '<label class="drop">' +
    '<input type="file" class="in-zip" accept=".zip,application/zip,application/x-zip-compressed" />' +
    '<span class="big">📦</span>' +
    '<span class="fname"></span>' +
    '<span class="sub">trascina qui lo zip oppure clicca per sceglierlo</span>' +
    "</label>" +
    '<div class="hint zip-hint"></div>' +
    "</div>" +
    '<div class="form-actions">' +
    '<button type="button" class="b act-save">💾 Salva</button>' +
    '<button type="button" class="b ghost act-cancel">Annulla</button>' +
    "</div>" +
    '<div class="msg form-msg"></div>' +
    "</div>" +
    '<iframe class="sframe" title="Sito statico" sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads"></iframe>' +
    "</div>";

  var qs = function (s) { return root.querySelector(s); };
  function msg(t, which, isErr) {
    var m = qs(which === "form" ? ".form-msg" : ".list-msg");
    if (!m) return;
    m.textContent = t;
    m.classList.toggle("err", !!isErr);
  }
  function errOf(e) { return e && e.message ? e.message : String(e); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function valOf(row, k) {
    var v = row.values[k];
    return v == null ? "" : String(v);
  }
  function findRow(id) {
    return state.rows.find(function (r) { return r.id === id; });
  }
  function fmtSize(n) {
    n = Number(n);
    if (!n && n !== 0) return "—";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }
  function now() {
    var d = new Date();
    var p = function (x) { return (x < 10 ? "0" : "") + x; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  // ---------- storage del plugin ----------

  function newStorageKey() {
    return "site-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  // index.html meno profondo: copre sia zip "piatti" sia zip di una cartella
  function findEntry(files) {
    var c = files.map(function (f) { return f.path; }).filter(function (p) {
      return p.split("/").pop().toLowerCase() === "index.html";
    });
    c.sort(function (a, b) { return a.split("/").length - b.split("/").length || a.length - b.length; });
    return c[0] || "";
  }

  function removeStorage(key) {
    if (!key) return Promise.resolve();
    return api.post(STORAGE + "/delete", { path: key }).catch(function () { /* gia' assente */ });
  }

  // estrae lo zip in una cartella NUOVA: il sito precedente resta intatto
  // finche' il record non punta alla nuova cartella
  function uploadZip(file) {
    var key = newStorageKey();
    return api.upload(STORAGE + "/unzip?path=" + encodeURIComponent(key), file).then(function (r) {
      var entry = findEntry(r.files || []);
      if (!entry) {
        return removeStorage(key).then(function () {
          throw new Error("lo zip non contiene un file index.html");
        });
      }
      return { storage: key, entry: entry, zip_name: file.name, files: String(r.count || 0), size: String(r.size || 0) };
    });
  }

  // ---------- lista ----------

  function renderRows() {
    var f = state.filter.trim().toLowerCase();
    var shown = state.rows.filter(function (r) {
      if (!f) return true;
      return [valOf(r, "name"), valOf(r, "entry"), valOf(r, "zip_name")]
        .some(function (v) { return v.toLowerCase().indexOf(f) !== -1; });
    });
    qs(".rowcount").textContent = shown.length + (shown.length === 1 ? " sito" : " siti");
    var h = "";
    shown.forEach(function (r) {
      var ok = !!(valOf(r, "storage") && valOf(r, "entry"));
      h += '<tr class="data-row">';
      h += '<td class="col-id">' + r.id + "</td>";
      h += "<td>" + (ok
        ? '<a class="open" data-id="' + r.id + '" title="Apri il sito">' + esc(valOf(r, "name")) + "</a>"
        : esc(valOf(r, "name"))) + "</td>";
      h += '<td class="mono" title="' + esc(valOf(r, "zip_name")) + '">' + (ok ? esc(valOf(r, "entry")) : "zip da ricaricare") + "</td>";
      h += '<td class="num">' + esc(valOf(r, "files") || "—") + "</td>";
      h += '<td class="num">' + (valOf(r, "size") ? fmtSize(valOf(r, "size")) : "—") + "</td>";
      h += '<td class="num">' + esc(valOf(r, "updated") || "—") + "</td>";
      h += '<td class="rowacts">' +
        '<button class="b ghost mini act-show" data-id="' + r.id + '"' + (ok ? "" : " disabled") + ">👁 Apri</button>" +
        '<button class="b ghost mini act-edit" data-id="' + r.id + '">✏ Modifica</button>' +
        '<button class="b danger mini act-del" data-id="' + r.id + '">🗑 Elimina</button>' +
        "</td>";
      h += "</tr>";
    });
    if (!shown.length) {
      h += '<tr class="norows"><td colspan="7">' +
        (state.rows.length ? "nessun sito corrisponde al filtro" : "nessun sito: caricane uno con ➕ Nuovo sito") +
        "</td></tr>";
    }
    qs(".rows").innerHTML = h;
  }

  function load() {
    return api.get("/resources/" + RESOURCE).then(function (r) {
      state.rows = r.rows || [];
      renderRows();
    }).catch(function (e) {
      msg(errOf(e), "list", true);
    });
  }

  // ---------- cambio vista ----------

  function showView(view) {
    state.view = view;
    qs(".listview").style.display = view === "list" ? "" : "none";
    qs(".siteview").style.display = view === "list" ? "none" : "";
    qs(".siteform").style.display = view === "edit" ? "" : "none";
    qs(".sframe").style.display = view === "show" ? "" : "none";
    qs(".show-only").style.display = view === "show" ? "" : "none";
    if (view !== "show") {
      qs(".sframe").src = "about:blank";
      state.siteUrl = "";
    }
  }

  function setFile(file) {
    state.file = file || null;
    qs(".drop .fname").textContent = state.file ? state.file.name + " (" + fmtSize(state.file.size) + ")" : "";
  }

  function setBusy(b) {
    state.busy = b;
    qs(".act-save").disabled = b;
    qs(".act-cancel").disabled = b;
  }

  function openEdit(id) {
    var row = id != null ? findRow(id) : null;
    state.editId = row ? id : null;
    qs(".sv-title").textContent = row ? "Modifica: " + valOf(row, "name") : "Nuovo sito";
    qs(".in-name").value = row ? valOf(row, "name") : "";
    qs(".in-zip").value = "";
    setFile(null);
    qs(".zip-req").style.display = row && valOf(row, "storage") ? "none" : "";
    qs(".zip-hint").innerHTML = row && valOf(row, "storage")
      ? "Lascia vuoto per mantenere il sito attuale (<code>" + esc(valOf(row, "zip_name") || valOf(row, "entry")) +
        "</code>, " + esc(valOf(row, "files")) + " file). Un nuovo zip sostituisce tutti i file del sito."
      : "Lo zip deve contenere un <code>index.html</code>, anche dentro una cartella: viene usato quello meno annidato. " +
        "Usa link relativi (<code>css/style.css</code>, non <code>/css/style.css</code>).";
    msg("", "form");
    setBusy(false);
    showView("edit");
    qs(".in-name").focus();
  }

  function openShow(id) {
    var row = findRow(id);
    if (!row) return;
    var storage = valOf(row, "storage");
    var entry = valOf(row, "entry");
    if (!storage || !entry) { msg("questo sito non ha file: usa Modifica per caricare lo zip", "list", true); return; }
    state.editId = id;
    msg("");
    // ticket di lettura: l'iframe non puo' inviare il token Bearer
    api.post(STORAGE + "/ticket", { path: storage }).then(function (r) {
      state.siteUrl = r.base + entry.split("/").map(encodeURIComponent).join("/");
      qs(".sv-title").textContent = valOf(row, "name");
      showView("show");
      qs(".sframe").src = state.siteUrl;
      qs(".act-tab").href = state.siteUrl;
    }).catch(function (e) {
      msg("impossibile aprire il sito: " + errOf(e), "list", true);
    });
  }

  function backToList() {
    if (state.busy) return;
    showView("list");
  }

  // ---------- azioni ----------

  function save() {
    if (state.busy) return;
    msg("", "form");
    var name = qs(".in-name").value.trim();
    var file = state.file;
    var row = state.editId != null ? findRow(state.editId) : null;
    if (!name) { msg("il nome e' obbligatorio", "form", true); return; }
    if (!file && !(row && valOf(row, "storage"))) { msg("scegli lo zip con il sito", "form", true); return; }
    if (file && !/\.zip$/i.test(file.name)) { msg("il file deve essere un .zip", "form", true); return; }

    var values = {};
    KEYS.forEach(function (k) { values[k] = row ? valOf(row, k) : ""; });
    values.name = name;
    var oldStorage = row ? valOf(row, "storage") : "";

    setBusy(true);
    msg(file ? "caricamento ed estrazione di " + file.name + "…" : "salvataggio…", "form");
    var newStorage = "";
    var p = file
      ? uploadZip(file).then(function (info) {
        newStorage = info.storage;
        Object.keys(info).forEach(function (k) { values[k] = info[k]; });
        values.updated = now();
      })
      : Promise.resolve();
    p.then(function () {
      return row
        ? api.put("/resources/" + RESOURCE + "/rows/" + row.id, { values: values })
        : api.post("/resources/" + RESOURCE + "/rows", { values: values });
    }).then(function () {
      // il record punta ai nuovi file: quelli vecchi si possono eliminare
      return newStorage && oldStorage && oldStorage !== newStorage ? removeStorage(oldStorage) : null;
    }).then(function () {
      setBusy(false);
      showView("list");
      msg(row ? "sito aggiornato" : "sito creato");
      return load();
    }).catch(function (e) {
      // record non salvato: niente file orfani
      var cleanup = newStorage ? removeStorage(newStorage) : Promise.resolve();
      cleanup.then(function () {
        setBusy(false);
        msg(errOf(e), "form", true);
      });
    });
  }

  function del(id) {
    var row = findRow(id);
    if (!row) return;
    if (!confirm("Eliminare il sito \"" + valOf(row, "name") + "\" (#" + id + ") e tutti i suoi file?")) return;
    msg("");
    api.del("/resources/" + RESOURCE + "/rows/" + id)
      .then(function () { return removeStorage(valOf(row, "storage")); })
      .then(function () { msg("sito eliminato"); return load(); })
      .catch(function (e) { msg(errOf(e), "list", true); });
  }

  // ---------- eventi ----------

  qs(".filter").oninput = function () {
    state.filter = this.value;
    renderRows();
  };
  qs(".act-new").onclick = function () { openEdit(null); };
  qs(".act-back").onclick = backToList;
  qs(".act-cancel").onclick = backToList;
  qs(".act-save").onclick = save;
  qs(".act-modify").onclick = function () { openEdit(state.editId); };
  qs(".act-reload").onclick = function () {
    if (state.siteUrl) qs(".sframe").src = state.siteUrl;
  };
  qs(".in-name").onkeydown = function (ev) { if (ev.key === "Enter") save(); };
  qs(".in-zip").onchange = function () { setFile(this.files && this.files[0]); };

  var drop = qs(".drop");
  drop.ondragover = function (ev) { ev.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = function () { drop.classList.remove("over"); };
  drop.ondrop = function (ev) {
    ev.preventDefault();
    drop.classList.remove("over");
    var f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) setFile(f);
  };

  qs(".rows").onclick = function (ev) {
    var b = ev.target.closest("[data-id]");
    if (!b || b.disabled) return;
    var id = Number(b.getAttribute("data-id"));
    if (b.classList.contains("act-show") || b.classList.contains("open")) openShow(id);
    else if (b.classList.contains("act-edit")) openEdit(id);
    else if (b.classList.contains("act-del")) del(id);
  };

  // ---------- avvio ----------

  showView("list");
  load();

  return function cleanup() {
    var f = qs(".sframe");
    if (f) f.src = "about:blank";
    el.classList.remove("msks");
    el.innerHTML = "";
  };
})(api)

// Mosaikit plugin UI — Attività (modello GeoLibre: codice trusted).
// CRUD guidato dai metadati della risorsa (porting di CrudView/FieldInput,
// prima nel frontend host). api: { container, user, get/post/put/del/upload
// autenticati }. Ritorna una funzione di cleanup.

(function (api) {
  if (!api || !api.container) { console.error("[tasks] api/container mancante"); return; }

  var RESOURCE = "tasks"; // contribution.resource.name del manifest
  var TITLE = "Attività";

  var el = api.container;
  el.classList.add("mskc");

  var state = { fields: [], rows: [], selId: null, draft: {}, filter: "" };

  var styles = document.createElement("style");
  styles.textContent = [
    ".mskc { max-width: 1080px; }",
    ".mskc h2 { font-size: 24px; font-weight: 700; letter-spacing: 0.2px; }",
    ".mskc .toolbar { display: flex; gap: 10px; align-items: center; margin: 16px 0; flex-wrap: wrap; }",
    ".mskc .filter { width: 260px; max-width: 100%; }",
    ".mskc .rowcount { font-family: var(--font-mono, monospace); font-size: 12px; color: var(--dim, #8f887a); }",
    ".mskc .tablewrap { border: 1px solid var(--line, #2a2e37); border-radius: 12px; overflow: auto; background: var(--panel, #14161b); }",
    ".mskc table { border-collapse: collapse; width: 100%; }",
    ".mskc th, .mskc td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--line, #2a2e37); font-size: 13px; }",
    ".mskc tbody tr:last-child td { border-bottom: none; }",
    ".mskc th { color: var(--dim, #8f887a); font-size: 11px; font-weight: 600; letter-spacing: 0.7px; text-transform: uppercase; background: var(--panel2, #1b1e24); }",
    ".mskc td.col-id { color: var(--acc, #f0b23e); width: 1%; white-space: nowrap; font-family: var(--font-mono, monospace); font-size: 12px; }",
    ".mskc tbody tr.data-row { cursor: pointer; }",
    ".mskc tbody tr.data-row:hover td { background: rgba(27, 30, 36, 0.9); }",
    ".mskc tbody tr.data-row.sel td { background: var(--acc-soft, rgba(240, 178, 62, 0.12)); box-shadow: inset 3px 0 0 var(--acc, #f0b23e); }",
    ".mskc tr.norows td { text-align: center; color: var(--dim, #8f887a); padding: 28px; cursor: default; }",
    ".mskc .form-panel { margin-top: 24px; max-width: 660px; background: var(--panel, #14161b); border: 1px solid var(--line, #2a2e37); border-radius: 16px; padding: 20px 24px; box-shadow: 0 14px 40px rgba(0, 0, 0, 0.35); }",
    ".mskc .form-panel h3 { font-size: 12px; color: var(--dim, #8f887a); text-transform: uppercase; letter-spacing: 0.9px; margin-bottom: 16px; }",
    ".mskc .frow { margin-bottom: 12px; }",
    ".mskc .frow label { display: block; font-size: 12px; color: var(--dim, #8f887a); margin-bottom: 5px; }",
    ".mskc .frow.required label { color: var(--fg, #ece7db); font-weight: 600; }",
    ".mskc .req { color: var(--err, #e0615c); }",
    ".mskc input.chk { width: 18px; height: 18px; accent-color: var(--acc, #f0b23e); cursor: pointer; }",
    ".mskc .form-actions { display: flex; gap: 10px; margin-top: 18px; }",
    ".mskc button.b { font-weight: 600; font-size: 13px; border-radius: 9px; padding: 8px 14px; cursor: pointer; border: 1px solid transparent; color: #221806; background: var(--acc, #f0b23e); border-color: var(--acc, #f0b23e); }",
    ".mskc button.b.ghost { background: var(--panel2, #1b1e24); border-color: var(--line, #2a2e37); color: var(--fg, #ece7db); }",
    ".mskc button.b.ghost:hover { border-color: rgba(240, 178, 62, 0.45); color: var(--acc, #f0b23e); }",
    ".mskc button.b.danger { background: var(--err, #e0615c); border-color: var(--err, #e0615c); color: #2b0f0e; }",
    ".mskc .msg { color: var(--dim, #8f887a); font-family: var(--font-mono, monospace); font-size: 12px; margin-top: 10px; min-height: 1em; }",
  ].join("\n");
  el.appendChild(styles);

  var root = document.createElement("div");
  el.appendChild(root);

  root.innerHTML =
    "<h2>" + TITLE + "</h2>" +
    '<div class="toolbar">' +
    '<input type="text" class="filter" placeholder="🔍 filtra…" />' +
    '<button type="button" class="b ghost act-new">➕ Nuovo</button>' +
    '<span class="rowcount"></span>' +
    "</div>" +
    '<div class="tablewrap"><table><thead></thead><tbody class="rows"></tbody></table></div>' +
    '<div class="form-panel">' +
    '<h3 class="form-title"></h3>' +
    '<div class="fields"></div>' +
    '<div class="form-actions">' +
    '<button type="button" class="b act-save">💾 Salva</button>' +
    '<button type="button" class="b ghost act-cancel">Annulla</button>' +
    '<button type="button" class="b danger act-del">🗑 Elimina</button>' +
    "</div>" +
    '<div class="msg"></div>' +
    "</div>";

  function qs(s) { return root.querySelector(s); }
  function msg(t) { var m = qs(".msg"); if (m) m.textContent = t; }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function valOf(row, k) {
    var v = row.values[k];
    return v == null ? "" : String(v);
  }

  function syncDraft() {
    var sel = state.rows.find(function (r) { return r.id === state.selId; });
    if (!sel) state.selId = null;
    var d = {};
    state.fields.forEach(function (f) { d[f.key] = sel ? valOf(sel, f.key) : ""; });
    state.draft = d;
  }

  function collectDraft() {
    root.querySelectorAll("[data-k]").forEach(function (inp) {
      var k = inp.getAttribute("data-k");
      state.draft[k] = inp.type === "checkbox" ? (inp.checked ? "true" : "") : inp.value;
    });
  }

  function fieldHtml(f) {
    var v = state.draft[f.key] != null ? String(state.draft[f.key]) : "";
    var id = "f-" + f.key;
    var h = '<div class="frow' + (f.required ? " required" : "") + '">' +
      "<label for=\"" + id + "\">" + esc(f.label) + (f.required ? ' <b class="req">*</b>' : "") + "</label>";
    if (f.kind === "bool") {
      h += '<input id="' + id + '" type="checkbox" class="chk" data-k="' + esc(f.key) + '"' +
        (v === "✓" || v === "true" ? " checked" : "") + " />";
    } else if (f.kind === "choice") {
      h += '<select id="' + id + '" data-k="' + esc(f.key) + '"><option value="">…</option>';
      (f.options || []).forEach(function (o) {
        h += '<option value="' + esc(o) + '"' + (o === v ? " selected" : "") + ">" + esc(o) + "</option>";
      });
      h += "</select>";
    } else if (f.kind === "number") {
      h += '<input id="' + id + '" type="number" step="any" data-k="' + esc(f.key) + '" value="' + esc(v) + '" />';
    } else if (f.kind === "date") {
      h += '<input id="' + id + '" type="date" data-k="' + esc(f.key) + '" value="' + esc(v) + '" />';
    } else if (f.multiline) {
      h += '<textarea id="' + id + '" rows="3" data-k="' + esc(f.key) + '">' + esc(v) + "</textarea>";
    } else {
      h += '<input id="' + id + '" type="text" data-k="' + esc(f.key) + '" value="' + esc(v) + '" />';
    }
    return h + "</div>";
  }

  function renderHead() {
    var h = "<tr><th>#</th>";
    state.fields.forEach(function (f) { h += "<th>" + esc(f.label) + "</th>"; });
    qs("thead").innerHTML = h + "</tr>";
  }

  function renderRows() {
    var f = state.filter.trim().toLowerCase();
    var shown = state.rows.filter(function (r) {
      if (!f) return true;
      return Object.keys(r.values).some(function (k) {
        return String(r.values[k]).toLowerCase().indexOf(f) !== -1;
      });
    });
    qs(".rowcount").textContent = shown.length + " righe";
    var tbody = qs(".rows");
    var h = "";
    shown.forEach(function (r) {
      h += '<tr class="data-row' + (r.id === state.selId ? " sel" : "") + '" data-id="' + r.id + '">';
      h += '<td class="col-id">' + r.id + "</td>";
      state.fields.forEach(function (f) { h += "<td>" + esc(valOf(r, f.key)) + "</td>"; });
      h += "</tr>";
    });
    if (!shown.length) {
      h += '<tr class="norows"><td colspan="' + (state.fields.length + 1) + '">nessuna riga</td></tr>';
    }
    tbody.innerHTML = h;
    tbody.querySelectorAll("tr.data-row").forEach(function (tr) {
      tr.onclick = function () {
        var id = Number(tr.getAttribute("data-id"));
        state.selId = state.selId === id ? null : id;
        syncDraft();
        renderRows();
        renderForm();
      };
    });
  }

  function renderForm() {
    qs(".form-title").textContent = state.selId != null ? "Modifica record #" + state.selId : "Nuovo record";
    qs(".fields").innerHTML = state.fields.map(fieldHtml).join("");
    qs(".act-del").style.display = state.selId != null ? "" : "none";
    root.querySelectorAll("[data-k]").forEach(function (inp) {
      inp.oninput = collectDraft;
      inp.onchange = collectDraft;
    });
  }

  function renderAll() {
    renderHead();
    renderRows();
    renderForm();
  }

  function load() {
    return api.get("/resources/" + RESOURCE).then(function (r) {
      state.fields = r.fields || [];
      state.rows = r.rows || [];
      syncDraft();
      renderAll();
    }).catch(function (e) {
      msg(e.message || String(e));
    });
  }

  function resetForm() {
    state.selId = null;
    syncDraft();
    renderRows();
    renderForm();
  }

  qs(".filter").oninput = function () {
    state.filter = this.value;
    renderRows();
  };
  qs(".act-new").onclick = resetForm;
  qs(".act-cancel").onclick = resetForm;
  qs(".act-save").onclick = function () {
    msg("");
    collectDraft();
    var p = state.selId != null
      ? api.put("/resources/" + RESOURCE + "/rows/" + state.selId, { values: state.draft })
      : api.post("/resources/" + RESOURCE + "/rows", { values: state.draft });
    p.then(function () { msg("salvato"); return load(); })
      .catch(function (e) { msg(e.message || String(e)); });
  };
  qs(".act-del").onclick = function () {
    if (state.selId == null) return;
    if (!confirm("Eliminare il record #" + state.selId + "?")) return;
    msg("");
    api.del("/resources/" + RESOURCE + "/rows/" + state.selId)
      .then(function () { msg("eliminato"); return load(); })
      .catch(function (e) { msg(e.message || String(e)); });
  };

  load();

  return function cleanup() { el.innerHTML = ""; };
})(api)

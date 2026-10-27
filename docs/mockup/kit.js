// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/* eslint-disable -- plain browser scripts of a static mockup: they share globals across files */

/* Mosaikit mockup: icons, small composition helpers and the page frames every screen uses.
   Everything here is fake: no request, no real data. */

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/>',
  database:
    '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  dash: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  users:
    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.7 2.5 3 5.2"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/>',
  building:
    '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"/>',
  puzzle: '<path d="M4 8h4V6a2 2 0 1 1 4 0v2h4v4h2a2 2 0 1 1 0 4h-2v4H4v-4h2a2 2 0 1 0 0-4H4z"/>',
  palette:
    '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-1.3-1.1-1.6-1.1-2.9 0-.9.7-1.5 1.6-1.5H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  sliders:
    '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14"/><path d="M12 17.2v.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  pause:
    '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  save: '<path d="M15.2 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.8z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  share:
    '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  server:
    '<rect x="3" y="4" width="18" height="7" rx="1"/><rect x="3" y="13" width="18" height="7" rx="1"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="1"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  message: '<path d="M4 5h16v11H9l-5 4z"/>',
  pie: '<path d="M21 12A9 9 0 1 1 12 3"/><path d="M12 3a9 9 0 0 1 9 9h-9z"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 18 4-6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.2-6 8-6s7 2 8 6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  pencil: '<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
  alert: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.1"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sort: '<path d="M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3"/>',
  contrast:
    '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none"/>',
  overview: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18M9 9v12"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  tree: '<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  refresh:
    '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M4 3v5h5M20 21v-5h-5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  checklist:
    '<path d="m4 6 1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17"/><path d="M11 6h9M11 12h9M11 18h9"/>',
};

function ic(name, size, cls) {
  const s = size || 16;
  return `<svg class="ic ${cls || ''}" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/* The mark of Mosaikit: four tiles on the brand colour. */
/* The symbol of Mosaikit (docs/logo): nine tiles, the one at the top right lifted out of its dashed place
   in yellow, a plugin going in. Positive (burgundy tiles) for light backgrounds, negative (cream tiles)
   for dark ones; the page shows the one for its mode, the band and the sign-in panel the negative one. */
const MARK_VIEW = '70 44 398 398';
const MARK_TILES = {
  l: ['#8A1C2B', '#A8293A', '#6E1522', '#8A1C2B', '#A8293A', '#6E1522', '#8A1C2B', '#A8293A'],
  d: ['#F3EDE2', '#E8DFCE', '#DDD2BD', '#EDE5D6', '#E2D8C4', '#F1EADD', '#DFD5C1', '#EAE2D2'],
};
function markShapes(v) {
  const c = MARK_TILES[v],
    at = [
      [82, 82],
      [204, 82],
      [82, 204],
      [204, 204],
      [326, 204],
      [82, 326],
      [204, 326],
      [326, 326],
    ];
  return `${at.map(([x, y], i) => `<rect x="${x}" y="${y}" width="104" height="104" rx="14" fill="${c[i]}"/>`).join('')}<rect x="326" y="82" width="104" height="104" rx="14" fill="none" stroke="#C9707C" stroke-width="5" stroke-dasharray="14 10"/><rect x="352" y="56" width="104" height="104" rx="14" fill="#F0B23A"/>`;
}
const MARK_SHAPES = `<svg class="lv-l" viewBox="${MARK_VIEW}" width="32" height="32">${markShapes('l')}</svg><svg class="lv-d" viewBox="${MARK_VIEW}" width="32" height="32">${markShapes('d')}</svg>`;
function brandMark(s) {
  return `<span class="bmk" style="width:${s}px;height:${s}px" role="img" aria-label="Mosaikit">${['l', 'd'].map((v) => `<svg class="lv-${v}" viewBox="${MARK_VIEW}" width="${s}" height="${s}" aria-hidden="true">${markShapes(v)}</svg>`).join('')}</span>`;
}

/* The art of the sign-in page: tiles in the corner of the band, some in the accent colour, that
   breathe slowly; deterministic on the seed. */
function mosaicArt(seed) {
  let s = seed;
  const r = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  let out = '';
  for (let i = 0; i < 96; i++) {
    const o = r(),
      acc = r() > 0.82,
      d = r() * 6;
    out += `<span class="${acc ? 'acc' : ''}" style="opacity:${acc ? 0.55 : (0.04 + o * 0.14).toFixed(2)};animation-delay:${d.toFixed(2)}s"></span>`;
  }
  return out;
}

/* ── Small helpers ───────────────────────────────────────────────────── */

const ICON_AL = {
  share: 'Share',
  more: 'More actions',
  trash: 'Delete',
  x: 'Close',
  plus: 'Add',
  pencil: 'Edit',
  copy: 'Copy',
  download: 'Download',
  upload: 'Upload',
  play: 'Run',
  refresh: 'Refresh',
  star: 'Favourite',
  back: 'Back',
  sidebar: 'Show or hide',
  mail: 'Send again',
  undo: 'Cancel',
  save: 'Save',
};
function pill(text, tone, icon) {
  return `<span class="pill ${tone || ''}">${icon ? ic(icon, 12) : ''}${text}</span>`;
}
function btn(label, opts) {
  const o = opts || {};
  return `<button type="button" class="btn ${o.kind || ''}" ${o.res ? `data-res="${o.res}"` : ''} ${o.icon && label ? `aria-label="${label}" title="${label}"` : o.icon ? `aria-label="${o.al || ICON_AL[o.icon] || o.icon}" title="${o.al || ICON_AL[o.icon] || o.icon}"` : ''} ${o.go ? `data-go="${o.go}"` : ''} ${o.act ? `data-act="${o.act}"` : ''} ${o.v ? `data-v="${o.v}"` : ''}>${o.icon ? ic(o.icon, 15) : ''}${label ? `<span>${label}</span>` : ''}</button>`;
}
function tabs(list, active, key) {
  return `<nav class="tabs" role="tablist">${list.map((t) => `<button type="button" role="tab" aria-selected="${t[0] === active}" data-tab="${key}:${t[0]}">${t[1]}</button>`).join('')}</nav>`;
}
function meter(v, max, label) {
  const p = Math.round((v / max) * 100);
  return `<div class="meter"><div class="meter-l"><span>${label}</span><span class="num">${p}%</span></div><div class="meter-b"><i style="width:${p}%"></i></div></div>`;
}
function toggle(on, id) {
  return `<button type="button" class="tgl" role="switch" aria-checked="${!!on}" ${id ? `id="${id}"` : ''}><i></i></button>`;
}
function spark(vals, cls) {
  const max = Math.max(...vals),
    min = Math.min(...vals);
  const w = 120,
    h = 32;
  const pts = vals.map((v, i) => [
    (i / (vals.length - 1)) * w,
    h - 3 - ((v - min) / (max - min || 1)) * (h - 6),
  ]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return `<svg class="spark ${cls || ''}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d} L ${w} ${h} L 0 ${h} Z" class="sp-a"/><path d="${d}" class="sp-l"/><circle cx="${last[0]}" cy="${last[1]}" r="2.5" class="sp-d"/></svg>`;
}
function bars(vals, labels) {
  const max = Math.max(...vals);
  return `<div class="bars">${vals.map((v, i) => `<div class="bar"><i style="height:${Math.round((v / max) * 100)}%"></i><span>${labels[i]}</span></div>`).join('')}</div>`;
}
function fmtN(v) {
  return (Math.round(v * 10) / 10).toLocaleString('en-US');
}
function fld(label, value, o) {
  const x = o || {};
  return `<label class="lbl ${x.wide ? 'span2' : ''}">${label}<input type="${x.type || 'text'}" value="${value}" ${x.ro ? 'readonly' : ''} ${x.mono ? 'class="mono"' : ''}>${x.hint ? `<span class="hint">${x.hint}</span>` : ''}</label>`;
}
/* A widget with a trend: title, the figure, a small chart and a caption (overview of every role). */
function trendPanel(title, figure, vals, caption, cls, link) {
  return `<section class="panel widget"><div class="panel-h"><h2>${title}</h2>${link || ''}</div><div class="wd-f"><b class="num">${figure}</b><span class="muted small">${caption}</span></div>${spark(vals, cls)}</section>`;
}
/* The compact strip of apps of the Home: the sidebar already lists them, here only what is new in each. */
function appsStrip(S, apps) {
  return `<section class="apps-strip" aria-label="Your apps"><span class="muted small">Your apps</span>${apps.map((a) => `<button type="button" class="chip app-chip" data-act="appopen" data-v="${a.id}">${ic(a.ic, 15)}<b>${a.n}</b><span class="muted small">${a.cnt}</span></button>`).join('')}</section>`;
}
function kpis(list) {
  return `<div class="kpis">${list.map((k) => `<div class="kpi-t"><span class="muted small">${k[0]}</span><b class="num">${k[1]}</b><span class="small ${k[3] || 'muted'}">${k[2]}</span></div>`).join('')}</div>`;
}
function tabOf(S, key, def) {
  return (S.tab && S.tab[key]) || def;
}

/* Avatars: an uploaded image, when there is one, takes the place of the initials everywhere. */
const AV_IMG = {};
function av(ini, c, size) {
  if (AV_IMG[ini])
    return `<span class="av av-img" style="${size ? `--s:${size}px` : ''}" title="${ini}"><img src="${AV_IMG[ini]}" alt=""></span>`;
  return `<span class="av av${c || 1}" style="${size ? `--s:${size}px` : ''}" title="${ini}">${ini}</span>`;
}

/* ── Tenant marks ──────────────────────────────────────────────
   The crests are generic drawings (shield, colours, initial), never the crest of a real body:
   in the product every tenant uploads its own from Appearance. */
function crest(tn, size) {
  const s = size || 30;
  if (tn.id === 'platform') return brandMark(s);
  const pat =
    tn.pat === 'cross'
      ? `<path d="M11 3h4v20h-4z M3 9h20v4H3z" fill="${tn.mark}"/>`
      : tn.pat === 'chevron'
        ? `<path d="M3 15 13 7l10 8v4L13 11 3 19z" fill="${tn.mark}"/>`
        : `<path d="M3 9h20v5H3z" fill="${tn.mark}"/>`;
  return `<svg class="crest" width="${s}" height="${s}" viewBox="0 0 26 26" aria-hidden="true"><defs><clipPath id="cl-${tn.id}-${s}"><path d="M3 2h20v10c0 6.5-4.5 10.6-10 12C7.5 22.6 3 18.5 3 12z"/></clipPath></defs><g clip-path="url(#cl-${tn.id}-${s})"><rect width="26" height="26" fill="${tn.fill}"/>${pat}</g><path d="M3 2h20v10c0 6.5-4.5 10.6-10 12C7.5 22.6 3 18.5 3 12z" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1"/><text x="13" y="${tn.pat === 'band' ? 21.5 : 8.6}" text-anchor="middle" font-size="${tn.pat === 'band' ? 6.5 : 6}" font-weight="700" fill="${tn.pat === 'cross' ? '#ffffff' : tn.ink}" font-family="Segoe UI, system-ui, sans-serif">${tn.ini}</text></svg>`;
}
/* The width of a logo is measured on the real font, not guessed. */
const _tw = {};
function textW(font, s, spacing) {
  const k = font + '|' + s;
  if (_tw[k] == null) {
    const ctx = (textW.c = textW.c || document.createElement('canvas').getContext('2d'));
    ctx.font = font + ', sans-serif';
    _tw[k] = ctx.measureText(s).width + (spacing || 0) * s.length;
  }
  return _tw[k];
}
/* The logo of a tenant: crest and name in one image. The name uses currentColor, so the same
   logo reads on a light band and on a coloured one. */
function tenantLogo(tn, h) {
  const H = h || 34;
  if (tn.id === 'platform') {
    const w =
      37 +
      Math.max(
        textW('700 14.5px Segoe UI', 'Mosaikit'),
        textW('400 8.5px Segoe UI', 'PLATFORM', 1.4),
      ) +
      4;
    return `<svg class="tlogo" height="${H}" viewBox="0 0 ${w.toFixed(0)} 34" role="img" aria-label="${tn.name}"><g transform="translate(1 3) scale(.875)">${MARK_SHAPES}</g><text x="37" y="17" font-family="Segoe UI, system-ui, sans-serif" font-weight="700" font-size="14.5" fill="currentColor">Mosaikit</text><text x="37" y="29" font-family="Segoe UI, system-ui, sans-serif" font-size="8.5" letter-spacing="1.4" fill="currentColor" opacity=".75">PLATFORM</text></svg>`;
  }
  const w =
    38 +
    Math.max(textW('600 7.6px Segoe UI', tn.pre, 1.6), textW('700 16px Segoe UI', tn.city)) +
    4;
  return `<svg class="tlogo" height="${H}" viewBox="0 0 ${w.toFixed(0)} 34" role="img" aria-label="${tn.name}"><g transform="translate(0 1) scale(1.23)">${crest(
    tn,
    26,
  )
    .replace(/^<svg[^>]*>/, '')
    .replace(
      /<\/svg>$/,
      '',
    )}</g><text x="38" y="13" font-family="Segoe UI, system-ui, sans-serif" font-size="7.6" font-weight="600" letter-spacing="1.6" fill="currentColor" opacity=".8">${tn.pre}</text><text x="37.5" y="29" font-family="Segoe UI, system-ui, sans-serif" font-weight="700" font-size="16" fill="currentColor">${tn.city}</text></svg>`;
}

/* ── Page frames ─────────────────────────────────────────────────────── */

/* The screen id under review: the page records its tab or section while it renders. */
let SUB = null;
function setSub(x) {
  SUB = x;
}

/* Dialogs registered by the screens: id -> S => { html, wide }. */
const DIALOGS = {};

/* The filter column of resource pages: «Show» on top, then search with sorting, then the groups.
   Every group is multiple choice, except periods, which are single choice. */
const SORT_TIME = ['Newest first', 'Oldest first'];
const SORT_NAME = ['Name, A to Z', 'Name, Z to A', 'Last change', 'Date created'];
const PERIOD = [
  'Period',
  [
    ['Today', null],
    ['Last 7 days', null],
    ['Last 30 days', null, true],
    ['Always', null],
  ],
  'one',
];
function filterCol(S, key, groups, o) {
  const on = S.filtersOpen ? 'open' : '';
  const x = o || {};
  const sorts = x.sort || ['Last change', 'Date created', 'Name, A to Z', 'Name, Z to A'];
  const cur = (S.sortBy && S.sortBy[key]) || sorts[0];
  const menu =
    S.sortMenu === key
      ? `<div class="sortmenu" role="menu" aria-label="Sort by">${sorts.map((s) => `<button type="button" role="menuitemradio" aria-checked="${s === cur}" data-sort="${key}:${s}">${s === cur ? ic('check', 14) : '<i></i>'}<span>${s}</span></button>`).join('')}</div>`
      : '';
  const fq = `<div class="fq"><div class="field sm">${ic('search', 14)}<input type="search" placeholder="${x.search || 'Search'}" aria-label="${x.search || 'Search'}"></div>
      <button type="button" class="btn sortbtn ${S.sortMenu === key ? 'on' : ''}" data-act="sortmenu" data-key="${key}" aria-haspopup="menu" aria-expanded="${S.sortMenu === key}" aria-label="Sort by: ${cur}" title="Sort by: ${cur}">${ic('sort', 15)}</button>${menu}</div>`;
  const top = `<div class="facets-top">${
    x.scope
      ? `<fieldset class="facet scope"><legend>Show</legend>${x.scope
          .map((s, i) => {
            const on2 = x.scopeKey ? tabOf(S, x.scopeKey, x.scope[0][2]) === s[2] : i === 0;
            return `<label><input type="radio" name="${key}-scope" ${on2 ? 'checked' : ''} ${x.scopeKey ? `data-tab="${x.scopeKey}:${s[2]}"` : ''}><span>${s[0]}</span>${s[1] != null ? `<span class="num muted">${s[1]}</span>` : ''}</label>`;
          })
          .join('')}</fieldset>`
      : ''
  }</div>`;
  const g = (gr) =>
    `<fieldset class="facet"><legend>${gr[0]}</legend>${gr[1].map((i) => `<label><input type="${gr[2] === 'one' ? 'radio' : 'checkbox'}" name="${key}-${gr[0]}" ${i[2] ? 'checked' : ''}><span>${i[0]}</span>${i[1] != null ? `<span class="num muted">${i[1]}</span>` : ''}</label>`).join('')}</fieldset>`;
  return `<aside class="facets ${on}" aria-label="Filters">${top}<div class="facets-scroll"><div class="facets-h"><b>Filters</b><a data-act="nofilters">Reset</a></div>${fq}${(x.pre || []).concat(groups).map(g).join('')}</div></aside>`;
}
/* A detail page: a fixed 57px header with the back button, the breadcrumb, the name with its state
   badge and the actions (one primary, the others in «⋯»); the tabs under it; then the body that
   scrolls. Without «back» it is the frame of settings pages. With «side» a column of filters or
   sections sits beside the content. A crumb is [label, route, tab to open]. */
function detailPage(S, o) {
  const crumbs = o.crumbs || (o.back ? [[o.back[1].replace(/^Back to /, ''), o.back[0]]] : []);
  const crumb = crumbs.length
    ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c) => `<a data-go="${c[1]}" ${c[2] ? `data-settab="${c[2]}"` : ''}>${c[0]}</a><span aria-hidden="true">›</span>`).join('')}</nav>`
    : '';
  const shut = o.side && S.filtersHidden;
  const tg =
    o.side && !o.sideNav
      ? `<button type="button" class="ib rc-tg" data-act="filters" aria-expanded="${!shut}" aria-label="Show or hide the filters" data-tip2="${shut ? 'Show the filters' : 'Hide the filters'}">${ic('sidebar', 18)}</button>`
      : '';
  return `<div class="page wide rpage dpage ${o.back ? '' : 'noback'} ${shut ? 'fhidden' : ''}"><div class="rcontent">
    <div class="rc-h"><div class="rc-l">${o.back ? `<button type="button" class="ib rc-back" data-go="${o.back[0]}" aria-label="${o.back[1]}" title="${o.back[1]}">${ic('back', 18)}</button>` : ''}
      <div class="rh-t"><div class="rh-1">${crumb}<h1>${o.title}</h1></div>${o.sub ? `<span class="lh-n">${o.sub}</span>` : ''}</div><span class="dp-badges">${o.badges || ''}</span></div>
      <div class="dp-a">${o.actions || ''}</div></div>
    ${o.tabs ? `<div class="dp-tabs">${tg}${o.tabs}</div>` : ''}
    <div class="rc-row ${o.side ? 'dside' : ''} ${o.sideNav ? 'dside-nav' : ''}">${o.side || ''}${o.side && S.filtersOpen ? '<div class="fscrim" data-act="filters"></div>' : ''}<div class="rc-b">${o.body}</div>${o.aside || ''}</div></div></div>`;
}
/* The «⋯» of a page: the secondary actions and the change of state, out of the way. Every item is
   [icon, label, attributes, description]. */
function moreMenu(S, key, items) {
  const open = S.more === key;
  return `<span class="st-w"><button type="button" class="btn" data-act="more" data-v="${key}" aria-haspopup="menu" aria-expanded="${open}" aria-label="More actions" title="More actions">${ic('more', 15)}</button>${
    open
      ? `<div class="sortmenu stmenu moremenu" role="menu" aria-label="More actions">${items.map((i) => `<button type="button" role="menuitem" ${i[2]}>${ic(i[0], 14)}<span><b>${i[1]}</b>${i[3] ? `<span class="muted small">${i[3]}</span>` : ''}</span></button>`).join('')}</div>`
      : ''
  }</span>`;
}
/* The three kinds of setting a level inherits from the one above: managed by the platform (read
   only, with a lock), with a limit (only stricter than the platform), customizable (inherited until
   customized, then «Restore»). The same marks on every page, so that one knows what can change. */
function inhLock(who) {
  return `<span class="inh lock" title="Changed only by ${who || 'the administrator of the platform'}">${ic('lock', 12)}Managed by ${who || 'the administrator'}</span>`;
}
function inhLimit(text) {
  return `<span class="inh lim">${ic('shield', 12)}${text || 'Only stricter than the platform'}</span>`;
}
function inhCust(S, key, locked) {
  if (locked) return inhLock();
  const on = !!(S.cust && S.cust[key]);
  return `<span class="inh-w"><span class="inh ${on ? 'cust' : ''}">${ic(on ? 'pencil' : 'refresh', 12)}${on ? 'Customized' : 'Inherited from the platform'}</span>${btn(on ? 'Restore' : 'Customize', { act: 'cust', v: key })}</span>`;
}
/* Changes are saved with a bar that shows only when something changed. The fields sit in a block
   with data-dirty="key"; the first change brings the bar, Cancel puts the page back as it was. */
function saveBar(S, key) {
  if (!(S.dirty && S.dirty[key])) return '';
  return `<div class="savebar" data-savebar="${key}" role="region" aria-label="Unsaved changes">${ic('pencil', 15)}<b>Unsaved changes</b><span class="grow"></span>${btn('Cancel', { act: 'dirtyno', v: key })}${btn('Save', { kind: 'pri', icon: 'save', act: 'dirtyok', v: key })}</div>`;
}
/* Multiple selection: every item has its box; the content header has the «all» box, the count and,
   only when something is chosen, the actions on the selection. */
function selOf(S, key) {
  return (S.sel && S.sel[key]) || [];
}
function selBox(S, key, id, label) {
  const on = selOf(S, key).includes(String(id));
  return `<input type="checkbox" class="selbox" data-sel="${key}:${id}" ${on ? 'checked' : ''} aria-label="Select ${String(label).replace(/"/g, '&quot;')}">`;
}
function selTd(S, key, id, label) {
  return `<td class="cbx">${selBox(S, key, id, label)}</td>`;
}
function bulkBar(S, b) {
  const n = selOf(S, b.key).filter((id) => b.ids.map(String).includes(id)).length;
  const all = n && n === b.ids.length;
  return `<div class="bulk ${n ? 'has' : ''}"><label class="bulk-all" title="${all ? 'Clear the selection' : 'Select all'}"><input type="checkbox" class="selbox" data-selall="${b.key}" data-ids="${b.ids.join(',')}" ${all ? 'checked' : ''} ${n && !all ? 'data-ind="1"' : ''} aria-label="Select all"><span class="bulk-n num">${n ? `${n} selected` : ''}</span></label>
    ${n ? `<div class="bulk-a" role="group" aria-label="Actions on the selection">${b.acts.map((a) => `<button type="button" class="btn ${a[2] ? 'danger' : ''}" data-act="bulk" data-v="${a[1]}" data-key="${b.key}" aria-label="${a[1]}" title="${a[1]}">${ic(a[0], 15)}<span>${a[1]}</span></button>`).join('')}</div>` : ''}</div>`;
}
/* A resource page: the filter column with name and total on the left; on the right the content,
   with its own fixed header (the button that hides the column, the selection, the actions). */
function resPage(S, info, filters, content, aside) {
  const shut = S.filtersHidden;
  const create =
    (info.actions || '') +
    (info.create
      ? `<button type="button" class="btn pri" ${info.create.act ? `data-act="${info.create.act}"` : ''} ${info.create.go ? `data-go="${info.create.go}"` : ''} ${info.create.v ? `data-v="${info.create.v}"` : ''}>${ic('plus', 15)}<span>${info.create.label}</span></button>`
      : '');
  const hd = `<div class="facets-hd"><div class="rh-t"><h1>${info.title}</h1><span class="lh-n num">${info.total}</span></div></div>`;
  const tg = `<button type="button" class="ib rc-tg" data-act="filters" aria-expanded="${!shut}" aria-label="Show or hide the filters" data-tip2="${shut ? 'Show the filters' : 'Hide the filters'}">${ic('sidebar', 18)}</button>`;
  const name = `<span class="rc-name"><b>${info.title}</b><span class="muted small num">${info.total}</span></span>`;
  return `<div class="page wide rpage ${shut ? 'fhidden' : ''}"><div class="rlay">${filters.replace('aria-label="Filters">', 'aria-label="Filters">' + hd)}${S.filtersOpen ? '<div class="fscrim" data-act="filters"></div>' : ''}
    <div class="rcontent"><div class="rc-h"><div class="rc-l">${tg}${name}${info.bulk ? bulkBar(S, info.bulk) : ''}</div><div class="rc-a">${create}</div></div><div class="rc-row"><div class="rc-b">${S.bulkDone ? `<div class="banner info bdone">${ic('check', 18)}<div>${S.bulkDone}</div></div>` : ''}${content}</div>${aside || ''}</div></div></div></div>`;
}
/* A page with a column of sections, one at a time. A string among the parts is the heading of a
   group. Every part is [label, icon, html, id]; the id names the section in the screen id. */
function secNav(S, key, parts) {
  const items = parts.filter((p) => Array.isArray(p));
  const cur = Math.min(+tabOf(S, key, '0'), items.length - 1);
  let n = -1,
    og = '',
    k = -1,
    open = false;
  parts.forEach((p) => {
    if (!Array.isArray(p)) {
      og += (open ? '</optgroup>' : '') + `<optgroup label="${p}">`;
      open = true;
    } else {
      k++;
      og += `<option value="${k}" ${k === cur ? 'selected' : ''}>${p[0]}</option>`;
    }
  });
  if (open) og += '</optgroup>';
  setSub(items[cur][3] || null);
  return {
    cur,
    body: items[cur][2],
    side: `<aside class="facets secnav" aria-label="Sections"><label class="secnav-sel"><span class="sr">Section</span><select data-tabsel="${key}">${og}</select></label><nav class="secnav-l">${parts
      .map((p) => {
        if (!Array.isArray(p)) return `<div class="secnav-g">${p}</div>`;
        n++;
        return `<button type="button" data-tab="${key}:${n}" aria-current="${n === cur ? 'true' : 'false'}" class="${n === cur ? 'on' : ''}">${ic(p[1], 16)}<span>${p[0]}</span></button>`;
      })
      .join('')}</nav></aside>`,
  };
}

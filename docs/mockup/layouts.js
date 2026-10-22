// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/* eslint-disable -- plain browser scripts of a static mockup: they share globals across files */

/* Layouts (phase 10, design to verify). Three independent levels decide how the shell looks:
   the theme (colours, in the themes and the theme editor), the style (shapes, density, font, tabs,
   buttons, band image: the Style editor) and the layout (the structure). The shell is a set of
   slots: brand, tenant switcher, navigation, search, actions, breadcrumb, content. A layout only
   arranges them, and every layout works with every theme and style. Teams is the built-in frame;
   the others come from layout plugins, which are declarative: an arrangement of the slots, style
   variables, a checked stylesheet and images, never code running in the shell. */

const LAYOUTS = [
  ['teams', 'Teams', 'Top band, rail of icons with their names, panels at the side', 'layout-teams'],
  ['console', 'Console', 'Dark band with the breadcrumb, a floating sidebar with groups that open', 'layout-console'],
  ['workspace', 'Workspace', 'Top bar with a wide search, a drawer that opens and closes', 'layout-workspace'],
  ['suite', 'Suite', 'Apps from a launcher grid, the pages of the area in a bar under the band', 'layout-suite'],
  ['project', 'Project', 'Global navigation at the left, the sidebar of the area next to it', 'layout-project'],
  ['tabs', 'Tabs', 'Apps and pages as tabs under the band, a menu for the pages of an app', 'layout-tabs'],
];
const LAYOUT = (id) => LAYOUTS.find((l) => l[0] === id) || LAYOUTS[0];
/* The navigation tree: an app declares its pages in its manifest ([[nav]]), the shell draws them as
   each layout wants (groups that open, a flyout next to the rail, a menu under a tab). */
const APP_TREE = {
  'app:devices': [
    ['list', 'List'],
    ['profiles', 'Profiles'],
    ['commands', 'Commands'],
    ['schedules', 'Schedules'],
    ['firmware', 'Firmware'],
  ],
  'app:notes': [
    ['all', 'All notes'],
    ['shared', 'Shared with me'],
    ['tags', 'Tags'],
  ],
};
const GROUP_IC = { top: 'home', work: 'grid', org: 'building', platform: 'dash', bottom: 'cog' };
const STYLE0 = { radius: 'medium', density: 'comfortable', font: 'system', tabs: 'underline', buttons: 'filled', band: 'plain' };
const STYLE_OPTS = [
  ['radius', 'Corners', [['square', 'Square'], ['medium', 'Medium'], ['round', 'Round']], 'Buttons, fields, panels and the items of the navigation'],
  ['density', 'Density', [['compact', 'Compact'], ['comfortable', 'Comfortable']], 'Height of rows, buttons and fields'],
  ['font', 'Font', [['system', 'System'], ['humanist', 'Humanist'], ['serif', 'Serif']], 'Text of the whole shell; the apps receive it too'],
  ['tabs', 'Tabs', [['underline', 'Underline'], ['pill', 'Pill'], ['boxed', 'Boxed']], 'How the tab that is open shows'],
  ['buttons', 'Main buttons', [['filled', 'Filled'], ['outline', 'Outline'], ['soft', 'Soft']], 'The primary action of each page'],
  ['band', 'Band background', [['plain', 'Plain colour'], ['image', 'Image']], 'An image under the band, in the colour of the theme'],
];

/* The layout in use: the mockup's switcher wins, then the tenant's choice when the platform allows
   it, then the platform's. The administrator always sees the platform's. */
function layoutOf() {
  return S.revLayout || layoutSet();
}
/* The layout the settings give, without the mockup's switcher. */
function layoutSet() {
  const sys = S.app.sys.layout || 'teams';
  if (S.role === 'admin') return sys;
  return S.app.sys.cust.layout && S.cust && S.cust.layout ? S.app.tnt.layout || sys : sys;
}
function styleOf() {
  const sys = Object.assign({}, STYLE0, S.app.sys.style);
  if (S.role === 'admin' || !(S.app.sys.cust.style && S.cust && S.cust.style)) return sys;
  return Object.assign(sys, S.app.tnt.style);
}
function applyStyle() {
  const st = document.getElementById('stage'),
    s = styleOf();
  st.dataset.layout = layoutOf();
  ['radius', 'density', 'font', 'tabs', 'buttons', 'band'].forEach((k) => {
    st.dataset[k] = s[k];
  });
}

/* ── Slots ────────────────────────────────────────────────────────── */

function routeOf(id) {
  return ROUTES.find((r) => r[1] === id);
}
/* The breadcrumb: the area, the page and, for a detail, the screen. */
function crumbs() {
  const top = activeTop(S.route),
    r = routeOf(top),
    first = LANDING[S.role];
  const parts = [];
  if (r && r[0] !== 'top' && top !== first) parts.push(r[0] === 'bottom' ? 'Settings' : GROUP_LABEL[r[0]]);
  if (r) parts.push(r[2]);
  if (HIDDEN[S.route] && S.route !== top) parts.push(HIDDEN[S.route][0]);
  if (!r && HIDDEN[S.route]) parts.unshift(S.role === 'admin' ? 'Platform' : 'Personal');
  return `<nav class="crumbs" aria-label="Breadcrumb">${parts
    .map((p, i) => (i === parts.length - 1 ? `<b aria-current="page">${p}</b>` : `<span>${p}</span><i aria-hidden="true">/</i>`))
    .join('')}</nav>`;
}
function skipLink() {
  return `<button type="button" class="skip" data-act="skipmain">Skip to the content</button>`;
}
function burger() {
  return `<button type="button" class="ib lburger" data-act="sidetoggle" aria-expanded="${!!S.drawer}" aria-label="Open the navigation">${ic('menu', 18)}</button>`;
}
/* An app with pages: a group that opens (tree), a flyout next to the rail, a menu under a tab. */
function treeItem(r, mini) {
  const kids = APP_TREE[r[1]];
  if (!kids) return navItem(r);
  const open = !!(S.navOpen && S.navOpen[r[1]]) && !mini;
  const id = 'nt-' + r[1].replace(':', '-');
  if (mini)
    return `<button type="button" class="nv" data-act="fly" data-v="${r[1]}" aria-haspopup="menu" aria-expanded="${!!(S.fly && S.fly.k === r[1])}" data-stip="${r[2]}" aria-label="${r[2]}">${ic(r[3], 17)}<span>${r[2]}</span></button>`;
  return `<div class="nt ${open ? 'open' : ''}"><button type="button" class="nv nt-h" data-act="navtree" data-v="${r[1]}" aria-expanded="${open}" aria-controls="${id}">${ic(r[3], 17)}<span>${r[2]}</span>${ic('down', 14)}</button>${
    open
      ? `<div class="nt-c" id="${id}" role="group" aria-label="${r[2]}">${kids.map((c) => `<button type="button" class="nv nt-i" data-act="appnav" data-v="${r[2]} › ${c[1]}">${c[1]}</button>`).join('')}</div>`
      : ''
  }</div>`;
}
function treeList(groups, opts) {
  const o = opts || {};
  return `<div class="side-list">${groups
    .filter((x) => x[0] !== 'bottom')
    .map(([g, items]) => `<div class="sg sg-${g}">${g === 'top' || o.noLabels ? '' : `<div class="sg-l">${GROUP_LABEL[g]}</div>`}${items.map((r) => treeItem(r, o.mini)).join('')}</div>`)
    .join('')}</div>${groups
    .filter((x) => x[0] === 'bottom')
    .map((x) => `<div class="sg sg-bottom">${x[1].map((r) => treeItem(r, o.mini)).join('')}</div>`)
    .join('')}`;
}
function flyoutHtml() {
  if (!S.fly) return '';
  const r = routeOf(S.fly.k),
    kids = APP_TREE[S.fly.k] || [];
  return `<div class="flyout" role="menu" aria-label="${r[2]}" style="top:${S.fly.y}px;left:${S.fly.x}px"><div class="eyebrow">${r[2]}</div>${kids.map((c) => `<button type="button" role="menuitem" data-act="appnav" data-v="${r[2]} › ${c[1]}">${c[1]}</button>`).join('')}</div>`;
}
/* The band of every layout but Teams: brand, then what the layout puts there, then the actions. */
function band(cls, left, mid) {
  const B = bar();
  return `<header class="top lband ${cls}">${burger()}<div class="lb-l">${B.logo ? appLogo(false) : ''}${left || ''}</div>${mid || ''}${B.search ? searchBox() : '<span class="grow"></span>'}${topRight()}</header>`;
}

/* ── The layouts ──────────────────────────────────────────────────── */

function layoutShell(content, L) {
  const groups = navFor(S.role);
  const sideHead = `<div class="lc-ten"><div class="eyebrow">${S.role === 'admin' ? 'Platform' : 'Tenant'}</div>${tenantSwitch()}</div>`;
  const main = `<main class="main" id="main" tabindex="-1">${content}</main>`;
  const scrim = `<div class="scrim-d" data-act="drawer"></div>`;
  let html;
  if (L === 'console') {
    const mini = !!S.lcMini && innerWidth > 900;
    html = `${band('lc-band', crumbs())}<div class="body">
      <nav class="side lc-side ${mini ? 'mini' : ''}" aria-label="Navigation"><div class="lc-tools"><button type="button" class="ib" data-act="lcmini" aria-label="${mini ? 'Open the sidebar' : 'Close the sidebar'}" aria-expanded="${!mini}">${ic(mini ? 'right' : 'back', 16)}</button></div>
        ${mini ? '' : sideHead}${treeList(groups, { mini })}<div class="side-f">${quotaWidget(S)}</div></nav>${scrim}${main}</div>`;
  } else if (L === 'workspace') {
    const closed = !!S.wsClosed && innerWidth > 900;
    html = `<header class="top lband lw-band"><button type="button" class="ib lw-tg" data-act="wstoggle" aria-expanded="${!closed}" aria-label="${closed ? 'Open the navigation' : 'Close the navigation'}">${ic('menu', 18)}</button>${burger()}<div class="lb-l">${bar().logo ? appLogo(false) : ''}</div>${bar().search ? searchBox() : '<span class="grow"></span>'}<div class="lw-r">${S.role === 'admin' ? '' : tenantSwitch()}${topRight()}</div></header>
      <div class="body"><nav class="side lw-side ${closed ? 'mini' : ''}" aria-label="Navigation">${innerWidth <= 900 ? sideHead : ''}${treeList(groups, { mini: closed, noLabels: closed })}<div class="side-f">${closed ? '' : quotaWidget(S)}</div></nav>${scrim}${main}</div>`;
  } else if (L === 'suite') {
    const top = activeTop(S.route),
      g = (groups.find((x) => x[1].some((r) => r[1] === top)) || groups[0])[0];
    const sec = groups.find((x) => x[0] === g)[1];
    const appKids = [];
    html = `<header class="top lband ls-band"><button type="button" class="ib ls-ln" data-act="launcher" aria-haspopup="dialog" aria-expanded="${!!S.launcher}" aria-label="All apps and pages">${ic('grid', 18)}</button><div class="lb-l">${bar().logo ? appLogo(false) : ''}${tenantSwitch()}</div>${bar().search ? searchBox() : '<span class="grow"></span>'}${topRight()}</header>
      <nav class="ls-sub" aria-label="Pages of ${g === 'top' ? 'the start' : GROUP_LABEL[g]}"><b class="ls-area">${g === 'top' ? 'Start' : GROUP_LABEL[g]}</b>${sec
        .map((r) =>
          APP_TREE[r[1]]
            ? `<button type="button" class="ls-i" data-act="tabmenu" data-v="${r[1]}" aria-haspopup="menu" aria-expanded="${S.tabMenu === r[1]}">${ic(r[3], 15)}<span>${r[2]}</span>${ic('down', 12)}</button>`
            : r[5] === 'app'
              ? `<button type="button" class="ls-i off" data-act="offnav" data-v="${r[2]}" aria-disabled="true">${ic(r[3], 15)}<span>${r[2]}</span></button>`
              : `<button type="button" class="ls-i ${top === r[1] ? 'on' : ''}" data-go="${r[1]}" ${top === r[1] ? 'aria-current="page"' : ''}>${ic(r[3], 15)}<span>${r[2]}</span></button>`,
        )
        .concat(appKids)
        .join('')}${tabMenuHtml('ls')}</nav>
      <div class="body">${main}</div>${launcherHtml(groups)}`;
  } else if (L === 'project') {
    const top = activeTop(S.route);
    const cur = S.pGroup || (groups.find((x) => x[1].some((r) => r[1] === top)) || groups[0])[0];
    const sel = groups.find((x) => x[0] === cur) || groups[0];
    html = `${band('lp-band', crumbs())}<div class="body"><nav class="side lp-nav" aria-label="Navigation">
        <div class="lp-g" role="tablist" aria-label="Areas">${S.role === 'admin' ? `<span class="lp-me">${brandMark(28)}</span>` : `<button type="button" class="lp-me" data-act="tenants" aria-label="Tenant: ${curTenant().name}">${crest(curTenant(), 28)}</button>`}${groups
          .map(
            ([gk]) =>
              `<button type="button" role="tab" class="lp-gi ${gk === sel[0] ? 'on' : ''}" aria-selected="${gk === sel[0]}" data-act="pgroup" data-v="${gk}" title="${gk === 'top' ? 'Start' : GROUP_LABEL[gk]}">${ic(GROUP_IC[gk], 19)}<span>${gk === 'top' ? 'Start' : GROUP_LABEL[gk]}</span></button>`,
          )
          .join('')}</div>
        <div class="lp-s"><div class="lp-st">${sel[0] === 'top' ? 'Start' : GROUP_LABEL[sel[0]]}</div><div class="sg">${sel[1].map((r) => treeItem(r)).join('')}</div>${innerWidth <= 900 ? '' : `<div class="side-f">${quotaWidget(S)}</div>`}</div></nav>${scrim}${main}</div>`;
  } else {
    // Tabs: every page of the navigation is a tab under the band; an app with pages opens a menu.
    const all = groups.flatMap((x) => x[1]),
      top = activeTop(S.route);
    html = `${band('lt-band', S.role === 'admin' ? '' : tenantSwitch())}<nav class="lt-tabs" aria-label="Navigation">${all
      .map((r) =>
        APP_TREE[r[1]]
          ? `<button type="button" class="lt-t" data-act="tabmenu" data-v="${r[1]}" aria-haspopup="menu" aria-expanded="${S.tabMenu === r[1]}">${ic(r[3], 15)}<span>${r[2]}</span>${ic('down', 12)}</button>`
          : r[5] === 'app'
            ? `<button type="button" class="lt-t off" data-act="offnav" data-v="${r[2]}" aria-disabled="true">${ic(r[3], 15)}<span>${r[2]}</span></button>`
            : `<button type="button" class="lt-t ${top === r[1] ? 'on' : ''}" data-go="${r[1]}" ${top === r[1] ? 'aria-current="page"' : ''}>${ic(r[3], 15)}<span>${r[2]}</span>${r[1] === 'marketplace' ? '<em>2</em>' : ''}</button>`,
      )
      .join('')}${tabMenuHtml('lt')}</nav>
      <div class="body"><nav class="side lt-drawer" aria-label="Navigation">${sideHead}${treeList(groups)}</nav>${scrim}${main}</div>`;
  }
  return `<div class="app L L-${L} ${S.drawer ? 'drawer' : ''}">${skipLink()}${html}</div>`;
}
function tabMenuHtml(where) {
  if (!S.tabMenu || !APP_TREE[S.tabMenu]) return '';
  const r = routeOf(S.tabMenu);
  return `<div class="tabmenu ${where}" role="menu" aria-label="${r[2]}" style="left:${S.tabMenuX || 0}px;top:${S.tabMenuY || 100}px">${APP_TREE[S.tabMenu].map((c) => `<button type="button" role="menuitem" data-act="appnav" data-v="${r[2]} › ${c[1]}">${c[1]}</button>`).join('')}</div>`;
}
function launcherHtml(groups) {
  if (!S.launcher) return '';
  return `<div class="launcher" role="dialog" aria-label="All apps and pages">${groups
    .map(
      ([g, items]) =>
        `<div class="eyebrow">${g === 'top' ? 'Start' : GROUP_LABEL[g]}</div><div class="ln-g">${items
          .map((r) =>
            r[5] === 'app'
              ? `<button type="button" class="ln-t" data-act="${APP_TREE[r[1]] ? 'lnapp' : 'offnav'}" data-v="${APP_TREE[r[1]] ? r[1] : r[2]}">${ic(r[3], 22)}<span>${r[2]}</span>${APP_TREE[r[1]] ? `<em>${APP_TREE[r[1]].length} pages</em>` : ''}</button>`
              : `<button type="button" class="ln-t" data-go="${r[1]}">${ic(r[3], 22)}<span>${r[2]}</span></button>`,
          )
          .join('')}</div>`,
    )
    .join('')}</div>`;
}

/* ── Settings: Layout and Style ───────────────────────────────────── */

function layoutInstalled(id) {
  const pid = LAYOUT(id)[3];
  return id === 'teams' || MP.some((m) => m.id === pid) || (S.mpInst || []).includes(pid);
}
/* A small picture of a layout in the colours of the theme in use. */
function layoutThumb(id) {
  const p = PRESETS.find((x) => x.id === S.preset) || PRESETS[0],
    v = isDark() ? p.dark : p.light;
  const b = v.navGrad || v.nav[0],
    sd = v.side[0],
    c = v.content,
    a = v.accent[0],
    ln = v.side[5];
  const bar = (h, extra) => `<i style="height:${h}px;background:${b};${extra || ''}"></i>`;
  const lines = (n, w) => Array.from({ length: n }, (_, i) => `<i class="lt-ln" style="width:${w - i * 6}%;background:${i === 0 ? a : ln}"></i>`).join('');
  const box = (style, inner) => `<span class="lt-b" style="${style}">${inner || ''}</span>`;
  const shapes = {
    teams: `${bar(12)}<span class="lt-row">${box(`width:16%;background:${sd}`, lines(4, 70))}${box(`flex:1;background:${c}`, lines(3, 80))}</span>`,
    console: `${bar(14, 'background-image:repeating-linear-gradient(115deg,rgba(255,255,255,.12) 0 2px,transparent 2px 14px)')}<span class="lt-row" style="background:${c}">${box(`width:26%;margin:5px;border-radius:5px;background:${sd};box-shadow:0 1px 4px rgba(0,0,0,.18)`, lines(5, 80))}${box('flex:1', lines(3, 80))}</span>`,
    workspace: `${bar(12)}<span class="lt-row">${box(`width:28%;background:${c};border-right:1px solid ${ln}`, lines(5, 70))}${box(`flex:1;background:${c}`, lines(3, 80))}</span>`,
    suite: `${bar(12)}${bar(7, `background:${sd}`)}<span class="lt-row">${box(`flex:1;background:${c}`, `<span class="lt-grid">${'<i></i>'.repeat(6)}</span>`)}</span>`,
    project: `${bar(10)}<span class="lt-row">${box(`width:9%;background:${b}`)}${box(`width:22%;background:${sd}`, lines(4, 70))}${box(`flex:1;background:${c}`, lines(3, 80))}</span>`,
    tabs: `${bar(12)}<span class="lt-tabs" style="background:${sd}">${['<i class="on"></i>', '<i></i>', '<i></i>', '<i></i>'].join('')}</span><span class="lt-row">${box(`flex:1;background:${c}`, lines(3, 80))}</span>`,
  };
  return `<span class="lthumb" aria-hidden="true" style="--a:${a}">${shapes[id]}</span>`;
}
function layoutCards(lvl) {
  const sys = lvl === 'sys';
  const cur = sys ? S.app.sys.layout || 'teams' : (S.cust && S.cust.layout && S.app.tnt.layout) || S.app.sys.layout || 'teams';
  return `<div class="lcards">${LAYOUTS.filter((l) => layoutInstalled(l[0]))
    .map(
      (l) =>
        `<button type="button" class="lcard ${cur === l[0] ? 'on' : ''}" aria-pressed="${cur === l[0]}" data-act="layoutset" data-lvl="${lvl}" data-v="${l[0]}">${layoutThumb(l[0])}<span class="lc-t"><b>${l[1]}</b>${l[0] === 'teams' ? pill('Built-in') : ''}${cur === l[0] ? ic('check', 15) : ''}</span><span class="muted small">${l[2]}</span></button>`,
    )
    .join('')}${
    sys
      ? `<button type="button" class="lcard more" data-settab="mpk:cat" data-go="marketplace">${ic('plus', 20)}<b>More layouts</b><span class="muted small">From the catalog of the plugins, or a signed package of your own</span></button>`
      : ''
  }</div>`;
}
function layoutSection(lvl) {
  const sys = lvl === 'sys',
    C = S.app.sys.cust;
  const mark = sys
    ? `<label class="tc-av"><input type="checkbox" class="pchk" data-act="syscust" data-v="layout" ${C.layout ? 'checked' : ''}> Tenants may customize it</label>`
    : inhCust(S, 'layout', !C.layout);
  const cards = layoutCards(lvl);
  const locked = !sys && (!C.layout || !(S.cust && S.cust.layout));
  return `<section class="panel"><div class="panel-h"><div><h2>Layout</h2><p class="muted small">${sys ? 'Where the navigation, the band, the tenant and the actions sit, for everybody. It shows at once, as a preview; every layout works with every theme and style.' : 'The layout of this tenant, among the ones the platform installed.'}</p></div>${mark}</div>${locked ? `<div class="is-locked" inert>${cards}</div>` : cards}</section>
    <section class="panel"><h2>What a layout changes, and what it does not</h2><div class="two">
      <ul class="feats"><li class="on">${ic('check', 15)}<span>The arrangement of the slots: brand, tenant switcher, navigation, search, actions, breadcrumb</span></li><li class="on">${ic('check', 15)}<span>How the pages of an app show: groups that open, a flyout, a menu, tabs</span></li><li class="on">${ic('check', 15)}<span>Its behaviour on a phone: a drawer, a launcher, a bar that scrolls</span></li></ul>
      <ul class="feats"><li>${ic('lock', 15)}<span>Colours: they are the theme's, checked for contrast</span></li><li>${ic('lock', 15)}<span>Landmarks, the «Skip to the content» link, the order of the keyboard: the shell keeps them in every layout</span></li><li>${ic('lock', 15)}<span>What people may do: permissions do not depend on the layout</span></li></ul></div></section>`;
}
function bandChecks() {
  const p = PRESETS.find((x) => x.id === S.preset) || PRESETS[0],
    v = isDark() ? p.dark : p.light,
    bg = v.nav[0],
    fg = v.nav[1],
    muted = v.nav[2];
  const light = mix(bg, '#ffffff', 0.22);
  return [
    ['Text of the band on the brightest point of the image', contrast(fg, light), 4.5],
    ['Muted text of the band (breadcrumb) on the brightest point', contrast(muted, light), 4.5],
    ['Icons of the band on the brightest point', contrast(fg, light), 3],
  ];
}
function styleSection(lvl) {
  const sys = lvl === 'sys',
    C = S.app.sys.cust;
  const s = sys ? Object.assign({}, STYLE0, S.app.sys.style) : styleOf();
  const mark = sys
    ? `<label class="tc-av"><input type="checkbox" class="pchk" data-act="syscust" data-v="style" ${C.style ? 'checked' : ''}> Tenants may customize it</label>`
    : inhCust(S, 'style', !C.style);
  const locked = !sys && (!C.style || !(S.cust && S.cust.style));
  const rows = STYLE_OPTS.map(
    ([k, label, opts, hint]) =>
      `<div class="st-row"><div class="rt"><b>${label}</b><span>${hint}</span></div><div class="seg" role="radiogroup" aria-label="${label}">${opts
        .map((o) => `<button type="button" role="radio" aria-checked="${s[k] === o[0]}" class="btn sm ${s[k] === o[0] ? 'on' : ''}" data-act="styleset" data-lvl="${lvl}" data-k="${k}" data-v="${o[0]}"><span>${o[1]}</span></button>`)
        .join('')}</div></div>`,
  ).join('');
  const checks = s.band === 'image' ? bandChecks() : [];
  const bad = checks.filter((c) => c[1] < c[2]);
  const editor = `<div class="st-rows">${rows}</div>
      ${s.band === 'image' ? `<div class="st-img mt"><div class="st-img-p" aria-hidden="true"></div><div class="grow"><b>Image of the band</b><span class="muted small">PNG, WebP or SVG up to 512 KB. The shell lays the colour of the band over it, so that texts keep reading in every theme.</span></div>${btn('Upload an image', { icon: 'upload', act: 'toast', v: 'In the product: the image is checked like a logo and stored with the identity.' })}</div>
        <ul class="rows mt">${checks.map((c) => `<li><div class="rt grow"><b>${c[0]}</b><span>WCAG AA: at least ${c[2]}:1</span></div>${pill(c[1].toFixed(1) + ':1', c[1] >= c[2] ? 'ok' : 'bad', c[1] >= c[2] ? 'check' : 'alert')}</li>`).join('')}</ul>
        ${bad.length ? `<p class="small bad-t mt">${ic('alert', 13)} The image is too bright for this theme: the shell darkens it until the checks pass, or choose a darker image.</p>` : ''}` : ''}`;
  const sample = `<div class="st-prev" aria-label="Preview of the style">${tabs([['a', 'Details'], ['b', 'People'], ['c', 'Activity']], 'a', 'stp')}<div class="row">${btn('Save', { kind: 'pri', icon: 'save' })}${btn('Cancel')}</div><div class="field mt">${ic('search', 15)}<input type="text" placeholder="A field" aria-label="A field"></div></div>`;
  return `<section class="panel"><div class="panel-h"><div><h2>Style</h2><p class="muted small">${sys ? 'Shapes, density and font of the whole shell; the apps receive them as variables, like the colours of the theme.' : 'The style of this tenant, starting from the platform\'s.'}</p></div>${mark}</div>
      ${locked ? `<div class="is-locked" inert>${editor}</div>` : editor}</section>
    <section class="panel"><h2>Preview</h2>${sample}<p class="muted small mt">It applies at once to this mockup, with the theme in use.</p></section>`;
}

/* What a layout plugin contains (Plugins › a layout › What it contains), and what it may not do. */
function layoutContents(m) {
  const l = LAYOUTS.find((x) => x[3] === m.id) || LAYOUTS[1];
  const slots = {
    teams: [['Band', 'brand · tenant switcher · search · actions'], ['Rail at the left', 'navigation, icons with their names; pages of an app in a flyout'], ['Phone', 'drawer from the button of the band']],
    console: [['Band', 'brand · breadcrumb · search · actions, on an image'], ['Floating sidebar', 'tenant switcher · navigation with groups that open · quotas'], ['Phone', 'the sidebar becomes a drawer']],
    workspace: [['Top bar', 'button of the drawer · brand · wide search · tenant · actions'], ['Drawer', 'navigation, open or icons only'], ['Phone', 'drawer over the page']],
    suite: [['Band', 'launcher · brand · tenant · search · actions'], ['Bar of the area', 'the pages of the area in use; pages of an app in a menu'], ['Launcher', 'every app and page in a grid'], ['Phone', 'launcher and a bar that scrolls']],
    project: [['Band', 'brand · breadcrumb · search · actions'], ['Global navigation', 'tenant · the areas, as icons'], ['Sidebar of the area', 'its pages, with groups that open'], ['Phone', 'both in a drawer']],
    tabs: [['Band', 'brand · tenant · search · actions'], ['Tabs', 'every page; the pages of an app in a menu under its tab'], ['Phone', 'the tabs go into a drawer']],
  }[l[0]];
  return `<div class="two"><section class="panel"><h2>Arrangement of the slots</h2>${layoutThumb(l[0])}<dl class="kv mt">${slots.map((x) => `<dt>${x[0]}</dt><dd>${x[1]}</dd>`).join('')}</dl></section>
    <section class="panel"><h2>What is inside the package</h2><ul class="rows">${[
      ['file', 'layout.toml', 'The slots and where they go, desktop and phone'],
      ['palette', 'Style variables', 'Corners, density, font, tabs, buttons: defaults the Style editor can change'],
      ['shield', 'layout.css · checked', 'Only rules on the classes of the shell; no scripts, no outside addresses, no imports'],
      ['upload', 'Images', l[0] === 'console' ? 'Background of the band (SVG, 14 KB), checked like a logo' : 'None'],
      ['key', 'Signature', `${m.ed} · verified at installation`],
    ]
      .map((r) => `<li><span class="ri">${ic(r[0], 15)}</span><div class="rt grow"><b>${r[1]}</b><span>${r[2]}</span></div></li>`)
      .join('')}</ul></section>
    <section class="panel span2"><h2>What a layout may not do</h2><ul class="feats">${[
      'Run code in the shell: a layout is data and a checked stylesheet, the shell draws it',
      'Change colours: they come from the theme, checked for contrast in light, dark and high contrast',
      'Hide the landmarks, the «Skip to the content» link or the focus: the shell keeps them, and the checks of accessibility run on every layout',
      'Read data or change what people may do: a layout sees no item and no permission',
    ]
      .map((x) => `<li>${ic('lock', 15)}<span>${x}</span></li>`)
      .join('')}</ul></section></div>`;
}

/* ── Events ───────────────────────────────────────────────────────── */

function layoutAct(a, t) {
  const v = t.dataset.v;
  if (a === 'navtree') {
    S.navOpen = Object.assign({}, S.navOpen, { [v]: !(S.navOpen && S.navOpen[v]) });
  } else if (a === 'fly') {
    const r = t.getBoundingClientRect();
    S.fly = S.fly && S.fly.k === v ? null : { k: v, x: Math.round(r.right + 6), y: Math.round(r.top) };
  } else if (a === 'appnav') {
    S.fly = null;
    S.tabMenu = null;
    S.launcher = false;
    S.toast = `«${v}» is a page of the app, declared in its manifest: the app draws it, not this mockup.`;
  } else if (a === 'tabmenu') {
    const r = t.getBoundingClientRect();
    S.tabMenu = S.tabMenu === v ? null : v;
    S.tabMenuX = Math.round(r.left);
    S.tabMenuY = Math.round(r.bottom + 4);
  } else if (a === 'launcher') {
    S.launcher = !S.launcher;
  } else if (a === 'lnapp') {
    S.launcher = false;
    S.tabMenu = v;
    S.tabMenuX = 24;
    S.tabMenuY = 100;
  } else if (a === 'lcmini') {
    S.lcMini = !S.lcMini;
  } else if (a === 'wstoggle') {
    S.wsClosed = !S.wsClosed;
  } else if (a === 'pgroup') {
    S.pGroup = v;
  } else if (a === 'skipmain') {
    const m = document.getElementById('main');
    if (m) m.focus();
    return true;
  } else if (a === 'layoutset') {
    if (t.dataset.lvl === 'tnt') {
      S.app.tnt.layout = v;
      S.cust = Object.assign({}, S.cust, { layout: true });
    } else S.app.sys.layout = v;
    S.revLayout = null;
    S.fly = null;
    S.toast = `Layout ${LAYOUT(v)[1]}: shown at once. ${t.dataset.lvl === 'tnt' ? 'It applies to everybody in the tenant.' : 'It applies to the platform and to every tenant that did not customize it.'}`;
  } else if (a === 'styleset') {
    const lvl = t.dataset.lvl;
    if (lvl === 'tnt') {
      S.app.tnt.style = Object.assign({}, styleOf(), S.app.tnt.style, { [t.dataset.k]: v });
      S.cust = Object.assign({}, S.cust, { style: true });
    } else S.app.sys.style = Object.assign({}, STYLE0, S.app.sys.style, { [t.dataset.k]: v });
  } else return false;
  render();
  return true;
}
document.addEventListener('click', (e) => {
  if (S.fly && !e.target.closest('.flyout, [data-act="fly"]')) {
    S.fly = null;
    render();
  }
  if (S.tabMenu && !e.target.closest('.tabmenu, [data-act="tabmenu"], [data-act="lnapp"]')) {
    S.tabMenu = null;
    render();
  }
  if (S.launcher && e.target.closest('.launcher [data-go]')) S.launcher = false;
  else if (S.launcher && !e.target.closest('.launcher, [data-act="launcher"]')) {
    S.launcher = false;
    render();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.matches && e.target.matches('[data-revlayout]')) {
    S.revLayout = e.target.value || null;
    S.drawer = false;
    S.fly = null;
    S.tabMenu = null;
    S.launcher = false;
    render();
  }
});

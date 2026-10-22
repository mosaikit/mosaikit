// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/* eslint-disable -- plain browser scripts of a static mockup: they share globals across files */

/* Mosaikit mockup: the frame of the shell (top band, sidebar, menus), the generic dialogs, the
   review bar with its index and notes, and the events. Loaded last: it boots the page. */

const MOCKUP = 'mosaikit';
const ALL = ['user', 'manager', 'admin'];

const S = {
  role: 'user',
  route: 'home',
  tab: {},
  modal: null,
  notes: false,
  map: false,
  drawer: false,
  side: 'mini',
  sideLabels: false,
  mode: 'auto',
  preset: 'mosaikit',
  themeMenu: false,
  langMenu: false,
  lang: 'en',
  hc: false,
  app: {
    sys: {
      theme: 'mosaikit',
      mode: 'auto',
      side: 'mini',
      labels: false,
      langs: LANGS.map((l) => l[0]),
      lang: 'en',
      name: 'Mosaikit',
      showName: true,
      welcome: 'The workspace of your tenant',
      privacy: 'https://apps.example.org/privacy',
      legal: 'https://apps.example.org/legal',
      from: 'Mosaikit <noreply@apps.example.org>',
      footer: 'Automatic message, do not reply.',
      themes: ['mosaikit', 'tessera', 'civic', 'slate', 'forest', 'terracotta', 'aurora', 'contrast'],
      // what the top band shows, for everybody: decided by the administrator only
      bar: { logo: true, search: true, lang: true, help: true, mode: true },
      // which of its defaults the tenants may customize
      cust: { theme: true, mode: true, side: true, fmt: true },
    },
    tnt: {
      theme: 'mosaikit',
      mode: 'auto',
      side: 'mini',
      labels: false,
      langs: ['en', 'it', 'fr'],
      lang: 'en',
      name: 'Example City',
      showName: true,
      welcome: 'Welcome to the workspace of Example City',
      privacy: 'https://www.city.example.org/privacy',
      legal: 'https://www.city.example.org/legal',
      land: 'home',
      landId: '',
      fmtSame: true,
    },
  },
  customThemes: [],
  tenantMenu: false,
  tenant: null,
  helpMenu: false,
  keyEdit: null,
  keys: {
    sys: {
      'ai-hosted': { tail: 'a41f', share: true },
      'ai-second': { tail: '9c0e', share: false },
      sms: { tail: '77d2', share: true },
      translate: { tail: '1f3a', share: true },
      ocr: { tail: '0b8c', share: true },
    },
    tnt: { 'ai-second': { tail: 'd20f', share: true }, push: { tail: '4a6e', share: false } },
    me: {},
  },
};
const LANDING = { user: 'home', manager: 'space', admin: 'platform' };

/* ── Notes: what each screen is for ──────────────────────────────────── */

const DECISION = {
  idea: 'The frame of every Mosaikit installation, with one home for each thing. In the sidebar the work (the apps) and the management of the tenant or of the platform; in the menu of the person what is personal (Account, Notifications, Trash). On top, the switcher of tenants, search, language, mode, help, the bell and the person: the administrator decides which of them the band shows. Plugins are of three kinds (App, Service, Extension); the apps add their entries to the sidebar and their tiles to Home, and opened they take the whole content under the same band.',
  roles: {
    user: 'Home, then the apps installed in the tenant (greyed here: their pages belong to the apps). No settings of the tenant: what is personal is in Account. Lands on Home, a launcher of the apps.',
    manager:
      'The overview of the tenant, then the apps, then the management of the tenant: Manage, Plugins, Shares, Usage, Log; at the bottom the settings of the tenant. Lands on the overview of the tenant.',
    admin:
      'The overview of the platform, Tenants, People, Plugins, Monitoring and Log; at the bottom System. No apps: an administrator configures the platform and does not see the content of tenants. The badge «Platform» in the band says so.',
  },
  how: 'To review: pick a role at the top, open the <b>Index</b> and go through every screen and dialog. «Mark reviewed» keeps the count per role in this browser. The chip with the screen id is what a requirement cites in its <span class="mono">ui</span> field.',
};
const NOTES = {
  login:
    'Two doors. People choose their tenant from a list (hidden when there is only one tenant, or when the address names it) and sign in the way the tenant decided: username and password kept by Mosaikit, or its identity provider (OIDC), never both. Guests sign in from their own tenant and switch from the top. Administrators have their own access, always local, with the second factor (TOTP): the first time they register an authenticator app and get ten recovery codes.',
  home: 'Home is a launcher: one tile for every app of the tenant, then what to pick up again, what is due, what concerns you and what you shared. Apps fill these panels; the platform only composes them. Notes, Activities, Estimates and Tasks are sample apps.',
  inbox:
    'One place for mentions, access, due dates and alerts of every app, with the same filters as every list. The bell opens the latest; «What I receive» is in Account › Notifications.',
  account:
    'What is personal, in one page: profile, sign-in and security (with the change of one’s own password, when the account is local), notifications, appearance and language, the tenants one belongs to, one’s own usage of the quotas of the tenant, and one’s keys.',
  trash:
    'What is deleted stays 30 days and goes back to its place with one click. Apps put their items here; the platform keeps the time.',
  space:
    'The overview of the tenant puts decisions on top (access requests, invitations, services down, public shares), not counts. Each one opens where it is decided.',
  members:
    'Manage: people, groups, permission profiles, and what is pending (invitations and access requests), one section at a time from the list on the left. Profiles are where the permissions of a User start; groups can come from the identity provider of the tenant.',
  person:
    'A person in one tenant: profile, sign-in, effective permissions with where each comes from, and activity. The state is a badge next to the name, changed from «⋯»; the save bar shows only after a change. The administrator also sees every tenant of the person.',
  group:
    'A group belongs to the tenant: who is in it, what is shared with it, which permissions it adds in the plugins (read only: they are given in Plugins › Permissions).',
  splugins:
    'The Tenant Manager turns plugins on and off among the ones the administrator made available, and from each one opens Permissions, the only place where permissions are given. Apps, services and extensions, with what each extension extends.',
  module:
    'The permissions a plugin declares in its manifest, by profile, group and person. Profiles give the start; groups and people add. The only place where they are given.',
  shares:
    'Every share of the tenant: public items and links first, because they leave the tenant, then groups, the whole tenant and people. The owner decides; the Tenant Manager can take a share back.',
  usage:
    'The quotas of the tenant, read only (the administrator sets them), how they are used, who uses the most and whom to warn near a limit.',
  activity:
    'The log of the tenant: who did what, on which item, with what outcome. A click on a name or an item becomes a filter.',
  platform:
    'The health of the services of the platform at a glance, then what needs doing: updates, trials ending, failed backups.',
  tenants: 'Every tenant with people, storage, sign-in and state.',
  tenant:
    'One tenant: details, the logo (set by the Tenant Manager, shown here), its quotas (of the platform or its own), how people sign in (local accounts or an external identity provider with OIDC, never both; roles from one source only), the plugins available, and archive or delete at the bottom. The state is a badge, changed from «⋯».',
  gusers:
    'Every person of the installation: a person can belong to several tenants, with one home tenant that decides how they sign in. Administrators are separate accounts of the platform.',
  marketplace:
    'Plugins of three kinds: apps, services and extensions (which extend another plugin). Built-in ones update; the others install from the catalog or from a signed package. The administrator makes them available to tenants; the Tenant Manager turns them on and gives the permissions.',
  mpmod:
    'One plugin: what it asks of the platform, the permissions it brings, its extensions, to which tenants it is available, and its configuration.',
  monitoring:
    'Is something wrong (status), why (performance, errors), for whom (tenants), how far one can grow (capacity) and whom to warn (alerts).',
  audit: 'The log of the whole platform: the same page as the one of the tenants, with the tenant of every event.',
  system:
    'The global parameters that change from the interface, one section at a time: operation, security, keys, quotas of the tenants and capacity, then identity and appearance, with the top bar. For each default, whether tenants may customize it.',
  config:
    'The settings of the tenant, for the Tenant Manager. Every setting carries its mark: with a limit (only stricter than the platform), inherited or customized (with Restore), managed by the administrator (gathered in a section to read).',
  themeedit:
    'One picks the main colour, the style of the band and the greys; the generator computes light and dark, and the WCAG check says whether it reads before saving.',
};

/* ── Navigation ───────────────────────────────────────────────────────
   [group, id, label, icon, roles, kind]. Entries of kind «app» belong to the sample apps: greyed,
   because their pages come from their plugins, not from this mockup. Every thing has one home:
   work and the management of the tenant or of the platform in the sidebar, what is personal in the
   menu of the person (Account, Notifications, Trash). */
const ROUTES = [
  ['work', 'home', 'Home', 'home', ['user']],
  ['work', 'app:notes', 'Notes', 'note', ['user', 'manager'], 'app'],
  ['work', 'app:activities', 'Activities', 'calendar', ['user', 'manager'], 'app'],
  ['work', 'app:estimates', 'Estimates', 'receipt', ['user', 'manager'], 'app'],
  ['work', 'app:tasks', 'Tasks', 'checklist', ['user', 'manager'], 'app'],
  ['org', 'space', 'Overview', 'overview', ['manager']],
  ['org', 'members', 'Manage', 'users', ['manager']],
  ['org', 'splugins', 'Plugins', 'puzzle', ['manager']],
  ['org', 'shares', 'Shares', 'share', ['manager']],
  ['org', 'usage', 'Usage', 'pie', ['manager']],
  ['org', 'activity', 'Log', 'history', ['manager']],
  ['platform', 'platform', 'Overview', 'overview', ['admin']],
  ['platform', 'tenants', 'Tenants', 'building', ['admin']],
  ['platform', 'gusers', 'People', 'users', ['admin']],
  ['platform', 'marketplace', 'Plugins', 'puzzle', ['admin']],
  ['platform', 'monitoring', 'Monitoring', 'activity', ['admin']],
  ['platform', 'audit', 'Log', 'history', ['admin']],
  ['bottom', 'system', 'System', 'cog', ['admin']],
  ['bottom', 'config', 'Tenant settings', 'cog', ['manager']],
];
/* Screens reached from others: [label, the sidebar entry that stays lit, roles]. */
const HIDDEN = {
  login: ['Sign-in', null, ALL],
  account: ['Account', null, ALL],
  inbox: ['Notifications', null, ALL],
  trash: ['Trash', null, ['user', 'manager']],
  person: ['Person', 'members', ['manager', 'admin']],
  group: ['Group', 'members', ['manager']],
  module: ['Permissions of a plugin', 'splugins', ['manager']],
  tenant: ['Tenant', 'tenants', ['admin']],
  mpmod: ['Plugin', 'marketplace', ['admin']],
  themeedit: ['Theme editor', 'config', ['manager', 'admin']],
};
const GROUP_LABEL = { work: 'Apps', org: 'Tenant management', platform: 'Platform', bottom: 'Settings' };
/* The manager works in the apps every day: the apps come first, then the management of the tenant. */
function navFor(role) {
  const order =
    role === 'admin' ? ['platform', 'bottom'] : role === 'manager' ? ['work', 'org', 'bottom'] : ['work'];
  const first = ROUTES.find((r) => r[1] === LANDING[role]);
  const groups = order
    .map((g) => [g, ROUTES.filter((r) => r[0] === g && r[4].includes(role) && r !== first)])
    .filter((x) => x[1].length);
  return [['top', [first]], ...groups];
}
function activeTop(route) {
  if (route === 'person' && (S.personFrom === 'gusers' || S.role === 'admin')) return 'gusers';
  if (route === 'themeedit' && S.role === 'admin') return 'system';
  if (HIDDEN[route]) return HIDDEN[route][1] || route;
  return route;
}
function navItem(r) {
  if (r[5] === 'app') {
    const tip = `${r[2]} · a page of the app, not of this mockup`;
    return `<button type="button" class="nv off" data-act="offnav" data-v="${r[2]}" aria-disabled="true" data-stip="${tip}" aria-label="${tip}">${ic(r[3], 17)}<span>${r[2]}</span></button>`;
  }
  const on = activeTop(S.route) === r[1];
  const tip = r[1] === 'marketplace' ? `${r[2]} · 2 updates` : r[2];
  return `<button type="button" class="nv ${on ? 'on' : ''}" data-go="${r[1]}" ${on ? 'aria-current="page"' : ''} data-stip="${tip}" aria-label="${tip}">${ic(r[3], 17)}<span>${r[2]}</span>${r[1] === 'marketplace' ? '<em>2</em>' : ''}</button>`;
}
/* The top band, as the administrator sets it in System › Identity and appearance › Top bar. */
function bar() {
  return S.app.sys.bar;
}

/* ── Themes ───────────────────────────────────────────────────────────
   Every theme redefines the tokens inside three zones (top band, sidebar, content) plus the accent,
   in a light and a dark version. Components do not change: they read the same tokens. */
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
}
function hexRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function rgbHex(c) {
  return (
    '#' +
    c
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
function mix(a, b, t) {
  const x = hexRgb(a),
    y = hexRgb(b);
  return rgbHex(x.map((v, i) => v + (y[i] - v) * t));
}
function rgba(h, al) {
  const c = hexRgb(h);
  return `rgba(${c[0]},${c[1]},${c[2]},${al})`;
}
function lum(h) {
  return hexRgb(h)
    .map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const x = lum(a),
    y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function hueShift(h, deg) {
  let [r, g, b] = hexRgb(h).map((v) => v / 255);
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b);
  let hh = 0,
    s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const dd = mx - mn;
    s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
    hh = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
    hh /= 6;
  }
  hh = (hh + deg / 360) % 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s,
    p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    return t < 1 / 6
      ? p + (q - p) * 6 * t
      : t < 1 / 2
        ? q
        : t < 2 / 3
          ? p + (q - p) * (2 / 3 - t) * 6
          : p;
  };
  return rgbHex([f(hh + 1 / 3), f(hh), f(hh - 1 / 3)].map((v) => v * 255));
}
function onColor(bg) {
  return contrast('#ffffff', bg) >= 4.5 ? '#ffffff' : '#141414';
}
function navPart(bg, dark) {
  if (contrast('#242424', bg) > contrast('#ffffff', bg))
    return {
      nav: [
        bg,
        '#242424',
        '#424242',
        '#616161',
        '#f5f5f5',
        'rgba(0,0,0,.06)',
        '#e0e0e0',
        '#d0d0d0',
      ],
      navInput: ['#f0f0f0', '#616161'],
    };
  return {
    nav: [
      bg,
      '#ffffff',
      mix('#ffffff', bg, 0.1),
      mix('#ffffff', bg, 0.22),
      mix('#ffffff', bg, 0.9),
      'rgba(255,255,255,.16)',
      bg,
      'rgba(255,255,255,.35)',
    ],
    navInput: dark
      ? [mix(bg, '#ffffff', 0.14), mix('#ffffff', bg, 0.2)]
      : [mix('#ffffff', bg, 0.9), mix(bg, '#000000', 0.25)],
  };
}
/* A theme from three choices: main colour, style of the top band (color, dark, light, gradient), greys. */
function makePreset(o) {
  const G = GRAYS[o.grays] || GRAYS.neutral,
    adv = o.adv || {};
  const acc = adv.accL || o.accent,
    accD = adv.accD || mix(o.accent, '#ffffff', 0.38);
  const barL =
    adv.barL ||
    {
      color: mix(acc, '#000000', 0.15),
      dark: mix(G.d.side, acc, 0.12),
      light: '#ffffff',
      gradient: mix(acc, '#000000', 0.2),
    }[o.bar];
  const barD =
    adv.barD ||
    {
      color: mix(o.accent, '#000000', 0.55),
      dark: mix(G.d.side, o.accent, 0.08),
      light: '#2b2b2b',
      gradient: mix(o.accent, '#000000', 0.55),
    }[o.bar];
  const L = Object.assign(navPart(barL, false), {
    side: [
      adv.side || G.l.side,
      G.l.text,
      G.l.text2,
      G.l.text3,
      G.l.hover,
      G.l.line,
      '#ffffff',
      acc,
    ],
    pane: G.l.pane,
    content: adv.content || G.l.content,
    accent: [acc, rgba(acc, 0.1), onColor(acc)],
  });
  const D = Object.assign(navPart(barD, true), {
    side: [
      G.d.side,
      G.d.text,
      G.d.text2,
      G.d.text3,
      G.d.hover,
      G.d.line,
      mix(G.d.side, '#ffffff', 0.08),
      accD,
    ],
    pane: G.d.pane,
    content: G.d.content,
    accent: [accD, rgba(accD, 0.16), onColor(accD)],
  });
  if (o.bar === 'gradient') {
    L.navGrad = `linear-gradient(90deg, ${barL} 0%, ${hueShift(barL, 40)} 100%)`;
    D.navGrad = `linear-gradient(90deg, ${barD} 0%, ${hueShift(barD, 40)} 100%)`;
  }
  return {
    id: o.id || 'custom',
    name: o.name || 'Custom theme',
    note: o.scope === 'sys' ? 'of the platform' : o.scope === 'tnt' ? 'of the tenant' : '',
    custom: true,
    light: L,
    dark: D,
  };
}
/* The check: every pair of colours that must read, light and dark. */
function themeChecks(p, logo) {
  const out = [];
  ['light', 'dark'].forEach((m) => {
    const v = p[m];
    const ends = v.navGrad ? [v.nav[0], hueShift(v.nav[0], 40)] : [v.nav[0]];
    out.push([
      `Text on the top band · ${m}`,
      Math.min(...ends.map((e) => contrast(v.nav[1], e))),
      4.5,
    ]);
    out.push([`Main button · ${m}`, contrast(v.accent[2], v.accent[0]), 4.5]);
    out.push([
      `Links and active items on the content · ${m}`,
      contrast(v.accent[0], v.content),
      4.5,
    ]);
    out.push([`Active item in the sidebar · ${m}`, contrast(v.side[7], v.side[6]), 3]);
    if (logo)
      out.push([`Logo on the top band · ${m}`, Math.min(...ends.map((e) => contrast(logo, e))), 3]);
  });
  return out;
}
/* The default theme takes the colours of Microsoft Teams: accent #5b5fc7, band #444791, light search field.
   Tessera, right after, takes the ones of the logo (docs/logo): burgundy band and accent, warm greys. */
const PRESETS = [
  (() => {
    const p = Object.assign(
      makePreset({
        id: 'mosaikit',
        name: 'Mosaikit',
        accent: '#5b5fc7',
        bar: 'color',
        grays: 'neutral',
        adv: { barL: '#444791' },
      }),
      { note: 'default', custom: false },
    );
    p.light.navInput = ['#e8ebfa', '#616161'];
    p.dark.navInput = ['#292929', '#adadad'];
    return p;
  })(),
  (() => {
    const p = Object.assign(
      makePreset({
        id: 'tessera',
        name: 'Tessera',
        accent: '#A8293A',
        bar: 'color',
        grays: 'warm',
        adv: { barL: '#6E1522', barD: '#4A0E17', accD: '#E0707C', content: '#FFFDFA' },
      }),
      { note: 'the colours of the logo', custom: false },
    );
    p.light.navInput = ['#F5F0E6', '#6B6058'];
    p.dark.navInput = ['#2E2822', '#ADA39A'];
    return p;
  })(),
  {
    id: 'civic',
    name: 'Civic',
    light: {
      nav: [
        '#0066cc',
        '#ffffff',
        '#eef5ff',
        '#e0ecff',
        '#0b5cb3',
        '#1f75d6',
        '#0b5cb3',
        'rgba(255,255,255,.35)',
      ],
      side: [
        '#ffffff',
        '#17324d',
        '#33485c',
        '#5c6f82',
        '#e6f0fa',
        '#dde5ee',
        '#e3eefb',
        '#0066cc',
      ],
      content: '#f5f7fa',
      accent: ['#0066cc', 'rgba(0,102,204,.10)', '#ffffff'],
    },
    dark: {
      nav: [
        '#0a3d73',
        '#ffffff',
        '#cfe2ff',
        '#9dc1ef',
        '#0d4a8a',
        '#1158a3',
        '#0d4a8a',
        'rgba(255,255,255,.3)',
      ],
      side: [
        '#101b29',
        '#e6edf5',
        '#b9c7d6',
        '#8195ab',
        '#1a2a3d',
        '#1f3047',
        'rgba(77,163,255,.16)',
        '#7cbcff',
      ],
      content: '#0c1520',
      accent: ['#4da3ff', 'rgba(77,163,255,.14)', '#04121f'],
    },
  },
  {
    id: 'slate',
    name: 'Slate',
    light: {
      nav: ['#1e293b', '#f1f5f9', '#cbd5e1', '#94a3b8', '#0f172a', '#334155', '#0f172a', '#475569'],
      side: [
        '#1e293b',
        '#f1f5f9',
        '#cbd5e1',
        '#94a3b8',
        '#334155',
        '#334155',
        'rgba(56,189,248,.18)',
        '#7dd3fc',
      ],
      content: '#f1f5f9',
      accent: ['#0284c7', 'rgba(2,132,199,.10)', '#ffffff'],
    },
    dark: {
      nav: ['#0b1220', '#e2e8f0', '#cbd5e1', '#94a3b8', '#111a2e', '#1e293b', '#1e293b', '#334155'],
      side: [
        '#0b1220',
        '#e2e8f0',
        '#cbd5e1',
        '#94a3b8',
        '#1e293b',
        '#1e293b',
        'rgba(56,189,248,.16)',
        '#7dd3fc',
      ],
      content: '#0f172a',
      accent: ['#38bdf8', 'rgba(56,189,248,.14)', '#04121f'],
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    light: {
      nav: [
        '#14532d',
        '#f0fdf4',
        '#bbf7d0',
        '#86efac',
        '#0f4224',
        '#166534',
        '#0f4224',
        'rgba(255,255,255,.3)',
      ],
      side: [
        '#f3faf5',
        '#14321f',
        '#2f4a38',
        '#5b7363',
        '#e2f2e7',
        '#d5e8db',
        '#dcf3e3',
        '#15803d',
      ],
      content: '#f8fbf8',
      accent: ['#15803d', 'rgba(21,128,61,.10)', '#ffffff'],
    },
    dark: {
      nav: [
        '#052e16',
        '#dcfce7',
        '#bbf7d0',
        '#86efac',
        '#0a3d1f',
        '#14532d',
        '#0a3d1f',
        'rgba(255,255,255,.25)',
      ],
      side: [
        '#0b1d12',
        '#e3f5e9',
        '#b6d4c0',
        '#7f9f8a',
        '#14301f',
        '#173523',
        'rgba(74,222,128,.14)',
        '#86efac',
      ],
      content: '#08140d',
      accent: ['#4ade80', 'rgba(74,222,128,.14)', '#052e16'],
    },
  },
  {
    id: 'terracotta',
    name: 'Terracotta',
    light: {
      nav: [
        '#7c2d12',
        '#fff7ed',
        '#fed7aa',
        '#fdba74',
        '#6a250e',
        '#9a3412',
        '#6a250e',
        'rgba(255,255,255,.3)',
      ],
      side: [
        '#fffaf5',
        '#3b1d10',
        '#5c3423',
        '#8a6352',
        '#fbeadb',
        '#f1dfd0',
        '#fde6d3',
        '#c2410c',
      ],
      content: '#fdf8f3',
      accent: ['#c2410c', 'rgba(194,65,12,.10)', '#ffffff'],
    },
    dark: {
      nav: [
        '#431407',
        '#ffedd5',
        '#fed7aa',
        '#fdba74',
        '#4f1a0a',
        '#6a250e',
        '#4f1a0a',
        'rgba(255,255,255,.25)',
      ],
      side: [
        '#1c120d',
        '#fbe9dc',
        '#d9bfae',
        '#a68a79',
        '#2c1c14',
        '#33221a',
        'rgba(251,146,60,.16)',
        '#fdba74',
      ],
      content: '#140d09',
      accent: ['#fb923c', 'rgba(251,146,60,.14)', '#2a0f04'],
    },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    note: 'gradient',
    light: {
      navGrad: 'linear-gradient(90deg, #006b65 0%, #0b65a8 60%, #3346c4 100%)',
      nav: [
        '#0b6fb8',
        '#ffffff',
        '#f5fbff',
        '#eef8ff',
        'rgba(0,0,0,.16)',
        'rgba(255,255,255,.18)',
        'transparent',
        'rgba(255,255,255,.4)',
      ],
      side: [
        '#ffffff',
        '#10302e',
        '#2c4a48',
        '#5b7472',
        '#e3f4f2',
        '#dce9e8',
        '#dff3f1',
        '#00837b',
      ],
      content: '#f4f8f8',
      accent: ['#00837b', 'rgba(0,131,123,.10)', '#ffffff'],
    },
    dark: {
      navGrad: 'linear-gradient(90deg, #005c56 0%, #0a4f86 60%, #2a3aa0 100%)',
      nav: [
        '#0a4f86',
        '#ffffff',
        '#d6ecff',
        '#a9d2f0',
        'rgba(255,255,255,.12)',
        'rgba(255,255,255,.14)',
        'transparent',
        'rgba(255,255,255,.3)',
      ],
      side: [
        '#0f1c22',
        '#e3f1f0',
        '#b5cfcd',
        '#7f9c9a',
        '#18303a',
        '#1d3540',
        'rgba(0,229,216,.14)',
        '#5eead4',
      ],
      content: '#0b151b',
      accent: ['#00e5d8', 'rgba(0,229,216,.14)', '#0d1a24'],
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    note: 'gradient',
    light: {
      navGrad: 'linear-gradient(90deg, #c2410c 0%, #db2777 55%, #7c3aed 100%)',
      nav: [
        '#db2777',
        '#ffffff',
        '#fff5f9',
        '#fff0f6',
        'rgba(0,0,0,.16)',
        'rgba(255,255,255,.18)',
        'transparent',
        'rgba(255,255,255,.4)',
      ],
      side: [
        '#fffaf8',
        '#3a1f2b',
        '#5a3a48',
        '#8a6876',
        '#fbe8ee',
        '#f2dde4',
        '#fde2ea',
        '#be185d',
      ],
      content: '#fdf8fa',
      accent: ['#be185d', 'rgba(190,24,93,.10)', '#ffffff'],
    },
    dark: {
      navGrad: 'linear-gradient(90deg, #7c2d12 0%, #831843 55%, #4c1d95 100%)',
      nav: [
        '#831843',
        '#ffffff',
        '#fde3ee',
        '#f5bfd5',
        'rgba(255,255,255,.12)',
        'rgba(255,255,255,.14)',
        'transparent',
        'rgba(255,255,255,.3)',
      ],
      side: [
        '#1a1016',
        '#f7e6ee',
        '#d6b8c6',
        '#a4848f',
        '#2a1a22',
        '#33202a',
        'rgba(244,114,182,.16)',
        '#f9a8d4',
      ],
      content: '#120b10',
      accent: ['#f472b6', 'rgba(244,114,182,.14)', '#2a0a18'],
    },
  },
  {
    id: 'contrast',
    name: 'High contrast',
    light: {
      nav: ['#000000', '#ffffff', '#ffffff', '#e5e5e5', '#000000', '#333333', '#000000', '#ffffff'],
      side: [
        '#000000',
        '#ffffff',
        '#ffffff',
        '#d4d4d4',
        '#333333',
        '#555555',
        '#ffd400',
        '#000000',
      ],
      content: '#ffffff',
      accent: ['#0040a0', 'rgba(0,64,160,.12)', '#ffffff'],
    },
    dark: {
      nav: ['#000000', '#ffffff', '#ffffff', '#e5e5e5', '#000000', '#333333', '#000000', '#ffffff'],
      side: [
        '#000000',
        '#ffffff',
        '#ffffff',
        '#d4d4d4',
        '#333333',
        '#555555',
        '#ffd400',
        '#000000',
      ],
      content: '#000000',
      accent: ['#ffd400', 'rgba(255,212,0,.2)', '#000000'],
    },
  },
];
const MODES = [
  ['light', 'Light', 'sun'],
  ['dark', 'Dark', 'moon'],
  ['auto', 'Automatic', 'contrast'],
];
function presetCss(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p || !p.light) return '';
  const v = isDark() ? p.dark : p.light;
  const n = v.nav,
    s = v.side,
    a = v.accent;
  return `#stage { --accent: ${a[0]}; --accent-soft: ${a[1]}; --on-accent: ${a[2]}; }
#stage .top { --bg2: ${n[0]}; --text: ${n[1]}; --text2: ${n[2]}; --text3: ${n[3]}; --bg: ${n[4]}; --bg3: ${n[5]}; --line: ${n[6]}; --line2: ${n[7]}; --accent-soft: rgba(255,255,255,.16); --accent: ${n[1]}; --on-accent: ${n[0]}; }
#stage .side { --bg2: ${s[0]}; --text: ${s[1]}; --text2: ${s[2]}; --text3: ${s[3]}; --bg3: ${s[4]}; --line: ${s[5]}; --accent-soft: ${s[6]}; --accent: ${s[7]}; }
#stage .main { --bg: ${v.content}; }${
    v.pane
      ? `
#stage .rlay > .facets, #stage .dside > .facets { background: ${v.pane}; }
#stage .facet.scope label:has(input:checked) { background: ${isDark() ? '#333333' : '#ffffff'}; box-shadow: 0 1px 2px rgba(0,0,0,.08); }`
      : ''
  }${
    v.navInput
      ? `
#stage .top .sbox { background: ${v.navInput[0]}; color: ${v.navInput[1]}; border-color: transparent; }
#stage .top .sbox kbd { color: ${v.navInput[1]}; border-color: ${v.navInput[1]}55; }`
      : ''
  }
#stage .lg-hero { --band-bg: ${n[0]}; --band-fg: ${n[1]}; --band-muted: ${n[2]}; }
#stage .side-h { background: ${n[0]}; border-bottom-color: ${n[6]}; --text: ${n[1]}; --text2: ${n[2]}; --text3: ${n[3]}; --bg3: ${n[5]}; --accent: ${n[1]}; --on-accent: ${n[0]}; }${
    v.navGrad
      ? `
#stage .top, #stage .side-h { background: ${v.navGrad}; background-attachment: fixed; }`
      : ''
  }`;
}
function applyPreset() {
  let st = document.getElementById('preset-css');
  if (!st) {
    st = document.createElement('style');
    st.id = 'preset-css';
    document.head.appendChild(st);
  }
  st.textContent = presetCss(S.hc ? 'contrast' : S.preset);
}
function applyMode() {
  if (S.mode === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = S.mode;
}

/* ── Menus of the top band ───────────────────────────────────────────── */

function menuRight() {
  return S.notes && innerWidth > 1100 ? 356 : 16;
}
/* The palette holds only personal preferences: mode and contrast. The theme of the tenant or of the
   platform is chosen in Settings or System › Identity and appearance, never from here. */
function themeMenuHtml() {
  if (!S.themeMenu) return '';
  return `<div class="tmenu" role="dialog" aria-label="Appearance" style="right:${menuRight()}px">
    <div class="eyebrow">Mode</div>
    <div class="tm-modes" role="radiogroup" aria-label="Mode">${MODES.map((m) => `<button type="button" role="radio" aria-checked="${S.mode === m[0]}" data-mode="${m[0]}">${ic(m[2], 16)}<span>${m[1]}</span></button>`).join('')}</div>
    <div class="tm-row"><div><b>High contrast</b><span class="muted small">Sharper colours, for whoever reads with effort</span></div><button type="button" class="tgl" role="switch" data-act="hc" aria-label="High contrast" aria-checked="${!!S.hc}"><i></i></button></div>
    <p class="muted small">They apply only to you, at once.</p>
    <button type="button" class="btn tm-link" data-act="accgo" data-v="appearance">${ic('eye', 15)}<span>Language, sidebar and other preferences</span></button></div>`;
}
/* The language of the interface, for oneself: among the ones of the platform (administrator) or of the
   tenant. One click and it applies at once. */
function myLangs() {
  return LANGS.filter((l) => (S.role === 'admin' ? S.app.sys.langs : S.app.tnt.langs).includes(l[0]));
}
function langMenuHtml() {
  if (!S.langMenu) return '';
  return `<div class="tmenu hmenu lmenu" role="listbox" aria-label="Language" style="right:${menuRight()}px">
    <div class="eyebrow">Language</div>
    <div class="hm-l">${myLangs()
      .map(
        (l) =>
          `<button type="button" class="hm-i" role="option" aria-selected="${S.lang === l[0]}" data-act="setlang" data-v="${l[0]}"><span class="mono lm-c">${l[0].toUpperCase()}</span><span>${l[1]}</span>${S.lang === l[0] ? ic('check', 15) : ''}</button>`,
      )
      .join('')}</div>
    <p class="muted small">${S.role === 'admin' ? 'Among the languages of the platform.' : 'Among the languages your tenant chose.'} It applies only to you, at once.</p></div>`;
}
/* What is personal, and nothing else: Account, Notifications, Trash. Settings and System are in the
   sidebar. When the administrator hides the help from the band, its entries come here. */
const HELP_ITEMS = [
  ['play', 'Guided tour of this page'],
  ['help', 'Guide of Mosaikit'],
  ['star', 'What is new in version 1.0'],
  ['key', 'Keyboard shortcuts'],
];
function helpItems() {
  return HELP_ITEMS.map(
    (x) =>
      `<button type="button" class="hm-i" role="menuitem" data-act="toast" data-v="In the product: ${x[1].toLowerCase()}.">${ic(x[0], 16)}<span>${x[1]}</span></button>`,
  ).join('');
}
function userMenuHtml() {
  if (!S.userMenu) return '';
  const R = ROLES[S.role],
    adm = S.role === 'admin',
    tn = adm ? null : curTenant();
  const it = (icon, label, attr, sub) =>
    `<button type="button" class="hm-i" role="menuitem" ${attr}>${ic(icon, 16)}<span>${label}</span>${sub ? `<em class="muted small">${sub}</em>` : ''}</button>`;
  return `<div class="tmenu hmenu umenu" role="menu" aria-label="Menu of ${R.who}" style="right:${menuRight()}px">
    <div class="um-h">${av(R.ini, adm ? 5 : S.role === 'manager' ? 2 : 3, 40)}<div><b>${R.who}</b><span class="muted small">${R.mail}</span><span class="small">${R.label}${tn ? ` · ${tn.name}` : ' · Platform'}</span></div></div>
    <div class="hm-l">${it('user', 'Account', 'data-go="account"')}${it('bell', 'Notifications', 'data-go="inbox"', inboxUnread() + ' new')}${adm ? '' : it('trash', 'Trash', 'data-go="trash"')}</div>
    ${bar().help ? '' : `<div class="hm-l um-help"><div class="eyebrow">Help</div>${helpItems()}</div>`}
    <div class="hm-l um-out">${it('back', 'Sign out', 'data-act="logout"')}</div></div>`;
}
function helpMenuHtml() {
  if (!S.helpMenu) return '';
  return `<div class="tmenu hmenu" role="dialog" aria-label="Help" style="right:${menuRight()}px">
    <div class="hm-l">${helpItems()}</div>
    <div class="hm-v">${brandMark(18)}<div><b>Mosaikit 1.0.0</b><span class="muted small">Updated on 2 Oct 2026</span></div></div>
    ${S.role === 'admin' ? `<button type="button" class="btn tm-link" data-go="marketplace">${ic('puzzle', 15)}<span>2 updates of plugins</span></button>` : ''}</div>`;
}
/* The bell opens the latest notifications; the page Notifications has them all, with filters. */
function bellMenuHtml() {
  if (!S.bellMenu) return '';
  const items = inboxItems().slice(0, 5),
    n = inboxUnread();
  return `<div class="tmenu hmenu bmenu" role="dialog" aria-label="Notifications" style="right:${menuRight()}px">
    <div class="bm-h"><b>Notifications</b><span class="muted small">${n ? n + ' new' : 'nothing new'}</span><span class="grow"></span>${n ? `<button type="button" class="lnk small" data-act="readall">Mark all as read</button>` : ''}<button type="button" class="ib" data-act="accgo" data-v="notifications" aria-label="What I receive" title="What I receive">${ic('cog', 16)}</button></div>
    <ul class="bm-l">${items.map((x) => `<li class="${x[4] ? 'unread' : ''}"><button type="button" data-go="inbox"><span class="ri">${ic(x[0], 15)}</span><span class="bm-t"><b>${x[1]}</b><span class="muted small">${x[2]}</span></span><span class="muted small num">${x[3]}</span>${x[4] ? '<i class="dot info" aria-label="new"></i>' : ''}</button></li>`).join('')}</ul>
    <button type="button" class="btn tm-link" data-go="inbox">${ic('bell', 15)}<span>See all the notifications</span></button></div>`;
}
function curTenant() {
  if (S.role === 'admin') return PLATFORM;
  return TENANT_SEL.find((x) => x.id === S.tenant) || TENANT_SEL[0];
}
/* Right side of the band: language, mode and help when the administrator shows them, then the bell
   and the person, always. */
function topRight() {
  const R = ROLES[S.role],
    n = inboxUnread(),
    B = bar();
  const lang = (LANGS.find((l) => l[0] === S.lang) || LANGS[0])[1];
  return `<div class="tr">${B.lang && myLangs().length > 1 ? `<button type="button" class="ib lang ${S.langMenu ? 'on' : ''}" data-act="langmenu" aria-haspopup="listbox" aria-expanded="${!!S.langMenu}" aria-label="Language: ${lang}" data-tip="${S.langMenu ? '' : `Language · ${lang}`}">${S.lang.toUpperCase()}</button>` : ''}${B.mode ? `<button type="button" class="ib ${S.themeMenu ? 'on' : ''}" data-act="theme" aria-haspopup="dialog" aria-expanded="${S.themeMenu}" aria-label="Appearance" data-tip="${S.themeMenu ? '' : 'Appearance: mode and contrast'}">${ic('contrast', 18)}</button>` : ''}${B.help ? `<button type="button" class="ib ${S.helpMenu ? 'on' : ''}" data-act="helpmenu" aria-haspopup="dialog" aria-expanded="${!!S.helpMenu}" aria-label="Help" data-tip="${S.helpMenu ? '' : 'Help and version'}">${ic('help', 18)}</button>` : ''}<button type="button" class="ib ${S.bellMenu ? 'on' : ''}" data-act="bellmenu" aria-haspopup="dialog" aria-expanded="${!!S.bellMenu}" aria-label="Notifications, ${n} new" data-tip="${S.bellMenu ? '' : `Notifications · ${n} new`}">${ic('bell', 18)}${n ? `<em>${n}</em>` : ''}</button><button type="button" class="me ${S.userMenu ? 'on' : ''}" data-act="usermenu" aria-haspopup="menu" aria-expanded="${!!S.userMenu}" aria-label="Menu of ${R.who}" data-tip="${S.userMenu ? '' : 'Account, notifications, trash'}" data-tip-end><span class="me-t"><b>${R.who}</b><span>${R.label}</span></span>${av(R.ini, S.role === 'admin' ? 5 : S.role === 'manager' ? 2 : 3, 30)}</button></div>`;
}
/* The logo of the application, in the corner above the sidebar. */
function appLogo(markOnly) {
  return `<span class="app-logo" role="img" aria-label="${S.app.sys.name}">${brandMark(28)}${markOnly ? '' : `<b>${S.app.sys.name}</b>`}</span>`;
}
/* The tenant switcher, in the band after the sidebar button: crest, name, arrow. The administrator works
   on the platform, not inside a tenant: there the band says so, without a menu. */
/* The tenant in the band: with several tenants a menu to switch, with one only its logo and name. */
function tenantSwitch() {
  if (S.role === 'admin') return `<span class="tsw static plat" title="The administrator works on the platform, not inside a tenant">${ic('shield', 15)}<span class="ts-name">Platform</span></span>`;
  const tn = curTenant();
  if ((MY_TENANTS[S.role] || []).length <= 1) return `<span class="tsw static">${crest(tn, 24)}<span class="ts-name">${tn.name}</span></span>`;
  return `<button type="button" class="tsw" data-act="tenants" aria-haspopup="listbox" aria-expanded="${!!S.tenantMenu}" aria-label="Tenant: ${tn.name}. Switch tenant" data-tip="${S.tenantMenu ? '' : `${tn.name} · switch tenant`}" data-tip-start>${crest(tn, 24)}<span class="ts-name">${tn.name}</span>${ic('down', 14)}</button>`;
}
/* Whoever works in several tenants sees the home one first, then the ones they are a guest in. */
function tenantMenuHtml() {
  if (!S.tenantMenu || S.role === 'admin') return '';
  const cur = curTenant(),
    mine = MY_TENANTS[S.role];
  const item = (m) => {
    const tn = TENANT_SEL.find((x) => x.id === m[0]);
    return `<button type="button" role="option" aria-selected="${tn.id === cur.id}" data-tenant="${tn.id}"><span class="tn-l">${tenantLogo(tn, 32)}<span class="muted small">${m[1]}</span></span>${tn.id === cur.id ? ic('check', 15) : ''}</button>`;
  };
  // on a narrow screen the switcher heads the drawer; otherwise it is in the band, after the sidebar
  const narrow = innerWidth <= 900,
    sw = S.side === 'open' ? 240 : 65;
  return `<div class="tnmenu" role="listbox" aria-label="Switch tenant" style="left:${narrow ? 8 : sw + 58}px;top:${narrow ? 106 : 48}px">
    <div class="eyebrow">Home</div>${mine
      .filter((m) => m[2] === 'home')
      .map(item)
      .join('')}
    ${
      mine.some((m) => m[2] !== 'home')
        ? `<div class="eyebrow">Guest in</div>${mine
            .filter((m) => m[2] !== 'home')
            .map(item)
            .join('')}`
        : ''
    }
    <p class="tn-note">${ic('key', 13)} You always sign in with the access of Example City: switching tenant does not ask you to sign in again.</p></div>`;
}
/* The notifications of whoever is looking: one source for the page, the bell and the menu. */
function inboxAll() {
  if (S.role === 'admin')
    return [
      [
        'refresh',
        'Updates to apply',
        'Notes 1.5.0 · Time tracking 1.3.0',
        'Today 07:00',
        1,
        'Updates',
      ],
      [
        'alert',
        'Backup failed',
        'Full backup of 5 Oct: no space left on the destination',
        '5 Oct',
        1,
        'System',
      ],
      ['clock', 'Trial ending', 'Sandbox · 4 days', 'Yesterday', 0, 'Tenants'],
      [
        'activity',
        'Service degraded',
        'Automation worker · queue of 6 jobs',
        'Today 09:10',
        0,
        'System',
      ],
    ];
  const base = [
    [
      'message',
      'Elena Ricci mentioned you',
      'Site visit, north depot · «this needs another look»',
      '12 min ago',
      1,
      'Mentions',
    ],
    [
      'lock',
      'Request approved',
      'You can now see Quarterly review with finance',
      'Yesterday',
      0,
      'Access',
    ],
  ];
  return base
    .concat([
      [
        'share',
        'New access',
        'Sara Greco gave you «Edit» on Estimate 2026-109 · office furniture',
        '1 hour ago',
        1,
        'Access',
      ],
      [
        'alert',
        'Automation failed',
        'Monthly report of open tasks · time limit exceeded',
        'Yesterday 16:12',
        0,
        'Automations',
      ],
    ])
    .concat(
      S.role === 'manager'
        ? [
            [
              'users',
              'Invitation accepted',
              'Luca Bianchi joined the group Field team',
              '2 days ago',
              0,
              'Groups',
            ],
          ]
        : [],
    );
}
/* «Mark all as read» empties the count of the bell and of the page together. */
function inboxItems() {
  const all = inboxAll();
  return S.readAll ? all.map((x) => x.slice(0, 4).concat(0, x.slice(5))) : all;
}
function inboxUnread() {
  return inboxItems().filter((x) => x[4]).length;
}
/* A short outcome that goes away by itself, for actions that have no page in the mockup. */
function toastHtml() {
  if (!S.toast) return '';
  clearTimeout(toastHtml.t);
  toastHtml.t = setTimeout(() => {
    S.toast = null;
    const el = document.querySelector('.toast');
    if (el) el.remove();
  }, 4200);
  return `<div class="toast" role="status">${ic('check', 16)}<span>${S.toast}</span></div>`;
}

/* ── Search and commands ──────────────────────────────────────────────
   It searches the items of the apps by name and description; without text it shows the recent ones.
   The administrator has no content: it searches tenants, people and pages of the platform. */
function cmdNorm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
function cmdHl(s, q) {
  const esc = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (!q) return esc;
  const i = esc.toLowerCase().indexOf(q.toLowerCase());
  return i < 0
    ? esc
    : esc.slice(0, i) + '<mark>' + esc.slice(i, i + q.length) + '</mark>' + esc.slice(i + q.length);
}
function cmdSources() {
  const pages = [
    'Pages',
    null,
    ROUTES.filter((r) => r[4].includes(S.role) && r[5] !== 'app').map((r) => ({
      t: r[2],
      sub: 'Page',
      icon: r[3],
      f: [r[2]],
      attr: `data-go="${r[1]}"`,
    })),
  ];
  if (S.role === 'admin')
    return [
      [
        'Tenants',
        'tenants',
        TENANTS.map((x) => ({
          t: x.n,
          sub: `${x.users} people · ${TEN_ST[x.st].label || x.st}`,
          icon: 'building',
          f: [x.n, x.slug, x.auth],
          attr: `data-res="ten:${x.slug}" data-go="tenant"`,
        })),
      ],
      [
        'People',
        'gusers',
        PEOPLE.map((p) => ({
          t: p.n,
          sub: `${p.role} · ${p.mail}`,
          icon: 'user',
          f: [p.n, p.mail, p.role].concat(p.groups || []),
          attr: `data-res="person:${p.ini}" data-go="person"`,
        })),
      ],
      [
        'Sections',
        null,
        [
          'Email',
          'Addresses',
          'Backup and restore',
          'Security',
          'Keys of outside services',
          'Retention',
          'Maintenance',
          'Quotas',
          'Identity and appearance',
        ]
          .map((n, i) => ({
            t: n,
            sub: 'System',
            icon: 'cog',
            f: [n, 'system'],
            attr: `data-act="sysgo" data-v="${i}"`,
          }))
          .concat(
            MP.map((m) => ({
              t: m.n,
              sub: 'Plugin · ' + m.ver,
              icon: 'puzzle',
              f: [m.n, m.id],
              attr: `data-res="mp:${m.id}" data-go="mpmod"`,
            })),
          ),
      ],
      pages,
    ];
  const items = ITEMS;
  return APPS.map((a) => [
    a.n,
    null,
    items
      .filter((i) => i.app === a.id)
      .map((i) => ({
        t: i.t,
        sub: `${a.n} · ${i.d} · ${ACCESS[i.acc].label}`,
        icon: a.ic,
        f: [i.t, i.d, i.own],
        attr: `data-act="appopen" data-v="${a.id}"`,
      })),
  ]).concat([pages]);
}
/* The search in the band. Closed it is a field to click (or Ctrl K); open it is written in, and under it
   a drop-down with the filters as pills and the results. Esc, a click outside or a result close it. */
function searchBox() {
  if (S.modal !== 'cmd')
    return `<div class="sbox-w"><button type="button" class="sbox" data-act="cmd" data-tip="Search · Ctrl K">${ic('search', 15)}<span>Search everything</span><kbd>Ctrl K</kbd></button></div>`;
  const ph = S.role === 'admin' ? 'Search tenants, people and pages' : 'Search notes, activities, estimates and tasks';
  return `<div class="sbox-w on"><div class="sbox on">${ic('search', 15)}<input type="text" data-cmdq placeholder="${ph}" aria-label="Search" value="${(S.cmdQ || '').replace(/"/g, '&quot;')}" autocomplete="off"><kbd>Esc</kbd></div>
    <div class="cmdpop" role="dialog" aria-label="Search"><div class="cmd-pills" role="tablist" aria-label="Show">${cmdPills()}</div><div class="cmdr" role="listbox">${cmdResults()}</div>
      <div class="cmd-f muted small"><span><kbd>↑</kbd><kbd>↓</kbd> to choose</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></div></div></div>`;
}
/* The groups of results the search shows, after the pill chosen. */
function cmdGroups() {
  const f = S.cmdF || 'All';
  return cmdSources().filter((g) => f === 'All' || g[0] === f);
}
/* The pills: All and one per group, with how many results each has for what is written. */
function cmdPills() {
  const nq = cmdNorm((S.cmdQ || '').trim());
  const count = (g) => (nq ? g[2].filter((r) => r.f.some((x) => cmdNorm(x).includes(nq))).length : g[2].length);
  const src = cmdSources();
  const all = src.reduce((s, g) => s + count(g), 0);
  const f = S.cmdF || 'All';
  return [['All', all]]
    .concat(src.map((g) => [g[0], count(g)]))
    .map(
      (p) =>
        `<button type="button" class="cpill ${f === p[0] ? 'on' : ''}" role="tab" aria-selected="${f === p[0]}" data-act="cmdf" data-v="${p[0]}">${p[0]}<span class="num">${p[1]}</span></button>`,
    )
    .join('');
}
function cmdResults() {
  const q = (S.cmdQ || '').trim(),
    nq = cmdNorm(q);
  const item = (r, on) =>
    `<li><button type="button" class="cr ${on ? 'on' : ''}" ${r.attr}>${ic(r.icon, 16)}<span class="cr-t"><b>${cmdHl(r.t, q)}</b><span class="muted small">${r.sub}</span></span>${on ? '<kbd>Enter</kbd>' : ''}</button></li>`;
  let n = 0;
  if (!q && (S.cmdF || 'All') === 'All') {
    const src = cmdSources();
    const recent =
      S.role === 'admin'
        ? [src[0][2][0], src[1][2][0], src[0][2][1]]
        : src
            .slice(0, 4)
            .map((g) => g[2][0])
            .filter(Boolean);
    return `<div class="cr-g">Opened recently</div><ul class="cmdl">${recent.map((r) => item(r, n++ === 0)).join('')}</ul>`;
  }
  const groups = cmdGroups()
    .map((g) => [g[0], g[1], g[2].filter((r) => !nq || r.f.some((f) => cmdNorm(f).includes(nq)))])
    .filter((g) => g[2].length);
  if (!groups.length)
    return `<p class="cr-none">${q ? `Nothing for «${cmdHl(q)}»${(S.cmdF || 'All') === 'All' ? '' : ' in ' + S.cmdF}. Try a word of the description or the name of whoever created it.` : 'Nothing here.'}</p>`;
  const tot = groups.reduce((s, g) => s + g[2].length, 0);
  return (
    `<p class="cr-n muted small">${tot} ${tot === 1 ? 'result' : 'results'}</p>` +
    groups
      .map(
        (g) =>
          `<div class="cr-g">${g[0]} <span class="num">${g[2].length}</span></div><ul class="cmdl">${g[2]
            .slice(0, 4)
            .map((r) => item(r, n++ === 0))
            .join(
              '',
            )}${g[2].length > 4 && g[1] ? `<li><button type="button" class="cr more" data-go="${g[1]}">${ic('right', 14)}<span class="cr-t">${g[2].length - 4} more in ${g[0]}</span></button></li>` : ''}</ul>`,
      )
      .join('')
  );
}

/* ── The frame ────────────────────────────────────────────────────────
   Two rows. On top a full-width band: the logo of the application in the corner above the sidebar,
   then the button of the sidebar, the tenant, the search, and on the right the controls. Under it,
   the sidebar and the content. On a wide screen the sidebar is made of icons by default, with the
   labels in tips; on a narrow screen it opens as a drawer. The administrator decides what the band
   shows (System › Identity and appearance › Top bar): without the logo, the button of the sidebar
   takes the corner. */
function shellA(content) {
  const groups = navFor(S.role);
  const mini = !S.drawer && S.side !== 'open';
  const B = bar();
  const label = (g) => GROUP_LABEL[g];
  const open = !mini;
  const toggle = `<button type="button" class="ib stg" data-act="sidetoggle" aria-expanded="${S.drawer || open}" aria-label="${S.drawer || open ? 'Close the sidebar' : 'Open the sidebar'}" data-tip="${S.drawer || open ? 'Close the sidebar' : 'Open the sidebar'}" data-tip-start>${ic('sidebar', 18)}</button>`;
  return `<div class="app pA ${S.drawer ? 'drawer' : ''}">
    <div class="band ${B.logo ? '' : 'nologo'}"><div class="side-h ${mini ? 'mini' : ''}">${B.logo ? appLogo(mini) : toggle}</div>
      <header class="top"><div class="top-l">${toggle}${tenantSwitch()}</div>${B.search ? searchBox() : '<span class="sbox-none"></span>'}${topRight()}</header></div>
    <div class="body"><nav class="side ${mini ? 'mini' : ''} ${mini && S.sideLabels ? 'labels' : ''}" aria-label="Navigation">
      ${S.drawer ? `<div class="side-hd">${S.role === 'admin' ? appLogo(false) : tenantSwitch()}</div>` : ''}
      <div class="side-list">${groups
        .filter((x) => x[0] !== 'bottom')
        .map(
          ([g, items]) =>
            `<div class="sg sg-${g}">${g === 'top' ? '' : `<div class="sg-l">${label(g)}</div>`}${items.map(navItem).join('')}</div>`,
        )
        .join('')}</div>
      ${groups
        .filter((x) => x[0] === 'bottom')
        .map((x) => `<div class="sg sg-bottom">${x[1].map(navItem).join('')}</div>`)
        .join('')}
      <div class="side-f">${quotaWidget(S)}</div></nav>
      <div class="scrim-d" data-act="drawer"></div>
      <main class="main">${content}</main></div></div>`;
}

/* ── Generic dialogs ─────────────────────────────────────────────────── */

/* Share: subjects (person, group, tenant, link, public) and levels (view, use, edit, manage). */
DIALOGS.share = () => {
  const it = ITEMS.find((x) => x.id === S.shareRes) || ITEMS[1],
    mine = it.own === ROLES[S.role].who || S.role === 'manager';
  const subj = [
    [(PEOPLE.find((p) => p.n === it.own) || PEOPLE[1]).ini, it.own, 'Owner', 3],
    ...(it.own === 'Elena Ricci' ? [] : [['ER', 'Elena Ricci', 'Manage', 2]]),
    ['FT', 'Group Field team · 12 people', 'Edit', 4],
    ['PL', 'Group Planning · 23 people', 'Use', 1],
    ['SG', 'Sara Greco', 'View', 4],
  ];
  return {
    html: `<div class="dlg-h"><h2>Share «${it.t}»</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b stack">
      <div class="field">${ic('search', 15)}<input type="text" placeholder="Add people or groups of the tenant" aria-label="Add people or groups"></div>
      <ul class="rows">${subj.map((x) => `<li>${av(x[0], x[3], 28)}<div class="rt"><b>${x[1]}</b></div><button type="button" class="chip">${x[2]} ${ic('down', 12)}</button></li>`).join('')}</ul>
      <div class="eyebrow">General access</div><div class="opts row3">${[
        ['lock', 'Only the people added'],
        ['building', 'The whole tenant'],
      ]
        .concat(mine ? [['globe', 'Public']] : [])
        .map(
          (o, i) =>
            `<label class="opt ${i === 1 ? 'sel' : ''}"><input type="radio" name="ga" ${i === 1 ? 'checked' : ''}>${ic(o[0], 16)}<b>${o[1]}</b></label>`,
        )
        .join('')}</div>
      ${mine ? `<div class="eyebrow">Link</div><div class="row">${pill('View', '', 'link')}${pill('Expires on 31 Oct 2026')}${pill('With password', '', 'lock')}<span class="grow"></span>${btn('Copy the link', { icon: 'link', act: 'toast', v: 'Link copied. Whoever opens it sees the item read-only until 31 Oct.' })}</div>` : `<p class="muted small">${ic('lock', 12)} Outside links and public sharing are decided by the owner, ${it.own}.</p>`}</div>
      <div class="dlg-f"><span class="muted small">Levels: view, use, edit, manage. An app may name them its own way; the platform enforces them.</span>${btn('Done', { kind: 'pri', act: 'close' })}</div>`,
  };
};
/* Create: one entry for each app installed in the tenant. */
DIALOGS.new = () => ({
  html: `<div class="dlg-h"><h2>Create</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b"><div class="newg">${[
    ['note', 'Note', 'An empty note or one from a template', 'notes'],
    ['calendar', 'Activity', 'A meeting, a visit or a deadline', 'activities'],
    ['receipt', 'Estimate', 'Items, prices and approval', 'estimates'],
    ['checklist', 'Task', 'A to-do with an owner and a due date', 'tasks'],
  ]
    .map(
      (n) =>
        `<button type="button" class="newi" data-act="appopen" data-v="${n[3]}">${ic(n[0], 22)}<b>${n[1]}</b><span>${n[2]}</span></button>`,
    )
    .join(
      '',
    )}</div><p class="muted small mt">Every app installed in the tenant adds its entries here.</p></div>`,
});
DIALOGS.cmd = () => ({
  top: true,
  html: `<div class="cmd"><div class="field big">${ic('search', 18)}<input type="text" data-cmdq placeholder="${S.role === 'admin' ? 'Search tenants, people and pages' : 'Search notes, activities, estimates and tasks'}" aria-label="Search" value="${(S.cmdQ || '').replace(/"/g, '&quot;')}" autocomplete="off"><kbd>Esc</kbd></div><div class="cmdr" role="listbox">${cmdResults()}</div>
      <div class="cmd-f muted small"><span><kbd>↑</kbd><kbd>↓</kbd> to choose</span><span><kbd>Enter</kbd> to open</span></div></div>`,
});
function modalHtml() {
  if (S.modal === 'cmd') return '<div class="cmd-scrim" data-act="close"></div>';
  if (!S.modal || !DIALOGS[S.modal]) return '';
  const d = DIALOGS[S.modal](S);
  return `<div class="scrim" data-act="close"></div><div class="dlg ${d.top ? 'atop cmdd' : ''} ${d.wide ? 'wide' : ''}" role="dialog" aria-modal="true">${d.html}</div>`;
}

/* ── Review: one box per screen and per dialog, per role ─────────────── */

const MODALS = [
  ['share', 'Share', 'dlg-share', ['user', 'manager']],
  ['new', 'Create', 'dlg-create', ['user', 'manager']],
  ['cmd', 'Search and commands', 'dlg-search', ALL],
  ['invite', 'Invite people', 'dlg-invite', ['manager']],
  ['rolesinfo', 'What each role can do', 'dlg-roles', ['manager', 'admin']],
  ['groupnew', 'New group', 'dlg-new-group', ['manager']],
  ['rmperson', 'Remove from the tenant', 'dlg-remove-person', ['manager']],
  ['confirm', 'Confirm an action that cannot be undone', 'dlg-confirm', ['manager', 'admin']],
  ['newten', 'New tenant', 'dlg-new-organization', ['admin']],
  ['newadmin', 'New administrator', 'dlg-new-admin', ['admin']],
  ['movehome', 'Move the home tenant', 'dlg-move-home', ['admin']],
];
let CHECK = {};
try {
  CHECK = JSON.parse(localStorage.getItem('mk-mockup-review') || '{}') || {};
} catch (e) {
  CHECK = {};
}
function saveCheck() {
  try {
    localStorage.setItem('mk-mockup-review', JSON.stringify(CHECK));
  } catch (e) {
    /* stays in memory */
  }
}
function checkItems(role) {
  const items = [];
  navFor(role).forEach(([g, list]) =>
    list
      .filter((r) => r[5] !== 'app')
      .forEach((r) =>
        items.push([
          'go',
          r[1],
          r[2],
          g === 'top' ? 'Start page' : GROUP_LABEL[g],
          r[3],
          r[1],
        ]),
      ),
  );
  Object.entries(HIDDEN)
    .filter(([, v]) => v[2].includes(role))
    .forEach(([id, v]) => items.push(['go', id, v[0], 'Detail screens', 'right', id]));
  MODALS.filter((m) => m[3].includes(role)).forEach((m) =>
    items.push(['act', m[0], m[1], 'Dialogs', 'grid', m[2]]),
  );
  return items;
}
function isChecked(role, key) {
  return !!(CHECK[role] && CHECK[role][key]);
}
function curKey() {
  return S.modal ? 'act:' + S.modal : 'go:' + S.route;
}
function progress(role) {
  const it = checkItems(role);
  return [it.filter((i) => isChecked(role, i[0] + ':' + i[1])).length, it.length];
}
function screenId() {
  if (S.modal) {
    const m = MODALS.find((x) => x[0] === S.modal);
    return MOCKUP + ':' + (m ? m[2] : 'dlg-' + S.modal);
  }
  return MOCKUP + ':' + S.route + (SUB ? '/' + SUB : '');
}
function indexHtml() {
  if (!S.map) return '';
  const groups = [];
  checkItems(S.role).forEach((i) => {
    let g = groups.find((x) => x[0] === i[3]);
    if (!g) {
      g = [i[3], []];
      groups.push(g);
    }
    g[1].push(i);
  });
  const [done, tot] = progress(S.role);
  return `<div class="scrim" data-act="sitemap"></div><div class="dlg wide" role="dialog" aria-label="Index and review"><div class="dlg-h"><h2>Index and review · ${ROLES[S.role].long} · ${done} of ${tot}</h2>${btn('', { icon: 'x', act: 'sitemap' })}</div>
    <div class="dlg-b idx">${groups
      .map(
        ([g, list]) =>
          `<div><div class="eyebrow">${g}</div>${list
            .map((i) => {
              const key = i[0] + ':' + i[1];
              const on = isChecked(S.role, key);
              return `<div class="smr"><button type="button" class="chkb ${on ? 'on' : ''}" data-chk="${key}" aria-pressed="${on}" aria-label="Reviewed: ${i[2]}">${on ? ic('check', 13) : ''}</button><button type="button" data-${i[0]}="${i[1]}" class="smi">${ic(i[4], 15)}${i[2]}<span class="mono">${i[5]}</span></button></div>`;
            })
            .join('')}</div>`,
      )
      .join('')}</div>
    <div class="dlg-f"><span class="muted small">The count stays in this browser, per role: a screen is reviewed with the role that uses it.</span>${btn('Reset the role', { act: 'reset' })}</div></div>`;
}
function notesHtml() {
  return `<aside class="notes" ${S.notes ? '' : 'hidden'} aria-label="Notes"><div class="notes-h"><b>Mosaikit · shell</b>${btn('', { icon: 'x', act: 'notes' })}</div>
    <div class="notes-b"><p class="lead">${DECISION.idea}</p><div class="eyebrow">This screen · <span class="mono">${screenId()}</span></div><p>${NOTES[S.route] || ''}</p>
    <div class="eyebrow">For the role ${ROLES[S.role].long.toLowerCase()}</div><p>${DECISION.roles[S.role]}</p>
    <div class="eyebrow">How to review</div><p>${DECISION.how}</p></div></aside>`;
}
function reviewBar() {
  const [done, tot] = progress(S.role),
    key = curKey(),
    on = isChecked(S.role, key),
    login = S.route === 'login';
  return `<div class="rev-in"><span class="rev-t">Mosaikit · mockup</span>
    <div class="rseg" role="group"><button type="button" data-act="loginpage" aria-pressed="${login}" aria-label="Sign-in page" title="Sign-in page">${ic('key', 14)}<b>Sign-in</b></button>${[
      ['admin', 'Administrator', 'Admin'],
      ['manager', 'Tenant Manager', 'Mgr'],
      ['user', 'User', 'User'],
    ]
      .map(
        (i) =>
          `<button type="button" data-role="${i[0]}" aria-pressed="${!login && S.role === i[0]}" aria-label="${i[1]}" title="${i[1]}"><b class="rs-l">${i[1]}</b><b class="rs-s" aria-hidden="true">${i[2]}</b></button>`,
      )
      .join('')}</div>
    <button type="button" class="rev-id" data-act="copyid" title="Screen id, as requirements cite it: click to copy">${screenId()}</button>
    <span class="grow"></span>
    <button type="button" class="rbtn ${on ? 'on' : ''}" data-chk="${key}" aria-pressed="${on}">${ic('check', 15)}<span>${on ? 'Reviewed' : 'Mark reviewed'}</span></button>
    <button type="button" class="rbtn" data-act="sitemap">${ic('tree', 15)}<span>Index</span><b class="num">${done}/${tot}</b></button>
    <button type="button" class="rbtn ${S.notes ? 'on' : ''}" data-act="notes">${ic('note', 15)}<span>Notes</span></button></div>`;
}

/* ── Tips of the icon sidebar ─────────────────────────────────────────
   The column scrolls, so a tip inside it would be cut: there is one, outside the column, placed next
   to the icon. With labels under the icons the tip shows only if the label is cut. */
function sideTip(el) {
  let tip = document.getElementById('side-tip');
  if (!el) {
    if (tip) tip.hidden = true;
    return;
  }
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'side-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  const r = el.getBoundingClientRect();
  tip.textContent = el.dataset.stip;
  tip.hidden = false;
  tip.style.left = r.right + 10 + 'px';
  tip.style.top = r.top + r.height / 2 + 'px';
}
function sideTipTarget(e) {
  const el = e.target.closest && e.target.closest('[data-stip]');
  if (!el || !el.closest('.side.mini')) return null;
  const sp = el.closest('.side.labels') && el.querySelector('span');
  return sp && sp.scrollWidth <= sp.clientWidth && sp.scrollHeight <= sp.clientHeight + 1
    ? null
    : el;
}
document.addEventListener('mouseover', (e) => sideTip(sideTipTarget(e)));
document.addEventListener('focusin', (e) => sideTip(sideTipTarget(e)));
document.addEventListener('focusout', () => sideTip(null));
document.addEventListener('scroll', () => sideTip(null), true);

/* ── Rendering ───────────────────────────────────────────────────────── */

function render() {
  setSub(null);
  applyPreset();
  sideTip(null);
  const stage = document.getElementById('stage');
  // The sign-in is a page of its own: no band and no sidebar.
  const html =
    S.route === 'login'
      ? secLogin(S) + toastHtml() + notesHtml() + indexHtml()
      : shellA((SECTIONS[S.route] || secHome)(S)) +
        notesHtml() +
        toastHtml() +
        themeMenuHtml() +
        langMenuHtml() +
        helpMenuHtml() +
        bellMenuHtml() +
        userMenuHtml() +
        tenantMenuHtml() +
        modalHtml() +
        indexHtml();
  document.getElementById('rev').innerHTML = reviewBar();
  stage.innerHTML = html;
  stage.classList.toggle('with-notes', S.notes);
  try {
    localStorage.setItem(
      'mk-mockup-state',
      JSON.stringify({
        role: S.role,
        route: S.route,
        notes: S.notes,
        side: S.side,
        sideLabels: S.sideLabels,
        mode: S.mode,
        preset: S.preset,
      }),
    );
  } catch (e) {
    /* no storage */
  }
  if (S.route === 'login') return;
  document.querySelectorAll('[data-ind]').forEach((el) => {
    el.indeterminate = true;
  });
  if (S.modal === 'cmd') {
    const q = document.querySelector('[data-cmdq]');
    if (q && document.activeElement !== q) {
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
    }
  }
  // On a phone every row of a table becomes a card: the cells carry the name of their column.
  document.querySelectorAll('#stage .tbl:not(.perm):not(.matrix):not(.macc)').forEach((tb) => {
    const hs = [...tb.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (!hs.length) return;
    tb.classList.add('cardable');
    tb.querySelectorAll('tbody tr').forEach((tr) =>
      [...tr.children].forEach((td, i) => {
        if (hs[i] && !td.classList.contains('cbx')) td.dataset.l = hs[i];
      }),
    );
  });
  // The logo in the band takes the variant for dark backgrounds when the band is dark, whatever the mode.
  document.querySelectorAll('.band').forEach((b) => {
    const h = b.querySelector('.side-h, .top'),
      m = h && getComputedStyle(h).backgroundColor.match(/\d+/g);
    if (m) b.classList.toggle('navdark', 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2] < 140);
  });
  if (S.msKeep) {
    const inp = document.querySelector(`[data-msq="${S.msKeep}"]`);
    if (inp) {
      inp.focus();
      inp.closest('.ms').classList.add('open');
    }
    S.msKeep = null;
  }
  const secOn = document.querySelector('.dside-nav .secnav-l .on');
  if (secOn && secOn.parentElement.scrollWidth > secOn.parentElement.clientWidth)
    secOn.parentElement.scrollLeft = secOn.offsetLeft - 12;
  // A page without actions on the selection has no boxes either.
  if (document.querySelector('.rpage .rc-b') && !document.querySelector('.rc-h .bulk, .mg-bar .bulk'))
    document.querySelectorAll('.rc-b .selbox, .rc-b .cbx').forEach((el) => el.remove());
  // Where there is a fixed header, the rest of the page goes in a body that scrolls by itself.
  const page = document.querySelector('.main > .page');
  const head0 = page && page.querySelector(':scope > .lhead');
  if (head0) {
    const body = document.createElement('div');
    body.className = 'pbody';
    while (head0.nextSibling) body.appendChild(head0.nextSibling);
    page.appendChild(body);
    page.classList.add('has-lh');
  }
  const main = document.querySelector('.main');
  const fc = document.querySelector('.pbody.flush > .rlay > .facets');
  if (fc && window.innerWidth > 900) fc.style.height = fc.closest('.pbody').clientHeight + 'px';
  // On a narrow screen the filter column opens over the content, in the space of the page body.
  const fo = document.querySelector('.facets.open'),
    pb = document.querySelector('.rpage');
  if (fo && pb && window.innerWidth <= 900) {
    const r = pb.getBoundingClientRect();
    [fo, document.querySelector('.fscrim')].forEach((el) => {
      if (el) {
        el.style.top = r.top + 'px';
        el.style.left = r.left + 'px';
        el.style.height = r.height + 'px';
      }
    });
  }
  const lh = document.querySelector('.lhead');
  if (main && lh) main.style.setProperty('--lh', lh.offsetHeight + 'px');
  if (main && render.scrollTop) main.scrollTop = 0;
  render.scrollTop = false;
}

/* Signing in. People enter their home tenant (guests switch from the logo at the top); administrators
   enter the platform after the second factor, the first time after registering the app. */
function loginAdvance() {
  const L = S.login;
  if (L.door === 'admin') {
    const first = L.user === 'g.bassi';
    if (L.step === 'cred') S.login = Object.assign({}, L, { step: first ? 'setup' : 'totp', err: 0 });
    else if (L.step === 'setup') S.login = Object.assign({}, L, { step: 'codes' });
    else return loginEnter('Mosaikit (Platform)', 'Administrator', true);
    render();
    return;
  }
  const acc = loginFind(L.tenant || (L.host === 'one' || L.host === 'pre' ? loginTenants(S)[0].slug : ''), L.user);
  const home = acc.tenants.find((m) => m[2] === 'home') || acc.tenants[0];
  loginEnter(home[0], home[1], false, acc.prof);
}
function loginEnter(name, roleName, admin, prof) {
  const role = admin
    ? 'admin'
    : roleName === 'Tenant Manager'
      ? 'manager'
      : 'user';
  const tn = TENANT_SEL.find((x) => x.name === name);
  S.role = role;
  S.tenant = admin ? null : tn ? tn.id : 'example-city';
  S.home = S.tenant;
  S.login = null;
  S.tab = {};
  go(LANDING[role]);
}
function go(route) {
  Object.assign(S, {
    filtersOpen: false,
    sortMenu: null,
    route,
    logSel: null,
    userMenu: false,
    helpMenu: false,
    langMenu: false,
    bellMenu: false,
    themeMenu: false,
    more: null,
    dirty: {},
    sel: {},
    bulkDone: null,
    tenStMenu: false,
    pStMenu: false,
    featAsk: null,
    featNote: null,
    modal: null,
    map: false,
    drawer: false,
  });
  render.scrollTop = true;
  render();
}

/* ── Events ──────────────────────────────────────────────────────────── */

document.addEventListener('click', (e) => {
  // Menus close on a click outside; the click goes on to its target.
  if (S.themeMenu && !e.target.closest('.tmenu, [data-act="theme"]')) {
    S.themeMenu = false;
    render();
  }
  if (S.langMenu && !e.target.closest('.lmenu, [data-act="langmenu"]')) {
    S.langMenu = false;
    render();
  }
  if (S.helpMenu && !e.target.closest('.hmenu, [data-act="helpmenu"]')) {
    S.helpMenu = false;
    render();
  }
  if (S.bellMenu && !e.target.closest('.bmenu, [data-act="bellmenu"]')) {
    S.bellMenu = false;
    render();
  }
  if (S.userMenu && !e.target.closest('.umenu, [data-act="usermenu"]')) {
    S.userMenu = false;
    render();
  }
  if (S.tenantMenu && !e.target.closest('.tnmenu, [data-act="tenants"]')) {
    S.tenantMenu = false;
    render();
  }
  if (S.more && !e.target.closest('.moremenu, [data-act="more"]')) {
    S.more = null;
    render();
  }
  if (S.sortMenu && !e.target.closest('.sortmenu, [data-act="sortmenu"]')) {
    S.sortMenu = null;
    render();
  }
  const t = e.target.closest(
    '[data-lvlmode],[data-sel],[data-selall],[data-go],[data-act],[data-tab],[data-role],[data-chk],[data-mode],[data-tenant],[data-sort],[data-res]',
  );
  if (!t) return;
  if (t.dataset.mode) {
    S.mode = t.dataset.mode;
    applyMode();
    render();
    return;
  }
  if (t.dataset.lvlmode) {
    S.app[t.dataset.lvlmode].mode = t.dataset.v;
    if (t.dataset.lvlmode === 'tnt') S.cust = Object.assign({}, S.cust, { mode: true });
    S.mode = t.dataset.v;
    applyMode();
    render();
    return;
  }
  if (t.dataset.sort) {
    const [k, v] = t.dataset.sort.split(':');
    S.sortBy = Object.assign({}, S.sortBy, { [k]: v });
    S.sortMenu = null;
    render();
    return;
  }
  if (t.dataset.tenant) {
    S.tenant = t.dataset.tenant;
    S.tenantMenu = false;
    S.drawer = false;
    render();
    return;
  }
  // Multiple selection: the box wins over the clickable row that contains it.
  if (t.dataset.sel || t.dataset.selall) {
    e.stopPropagation();
    S.sel = Object.assign({}, S.sel);
    S.bulkDone = null;
    if (t.dataset.sel) {
      const [k, id] = t.dataset.sel.split(':');
      const cur = S.sel[k] || [];
      S.sel[k] = cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat(id);
    } else {
      const k = t.dataset.selall,
        ids = t.dataset.ids.split(',');
      const cur = S.sel[k] || [];
      S.sel[k] = ids.every((id) => cur.includes(id)) ? [] : ids;
    }
    render();
    return;
  }
  if (t.dataset.chk) {
    const k = t.dataset.chk;
    CHECK[S.role] = CHECK[S.role] || {};
    if (CHECK[S.role][k]) CHECK[S.role][k] = false;
    else CHECK[S.role][k] = true;
    saveCheck();
    render();
    return;
  }
  if (t.dataset.role) {
    S.role = t.dataset.role;
    S.tenant = null;
    S.modal = null;
    S.map = false;
    S.tab = {};
    go(LANDING[S.role]);
    return;
  }
  if (t.dataset.tab) {
    const [k, v] = t.dataset.tab.split(':');
    S.tab[k] = v;
    S.bulkDone = null;
    S.filtersOpen = false;
    render();
    return;
  }
  if (t.dataset.res && t.dataset.res.startsWith('person:')) {
    S.personFrom = S.route;
    S.tab.per = 'prof';
  }
  if (t.dataset.res && t.dataset.res.startsWith('group:')) S.tab.grp = 'set';
  if (t.dataset.res && t.dataset.res.startsWith('mp:')) S.tab.mpm = 'over';
  if (t.dataset.res) {
    const [k, id] = t.dataset.res.split(':');
    S.resId = Object.assign({}, S.resId, { [k]: id });
  }
  if (t.dataset.settab) {
    const [k, v] = t.dataset.settab.split(':');
    S.tab[k] = v;
  }
  if (t.dataset.go) {
    go(t.dataset.go);
    return;
  }
  act(t.dataset.act, t);
});
/* What every data-act does. */
function act(a, t) {
  const v = t.dataset.v;
  if (['usermenu', 'langmenu', 'helpmenu', 'theme', 'tenants'].includes(a)) S.bellMenu = false;
  const slug = () => (S.resId && S.resId.ten) || TENANTS[0].slug;
  if (a === 'close') {
    S.modal = S.modal === 'rolesinfo' && S.prevModal ? S.prevModal : null;
    S.prevModal = null;
    render();
  } else if (a === 'rolesinfo') {
    S.prevModal = S.modal;
    S.modal = 'rolesinfo';
    S.map = false;
    render();
  } else if (a === 'notes') {
    S.notes = !S.notes;
    render();
  } else if (a === 'sitemap') {
    S.map = !S.map;
    render();
  } else if (a === 'drawer') {
    S.drawer = !S.drawer;
    render();
  } else if (a === 'copyid') {
    const id = screenId();
    try {
      navigator.clipboard.writeText(id).catch(() => {});
    } catch (e) {
      /* no clipboard on file:// in some browsers */
    }
    S.toast = 'Screen id: <span class="mono">' + id + '</span>';
    render();
  } else if (a === 'offnav') {
    S.toast = `«${v}» is a page of the ${v} app: its pages come from its extension, not from this mockup.`;
    render();
  } else if (a === 'appopen') {
    const ap = APP(v);
    S.modal = null;
    S.toast = `${ap ? ap.n : 'The app'} opens here, under the same top band: its pages come from its extension, not from this mockup.`;
    render();
  } else if (['tenfeat', 'featyes', 'featno', 'trialext', 'trialafter'].includes(a)) {
    const x = TENANTS.find((y) => y.slug === slug());
    const mgr =
      t.dataset.scope === 'mgr' || (a !== 'tenfeat' && S.featAsk && S.featAsk.scope === 'mgr');
    const on = mgr ? mgrFeats(S) : tenFeats(S, x);
    const set = mgr
      ? (ch) => {
          S.mgrFeat = Object.assign({}, S.mgrFeat, ch);
        }
      : (ch) => {
          S.tenFeat = Object.assign({}, S.tenFeat, { [x.slug]: Object.assign({}, on, ch) });
        };
    const names = (l) => l.map((k) => FEAT(k).n).join(', ');
    S.featNote = null;
    if (a === 'tenfeat') {
      if (on[v]) {
        const deps = featDependents(v, on).filter(
          (d) => !mgr || MGR_FEATS.includes(d) || d.startsWith('ext:'),
        );
        if (deps.length) S.featAsk = { k: v, deps, scope: mgr ? 'mgr' : '' };
        else {
          S.featAsk = null;
          set({ [v]: false });
        }
      } else {
        const req = featRequired(v, on),
          ch = { [v]: true };
        req.forEach((r) => {
          ch[r] = true;
        });
        S.featAsk = null;
        set(ch);
        if (req.length)
          S.featNote = `Also turned on <b>${names(req)}</b>, because ${FEAT(v).n} needs it.`;
      }
    } else if (a === 'featyes' && S.featAsk) {
      const ch = { [S.featAsk.k]: false };
      S.featAsk.deps.forEach((d) => {
        ch[d] = false;
      });
      S.featNote = `Turned off <b>${names([S.featAsk.k, ...S.featAsk.deps])}</b>. The items stay: they come back when it is turned on again.`;
      S.featAsk = null;
      set(ch);
    } else if (a === 'featno') {
      S.featAsk = null;
    } else {
      const tr = tenTrial(S, x);
      if (a === 'trialext') {
        const dd = new Date(tr.to);
        dd.setDate(dd.getDate() + +v);
        tr.to = dd.toISOString().slice(0, 10);
      } else tr.after = v;
      S.tenTrial = Object.assign({}, S.tenTrial, { [x.slug]: tr });
    }
    render();
  } else if (a === 'bulk') {
    const key = t.dataset.key,
      n = (S.sel[key] || []).length;
    const sysN =
      key === 'mp' && /Disable|Uninstall/.test(v)
        ? (S.sel.mp || []).filter((id) => (MP.find((m) => m.id === id) || {}).sys).length
        : 0;
    const guests = /account/.test(v)
      ? (S.sel[key] || []).filter((id) => (PEOPLE.find((p) => p.ini === id) || {}).home).length
      : 0;
    if (key === 'sh') S.revoked = (S.revoked || []).concat((S.sel.sh || []).map(Number));
    S.bulkDone = `<b>${v}</b> on ${n} item${n === 1 ? '' : 's'}.${sysN ? (sysN === 1 ? ' One built-in plugin stays as it is: it updates, but it is neither disabled nor uninstalled.' : ` ${sysN} built-in plugins stay as they are: they update, but they are neither disabled nor uninstalled.`) : ''}${guests ? (guests === 1 ? ' A guest is not deleted: they belong to another tenant, so they are only removed from this one.' : ` ${guests} guests are not deleted: they belong to other tenants, so they are only removed from this one.`) : ''} Nothing changes in the mockup; in the product ${/Delete|Remove|Uninstall|Revoke/.test(v) ? 'it asks first, saying what is lost' : 'it starts at once and goes to the log'}.`;
    S.sel = Object.assign({}, S.sel, { [key]: [] });
    render();
  } else if (a === 'avrm') {
    delete AV_IMG[v];
    S.avErr = null;
    render();
  } else if (a === 'pstmenu') {
    S.pStMenu = !S.pStMenu;
    render();
  } else if (a === 'pst') {
    const id = (S.resId && S.resId.person) || PEOPLE[1].ini;
    S.pSt = Object.assign({}, S.pSt, { [id]: v });
    S.pStMenu = false;
    S.more = null;
    render();
  } else if (a === 'tenstmenu') {
    S.tenStMenu = !S.tenStMenu;
    render();
  } else if (['tenst', 'tenauth', 'tenroles'].includes(a)) {
    const k = { tenst: 'tenSt', tenauth: 'tenAuth', tenroles: 'tenRoles' }[a],
      s = slug();
    if (
      a === 'tenst' &&
      v === 'Trial' &&
      tenSt(
        S,
        TENANTS.find((y) => y.slug === s),
      ) !== 'Trial'
    )
      S.tenTrial = Object.assign({}, S.tenTrial, {
        [s]: { from: TODAY, to: '2026-11-07', after: 'suspended' },
      });
    S[k] = Object.assign({}, S[k], { [s]: v });
    S.tenStMenu = false;
    S.more = null;
    render();
  } else if (a === 'sidemode') {
    S.side = v;
    render();
  } else if (a === 'sidelabels') {
    S.sideLabels = !S.sideLabels;
    render();
  } else if (a === 'sortmenu') {
    S.sortMenu = S.sortMenu === t.dataset.key ? null : t.dataset.key;
    render();
  }
  // The column button: on a wide screen it hides and shows the column, on a narrow one it opens it over the content.
  else if (a === 'filters') {
    if (window.innerWidth <= 900) S.filtersOpen = !S.filtersOpen;
    else S.filtersHidden = !S.filtersHidden;
    render();
  } else if (a === 'nofilters') {
    document.querySelectorAll('.facets input').forEach((i) => {
      i.checked = i.type === 'radio' ? i.closest('fieldset').querySelector('input') === i : false;
    });
  } else if (a === 'reset') {
    delete CHECK[S.role];
    saveCheck();
    render();
  } else if (a === 'themetab') {
    const tt = THEME_TAB[S.role];
    S.themeMenu = false;
    S.tab[tt[1]] = tt[2];
    S.tab.idt = 'theme';
    go(tt[0]);
  } else if (a === 'invprof') {
    S.inv.prof = v;
    render();
  } else if (a === 'invgrp') {
    S.inv.groups = S.inv.groups.includes(v)
      ? S.inv.groups.filter((x) => x !== v)
      : S.inv.groups.concat(v);
    render();
  } else if (a === 'invadv') {
    S.inv.adv = !S.inv.adv;
    render();
  } else if (a === 'invx') {
    if (S.inv.extra[v]) delete S.inv.extra[v];
    else S.inv.extra[v] = 1;
    render();
  } else if (a === 'invex') {
    S.invEmail = v;
    render();
  } else if (a === 'profsel') {
    S.profSel = v;
    render();
  } else if (a === 'profperm') {
    const [pid, k, i] = v.split(':');
    const pr = PROF(pid);
    pr.p[k] = pr.p[k] || MOD_PERMS[k].map(() => 0);
    pr.p[k][+i] = pr.p[k][+i] ? 0 : 1;
    render();
  } else if (a === 'profdef') {
    PROFILES.forEach((p) => {
      p.def = p.id === v;
    });
    render();
  } else if (a === 'profnew') {
    const src = PROF(S.profSel || 'std'),
      id = 'p' + Date.now();
    PROFILES.push({
      id,
      n: 'Copy of ' + src.n,
      d: src.d,
      cnt: 0,
      p: JSON.parse(JSON.stringify(src.p)),
    });
    S.profSel = id;
    render();
  } else if (a === 'proftab') {
    S.tab[PROF_TAB[1]] = PROF_TAB[2];
    go(PROF_TAB[0]);
  } else if (a === 'pproftab') {
    S.tab.per = 'prof';
    render();
  } else if (a === 'okmodal') {
    S.modal = null;
    S.nt = null;
    S.toast = v;
    render();
  } else if (['groupnew', 'rmperson', 'newadmin', 'invite', 'movehome'].includes(a)) {
    if (a === 'invite') {
      S.invEmail = '';
      S.inv = null;
    }
    S.modal = a;
    S.map = false;
    render();
  } else if (a === 'newten') {
    S.nt = null;
    S.modal = 'newten';
    S.map = false;
    render();
  } else if (a === 'ntstep') {
    S.nt.step = Math.max(0, Math.min(3, S.nt.step + +v));
    render();
  } else if (a === 'ntset') {
    S.nt[t.dataset.k] = v;
    render();
  } else if (a === 'memreq') {
    S.tab.mem = 'req';
    go('members');
  } else if (a === 'meminv') {
    S.tab.mem = 'inv';
    go('members');
  } else if (a === 'pat') {
    S.pat = !S.pat;
    S.toast = S.pat
      ? 'Token created. Copy it now: it will not show again.'
      : 'Token revoked: it stops working within a few minutes.';
    render();
  } else if (a === 'req') {
    S.reqDone = Object.assign({}, S.reqDone, { [v.split(':')[1]]: v.split(':')[0] });
    S.toast = v.startsWith('ok')
      ? 'Approved: the share is created and the owner gets a notification.'
      : v.startsWith('fw')
        ? 'Forwarded to the owner.'
        : 'Refused: whoever asked gets a notification.';
    render();
  } else if (a === 'restore') {
    S.restored = (S.restored || []).concat(v);
    S.toast = `«${v}» is back in its place.`;
    render();
  } else if (a === 'fresh') {
    S.fresh = !S.fresh;
    render();
  } else if (a === 'toast') {
    S.toast = v;
    render();
  } else if (a === 'ask') {
    S.askKey = v;
    S.modal = 'confirm';
    S.userMenu = false;
    S.map = false;
    render();
  } else if (a === 'confirm') {
    S.askKey = S.askKey || 'delacc';
    S.modal = 'confirm';
    S.map = false;
    render();
  } else if (a === 'confirmok') {
    const c = CONFIRMS[S.askKey];
    S.modal = null;
    S.toast = c ? c.done : null;
    render();
  } else if (a === 'usermenu') {
    S.userMenu = !S.userMenu;
    S.helpMenu = false;
    S.themeMenu = false;
    S.langMenu = false;
    render();
  } else if (a === 'langmenu') {
    S.langMenu = !S.langMenu;
    S.themeMenu = false;
    S.helpMenu = false;
    S.userMenu = false;
    S.tenantMenu = false;
    render();
  } else if (a === 'setlang') {
    S.lang = v;
    S.langMenu = false;
    S.toast = 'In the product the interface switches language at once; the mockup stays in English.';
    render();
  } else if (a === 'cust') {
    // A customizable setting: «Customize» makes it of this tenant, «Restore» takes the platform's again.
    S.cust = Object.assign({}, S.cust, { [v]: !(S.cust && S.cust[v]) });
    if (!S.cust[v] && v in S.app.sys) S.app.tnt[v] = S.app.sys[v];
    if (v === 'fmt') S.app.tnt.fmtSame = !S.cust.fmt;
    render();
  } else if (a === 'qcust') {
    const x = TENANTS.find((y) => y.slug === slug()),
      own = qCust(S, x, v);
    S.tenQc = Object.assign({}, S.tenQc, { [x.slug]: Object.assign({}, S.tenQc && S.tenQc[x.slug], { [v]: !own }) });
    if (own) S.tenQ = Object.assign({}, S.tenQ, { [x.slug]: Object.assign({}, S.tenQ && S.tenQ[x.slug], { [v]: QDEF[v] }) });
    render();
  } else if (a === 'barset') {
    S.app.sys.bar = Object.assign({}, S.app.sys.bar, { [v]: !S.app.sys.bar[v] });
    render();
  } else if (a === 'revoke') {
    S.revoked = (S.revoked || []).concat(+v);
    S.toast = 'Share revoked: the owner gets a notification.';
    render();
  } else if (a === 'more') {
    S.more = S.more === v ? null : v;
    render();
  } else if (a === 'dirtyno' || a === 'dirtyok') {
    S.dirty = Object.assign({}, S.dirty, { [v]: false });
    S.toast = a === 'dirtyok' ? 'Saved.' : null;
    render();
  } else if (a === 'bellmenu') {
    S.bellMenu = !S.bellMenu;
    S.userMenu = false;
    S.helpMenu = false;
    S.themeMenu = false;
    S.langMenu = false;
    S.tenantMenu = false;
    render();
  } else if (a === 'readall') {
    S.readAll = true;
    S.toast = 'All marked as read.';
    render();
  } else if (a === 'accgo') {
    // A section of Account, from the palette, the bell or a link.
    S.tab.acc = String(Math.max(0, accIds(S).indexOf(v)));
    go('account');
  } else if (a === 'helpmenu') {
    S.helpMenu = !S.helpMenu;
    S.userMenu = false;
    S.themeMenu = false;
    S.langMenu = false;
    render();
  } else if (a === 'theme') {
    S.themeMenu = !S.themeMenu;
    S.langMenu = false;
    S.helpMenu = false;
    S.userMenu = false;
    S.tenantMenu = false;
    render();
  } else if (a === 'sidetoggle') {
    // on a narrow screen the sidebar is a drawer over the page; otherwise it opens and closes in place
    if (innerWidth <= 900) S.drawer = !S.drawer;
    else S.side = S.side === 'open' ? 'mini' : 'open';
    S.tenantMenu = false;
    render();
  } else if (a === 'tenants') {
    S.tenantMenu = !S.tenantMenu;
    S.userMenu = false;
    S.themeMenu = false;
    render();
  } else if (a === 'hc') {
    S.hc = !S.hc;
    render();
  } else if (a === 'appset') {
    // A default of the platform or of the tenant. Whoever changes it sees it at once on themselves too.
    const L = S.app[t.dataset.lvl],
      k = t.dataset.k;
    L[k] = t.dataset.toggle ? !L[k] : k === 'labels' ? !L.labels : v;
    if (k === 'theme') S.preset = v;
    if (k === 'side') S.side = v;
    if (k === 'labels') S.sideLabels = L.labels;
    if (t.dataset.lvl === 'tnt' && ['theme', 'side', 'labels'].includes(k))
      S.cust = Object.assign({}, S.cust, { [k === 'labels' ? 'side' : k]: true });
    render();
  } else if (a === 'syscust') {
    S.app.sys.cust = Object.assign({}, S.app.sys.cust, { [v]: !S.app.sys.cust[v] });
    render();
  } else if (a === 'applang') {
    const L = S.app[t.dataset.lvl];
    if (L.langs.includes(v)) {
      if (L.lang !== v) L.langs = L.langs.filter((x) => x !== v);
    } else L.langs = L.langs.concat(v);
    if (t.dataset.lvl === 'sys')
      S.app.tnt.langs = S.app.tnt.langs.filter((x) => L.langs.includes(x));
    render();
  } else if (a === 'appthemeav') {
    const L = S.app.sys;
    if (L.themes.includes(v)) {
      if (L.theme !== v) L.themes = L.themes.filter((x) => x !== v);
    } else L.themes = L.themes.concat(v);
    render();
  } else if (a === 'tenew' || a === 'teedit') {
    const c = a === 'teedit' ? S.customThemes.find((x) => x.id === v) : null;
    S.te = c
      ? JSON.parse(JSON.stringify(c))
      : {
          name: '',
          accent: S.role === 'manager' ? '#1f4e79' : '#5b5fc7',
          bar: 'color',
          grays: 'neutral',
          adv: {},
          scope: S.role === 'admin' ? 'sys' : 'tnt',
        };
    go('themeedit');
  } else if (a === 'teset') {
    S.te[t.dataset.k] = v;
    if (t.dataset.k === 'accent') S.te.adv = {};
    render();
  } else if (a === 'telogo') {
    S.te.props = true;
    render();
  } else if (a === 'tepick') {
    Object.assign(S.te, teProposals(S)[+v], { adv: {} });
    render();
  } else if (a === 'tefix') {
    // Fixes each mode on its own: light gets darker, dark gets lighter, until everything reads.
    for (let i = 0; i < 40; i++) {
      const p = makePreset(S.te),
        bad = themeChecks(p, teLogo(S)).filter((c) => c[1] < c[2]);
      if (!bad.length) break;
      const adv = Object.assign({}, S.te.adv);
      bad.forEach((c) => {
        const dark = c[0].endsWith('dark'),
          pv = dark ? p.dark : p.light;
        if (/top band/.test(c[0]) && !/Logo/.test(c[0])) {
          adv[dark ? 'barD' : 'barL'] = mix(
            pv.nav[0],
            dark || lum(pv.nav[0]) < 0.45 ? '#000000' : '#ffffff',
            0.1,
          );
        } else if (/Logo/.test(c[0])) {
          adv[dark ? 'barD' : 'barL'] = mix(
            pv.nav[0],
            lum(teLogo(S)) < 0.2 ? '#ffffff' : '#000000',
            0.12,
          );
        } else if (dark) adv.accD = mix(pv.accent[0], '#ffffff', 0.1);
        else adv.accL = mix(pv.accent[0], '#000000', 0.08);
      });
      S.te.adv = adv;
    }
    render();
  } else if (a === 'tesave') {
    const id = S.te.id || 'theme-' + (S.customThemes.length + 1);
    const c = Object.assign({}, S.te, {
      id,
      name: S.te.name || 'Theme ' + (S.customThemes.length + 1),
    });
    delete c.props;
    S.customThemes = S.customThemes.filter((x) => x.id !== id).concat(c);
    const p = makePreset(c),
      k = PRESETS.findIndex((x) => x.id === id);
    if (k >= 0) PRESETS[k] = p;
    else PRESETS.push(p);
    if (c.scope === 'sys' && !S.app.sys.themes.includes(id)) S.app.sys.themes.push(id);
    S.te = null;
    const tt = THEME_TAB[S.role];
    S.tab[tt[1]] = tt[2];
    S.tab.idt = 'theme';
    go(tt[0]);
    S.bulkDone = `Theme «${c.name}» saved: now it can be chosen as the default.`;
    render();
  } else if (a === 'newuser') {
    S.newUser = {};
    S.resId = Object.assign({}, S.resId, { person: 'NEW' });
    S.personFrom = 'gusers';
    go('person');
  } else if (a === 'nucreate') {
    // In the mockup the new person joins the list, and their page opens.
    const N = S.newUser,
      base = (N.first[0] + N.last[0]).toUpperCase(),
      ini = base + (PEOPLE.some((p) => p.ini === base) ? PEOPLE.length : '');
    const home = TENANTS.find((x) => x.n === N.home);
    PEOPLE.push({
      n: `${N.first} ${N.last}`,
      ini,
      mail: N.email,
      role: N.role || 'User',
      prof: N.prof || 'std',
      groups: ['—'],
      st: 'Invited',
      via: /^OIDC/.test(home.auth) ? 'SSO' : 'Local',
      last: 'Never',
      c: 2,
      home: N.home === 'Example City' ? undefined : N.home,
      assoc: N.assoc || [],
    });
    S.newUser = null;
    S.resId = Object.assign({}, S.resId, { person: ini });
    S.tab.per = 'ten';
    go('person');
  } else if (a === 'modacc') {
    S.modKey = v;
    go('module');
  } else if (a === 'mpinstall') {
    // Installed, an extension becomes a plugin of tenants (off until the administrator enables it).
    const m = MP_CATALOG.find((x) => x.id === v);
    S.mpInst = (S.mpInst || []).concat(m.id);
    MP.push(Object.assign({}, m, { tenants: [] }));
    FEATS.push(extFeat(m));
    MOD_PERMS['ext:' + m.id] = m.perms || [];
    MOD_GRANTS['ext:' + m.id] = [
      ['building', 'Whole tenant', '128 people', (m.perms || []).map(() => 1)],
    ];
    S.bulkDone = `<b>${m.n}</b> installed. It is off in every tenant: it is enabled from its page, Tenants tab, or from the page of each tenant.`;
    S.resId = Object.assign({}, S.resId, { mp: m.id });
    render();
  } else if (a === 'mpupdate') {
    const list = v
      ? MP.filter((x) => x.id === v)
      : MP.filter((x) => x.next && !(S.mpUpd || []).includes(x.id));
    list.forEach((m) => {
      if (m.next) {
        S.mpUpd = (S.mpUpd || []).concat(m.id);
        m.ver = m.next;
      }
    });
    S.toast =
      list.length === 1
        ? `<b>${list[0].n}</b> updated to ${list[0].ver}.`
        : `${list.length} plugins updated.`;
    render();
  } else if (a === 'mpten') {
    const m = MP.find((x) => x.id === (S.resId && S.resId.mp)),
      k = m.sys || 'ext:' + m.id,
      x = TENANTS.find((y) => y.slug === v),
      on = tenFeats(S, x)[k];
    S.tenFeat = Object.assign({}, S.tenFeat, {
      [v]: Object.assign({}, S.tenFeat && S.tenFeat[v], { [k]: !on }),
    });
    render();
  } else if (
    [
      'lfx',
      'lfset',
      'lfdel',
      'lfok',
      'lfper',
      'lfclear',
      'logsel',
      'logclose',
      'logexport',
      'logperson',
    ].includes(a)
  ) {
    const k = S.route === 'audit' ? 'aud' : 'act',
      F = logF(S, k);
    if (a === 'lfx') {
      const kk = t.dataset.k;
      F[kk] = F[kk].includes(v) ? F[kk].filter((x) => x !== v) : F[kk].concat(v);
      if (t.closest('.ms-dd')) S.msKeep = kk;
    } else if (a === 'lfset') {
      const kk = t.dataset.k;
      if (!F[kk].includes(v)) F[kk] = F[kk].concat(v);
      S.logSel = null;
    } else if (a === 'lfdel') {
      const kk = t.dataset.k;
      if (kk === 'ok') F.ok = 'all';
      else if (kk === 'per') F.per = '30';
      else if (kk === 'q') F.q = '';
      else F[kk] = F[kk].filter((x) => x !== v);
    } else if (a === 'lfok') F.ok = v;
    else if (a === 'lfper') F.per = v;
    else if (a === 'lfclear') {
      delete S.lf[k];
      logF(S, k);
    } else if (a === 'logsel') S.logSel = S.logSel === +v ? null : +v;
    else if (a === 'logclose') S.logSel = null;
    else if (a === 'logexport')
      S.bulkDone = `<b>${logRows(S, k).length} events exported</b>, with the active filters, to a CSV file.`;
    else if (a === 'logperson') {
      // From the page of a person: the log already filtered.
      const kk = S.role === 'admin' ? 'aud' : 'act';
      S.lf = S.lf || {};
      delete S.lf[kk];
      const G = logF(S, kk);
      G.who = [v];
      G.per = 'all';
      S.logSel = null;
      go(S.role === 'admin' ? 'audit' : 'activity');
      return;
    }
    render();
  } else if (a === 'monper') {
    S.monPer = v;
    render();
  } else if (a === 'monsel') {
    S.monSel = S.monSel === v ? null : v;
    render();
  } else if (a === 'monlog') {
    S.lf = S.lf || {};
    delete S.lf.aud;
    const G = logF(S, 'aud');
    G.ok = 'ko';
    G.per = 'all';
    go('audit');
  } else if (a === 'keyedit') {
    S.keyEdit = S.keyEdit === v ? null : v;
    render();
  } else if (a === 'keysave') {
    const [lv, id] = v.split(':');
    S.keys[lv][id] = { tail: Math.random().toString(16).slice(2, 6), share: false };
    S.keyEdit = null;
    render();
  } else if (a === 'keydel') {
    const [lv, id] = v.split(':');
    delete S.keys[lv][id];
    render();
  } else if (a === 'keyshare') {
    const [lv, id] = v.split(':');
    S.keys[lv][id].share = !S.keys[lv][id].share;
    render();
  } else if (a === 'systest') {
    S.sysTest = true;
    render();
  } else if (a === 'sysbackup') {
    S.sysBackupRun = true;
    render();
  } else if (a === 'sysrestore') {
    S.restoreSel = S.restoreSel === v ? null : v;
    render();
  } else if (a === 'sysgo') {
    S.tab.sys = v;
    go('system');
  } else if (a === 'logout') {
    S.userMenu = false;
    S.login = { door: 'tenant', step: 'cred' };
    go('login');
  } else if (a === 'loginpage') {
    S.login = { door: 'tenant', step: 'cred' };
    S.themeMenu = false;
    go('login');
  } else if (a === 'loginex') {
    S.login = v.startsWith('admin')
      ? { door: 'admin', step: 'cred', user: t.dataset.u }
      : { door: 'tenant', step: 'cred', tenant: v, user: t.dataset.u };
    render();
  } else if (a === 'loginadmin') {
    S.login = { door: 'admin', step: 'cred' };
    render();
  } else if (a === 'logintenant') {
    S.login = { door: 'tenant', step: 'cred' };
    render();
  } else if (a === 'loginrec') {
    S.login = Object.assign({}, S.login, { rec: !S.login.rec });
    render();
  } else if (a === 'lgmode') {
    const k = MODES.map((m) => m[0]);
    S.mode = k[(k.indexOf(S.mode) + 1) % k.length];
    applyMode();
    render();
  } else if (a === 'loginhost') {
    S.login = { door: 'tenant', step: 'cred', host: v };
    render();
  } else if (a === 'loginok') {
    loginAdvance();
  } else if (a === 'cmdf') {
    S.cmdF = v;
    render();
  } else if (a === 'cmd') {
    S.cmdQ = '';
    S.cmdF = 'All';
    S.modal = 'cmd';
    S.map = false;
    S.userMenu = false;
    render();
  } else if (a === 'share' || a === 'new') {
    if (a === 'share') S.shareRes = v || null;
    S.modal = a;
    S.map = false;
    render();
  }
}

// The drawer is only for narrow screens: widening the window closes it.
window.addEventListener('resize', () => {
  if ((S.drawer || S.filtersOpen) && window.innerWidth > 900) {
    S.drawer = false;
    S.filtersOpen = false;
    render();
  }
});

document.addEventListener('keydown', (e) => {
  if (
    S.modal === 'cmd' &&
    ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key) &&
    e.target.matches &&
    e.target.matches('[data-cmdq]')
  ) {
    const list = [...document.querySelectorAll('.cmdr .cr')],
      cur = list.findIndex((b) => b.classList.contains('on'));
    if (e.key === 'Enter') {
      if (list[Math.max(cur, 0)]) {
        e.preventDefault();
        list[Math.max(cur, 0)].click();
      }
      return;
    }
    e.preventDefault();
    const nx = Math.min(list.length - 1, Math.max(0, cur + (e.key === 'ArrowDown' ? 1 : -1)));
    list.forEach((b, k) => {
      b.classList.toggle('on', k === nx);
      const kb = b.querySelector('kbd');
      if (kb) kb.remove();
    });
    if (list[nx]) {
      list[nx].insertAdjacentHTML('beforeend', '<kbd>Enter</kbd>');
      list[nx].scrollIntoView({ block: 'nearest' });
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && S.route !== 'login' && bar().search) {
    e.preventDefault();
    S.cmdQ = '';
    S.cmdF = 'All';
    S.modal = 'cmd';
    S.userMenu = false;
    render();
  } else if (e.key === 'Escape') {
    document.querySelectorAll('.ms.open').forEach((x) => x.classList.remove('open'));
    if (S.modal || S.map || S.themeMenu || S.langMenu || S.helpMenu || S.bellMenu || S.userMenu || S.tenantMenu || S.sortMenu) {
      Object.assign(S, {
        modal: null,
        map: false,
        themeMenu: false,
        langMenu: false,
        helpMenu: false,
        bellMenu: false,
        userMenu: false,
        tenantMenu: false,
        sortMenu: null,
      });
      render();
    }
  }
});

/* The first change in a block of fields brings the save bar, without drawing the page again. */
function markDirty(el) {
  const dz = el.closest && el.closest('[data-dirty]');
  if (!dz) return;
  const k = dz.dataset.dirty;
  if (S.dirty && S.dirty[k]) return;
  S.dirty = Object.assign({}, S.dirty, { [k]: true });
  if (!document.querySelector(`[data-savebar="${k}"]`)) dz.insertAdjacentHTML('afterend', saveBar(S, k));
}
/* Form fields: what changes while typing, without drawing the field again. */
document.addEventListener('input', (e) => {
  const el = e.target;
  markDirty(el);
  if (el.id === 'inv-email') {
    S.invEmail = el.value;
    const inf = inviteInfo(S);
    document.getElementById('inv-info').innerHTML = inf.html;
    document.getElementById('inv-send').disabled = !inf.ok;
    return;
  }
  if (el.dataset && el.dataset.nu) {
    S.newUser = Object.assign({}, S.newUser, { [el.dataset.nu]: el.value });
    const N = S.newUser,
      ok = !!(N.home && N.first && N.last && N.email && /@/.test(N.email));
    const b = document.querySelector('[data-act="nucreate"]');
    if (b) b.disabled = !ok;
    return;
  }
  if (el.matches && el.matches('[data-te-name]') && S.te) {
    S.te.name = el.value;
    return;
  }
  if (el.matches && el.matches('[data-cmdq]')) {
    S.cmdQ = el.value;
    const box = document.querySelector('.cmdr');
    if (box) box.innerHTML = cmdResults();
    const pills = document.querySelector('.cmd-pills');
    if (pills) pills.innerHTML = cmdPills();
    return;
  }
  if (el.matches && el.matches('[data-msq]')) {
    S.msQ = Object.assign({}, S.msQ, { [el.dataset.msq]: el.value });
    const box = el.closest('.ms');
    box.classList.add('open');
    box.querySelector('.ms-dd').innerHTML = msItems(
      S,
      S.route === 'audit' ? 'aud' : 'act',
      el.dataset.msq,
    );
  }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (!el.matches) return;
  markDirty(el);
  if (el.matches('[data-avatar]') && el.files && el.files[0]) {
    const f = el.files[0],
      ini = el.dataset.avatar;
    S.avErr = null;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) {
      S.avErr = { ini, msg: 'It must be a PNG, JPG or WebP image.' };
      render();
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      S.avErr = {
        ini,
        msg: `The image weighs ${(f.size / 1048576).toFixed(1)} MB: the maximum is 2 MB.`,
      };
      render();
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      AV_IMG[ini] = r.result;
      render();
    };
    r.readAsDataURL(f);
  } else if (el.matches('[data-nuhome]')) {
    S.newUser = Object.assign({}, S.newUser, {
      home: el.value,
      assoc: ((S.newUser || {}).assoc || []).filter((x) => x !== el.value),
    });
    render();
  } else if (el.matches('[data-nu-sel]')) {
    S.newUser = Object.assign({}, S.newUser, { [el.dataset.nuSel]: el.value });
    render();
  } else if (el.matches('[data-nuassoc]')) {
    const cur = (S.newUser || {}).assoc || [],
      n = el.dataset.nuassoc;
    S.newUser = Object.assign({}, S.newUser, {
      assoc: cur.includes(n) ? cur.filter((x) => x !== n) : cur.concat(n),
    });
    render();
  }
  // Theme editor: the colour applies when the picker closes.
  else if (el.matches('[data-te]') && S.te) {
    const k = el.dataset.te;
    if (k === 'accent') {
      S.te.accent = el.value;
      S.te.adv = {};
    } else S.te.adv = Object.assign({}, S.te.adv, { [k]: el.value });
    render();
  } else if (el.matches('[data-logintenant]')) {
    S.login = Object.assign({}, S.login, { tenant: el.value, err: 0 });
    render();
  } else if (el.matches('[data-melang]')) {
    S.lang = el.value;
    S.toast =
      'In the product the interface switches language at once; the mockup stays in English.';
    render();
  } else if (el.matches('[data-tabsel]')) {
    S.tab[el.dataset.tabsel] = el.value;
    render();
  } else if (el.matches('[data-whynot]')) {
    S.whyItem = el.value;
    render();
  } else if (el.matches('[data-invrole]')) {
    S.inv.role = el.value;
    render();
  } else if (el.matches('[data-pprof]')) {
    const id = (S.resId && S.resId.person) || PEOPLE[1].ini;
    S.pProf = Object.assign({}, S.pProf, { [id]: el.value });
    render();
  } else if (el.matches('[data-prole]')) {
    const id = (S.resId && S.resId.person) || PEOPLE[1].ini;
    S.pRole = Object.assign({}, S.pRole, { [id]: el.value });
    render();
  } else if (el.matches('[data-applangdef]')) {
    S.app[el.dataset.applangdef].lang = el.value;
    render();
  } else if (el.matches('[data-appf]')) {
    const [lv, k] = el.dataset.appf.split(':');
    S.app[lv][k] = el.value;
    if (k === 'land') S.app[lv].landId = '';
    render();
  } else if (el.matches('[data-lfsearch]')) {
    logF(S, el.dataset.lfsearch).q = el.value.trim();
    render();
  } else if (el.matches('[data-lfdate]')) {
    logF(S, S.route === 'audit' ? 'aud' : 'act')[el.dataset.lfdate] = el.value;
    render();
  } else if (el.matches('[data-trial]') && el.value) {
    const x = TENANTS.find((y) => y.slug === ((S.resId && S.resId.ten) || TENANTS[0].slug)),
      tr = tenTrial(S, x);
    tr[el.dataset.trial] = el.value;
    S.tenTrial = Object.assign({}, S.tenTrial, { [x.slug]: tr });
    render();
  }
});
/* Sign-in: credentials (the password «wrong» simulates an error), then the second factor for administrators. */
document.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-form="login"]')) return;
  e.preventDefault();
  const u = document.getElementById('lg-user');
  if (u) S.login = Object.assign({}, S.login, { user: u.value.trim() });
  const pw = document.getElementById('lg-pwd');
  if (pw && pw.value.trim().toLowerCase() === 'wrong') {
    S.login = Object.assign({}, S.login, { err: (S.login.err || 9) - 1 });
    render();
    return;
  }
  loginAdvance();
});
/* Multiple choice with search: it opens on focus and closes on a click elsewhere. */
document.addEventListener('focusin', (e) => {
  const ms = e.target.closest && e.target.closest('.ms');
  document.querySelectorAll('.ms.open').forEach((x) => {
    if (x !== ms) x.classList.remove('open');
  });
  if (ms) {
    ms.classList.add('open');
    const i = ms.querySelector('[data-msq]');
    if (i) i.setAttribute('aria-expanded', 'true');
  }
});
document.addEventListener('mousedown', (e) => {
  if (!(e.target.closest && e.target.closest('.ms')))
    document.querySelectorAll('.ms.open').forEach((x) => x.classList.remove('open'));
});

(function boot() {
  let first = true;
  try {
    const saved = JSON.parse(localStorage.getItem('mk-mockup-state') || 'null');
    if (saved && ROLES[saved.role]) {
      Object.assign(S, saved);
      first = false;
    }
  } catch (e) {
    /* start from the beginning */
  }
  if (!SECTIONS[S.route] || (S.route === 'person' && !(S.resId && S.resId.person)))
    S.route = LANDING[S.role];
  if (S.route === 'login') S.login = { door: 'tenant', step: 'cred' };
  // Logos are measured on the font: when the fonts arrive, measure and draw again.
  if (document.fonts && document.fonts.ready)
    document.fonts.ready.then(() => {
      for (const k in _tw) delete _tw[k];
      render();
    });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (S.mode === 'auto') render();
  });
  applyMode();
  if (window.innerWidth >= 1500 && first) S.notes = true;
  document.documentElement.lang = 'en';
  render();
})();

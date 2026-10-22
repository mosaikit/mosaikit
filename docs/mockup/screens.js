// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/* eslint-disable -- plain browser scripts of a static mockup: they share globals across files */

/* Mosaikit mockup: the screens of people and of the tenant. Every screen is a function of
   the state S that returns HTML; the ones of the platform administrator are in platform.js. */


/* ── Sign-in ──────────────────────────────────────────────────────────
   Two doors. People pick their tenant from a list (hidden when the installation has only one, or
   when the address names it) and sign in the way that tenant decided: username and password kept by
   Mosaikit, or the external identity provider of the tenant (OIDC: Keycloak or the one of the
   customer). Guests sign in from their own tenant and then switch from the logo at the top.
   Administrators have their own page, always local, with the second factor (TOTP): it works even
   when every tenant uses an outside provider, or when one of them does not answer. */
const LOGIN_EX = [
  ['example-city', 'd.conti', 'OIDC, three tenants'],
  ['example-city', 'e.ricci', 'OIDC, manager'],
  ['green-region', 'r.leone', 'local account'],
  ['admin', 'p.ferri', 'administrator'],
  ['admin-new', 'g.bassi', 'administrator, first sign-in'],
];
/* The tenants offered on the page: active and on trial ones (a suspended one does not let anybody in). */
function loginTenants(S) {
  return TENANTS.filter((x) => tenSt(S, x) !== 'Suspended');
}
function tenAuthOf(S, slug) {
  return (S.tenAuth && S.tenAuth[slug]) || (TEN_EXTRA[slug] || {}).auth || 'local';
}
/* Who signs in: the sample account of that tenant and username, or the first one of the tenant. */
function loginFind(slug, user) {
  const tn = TENANTS.find((x) => x.slug === slug);
  const all = Object.entries(ACCOUNTS).filter(([, a]) => !a.admin && tn && a.home === tn.n);
  const hit = all.find(([mail]) => mail.split('@')[0] === (user || '').trim().toLowerCase()) || all[0];
  return hit ? hit[1] : { who: 'Somebody', home: tn ? tn.n : '', tenants: [[tn ? tn.n : '', 'User', 'home']] };
}
/* A stand-in for the QR code: a fixed pattern with the three corner marks. */
function qrArt() {
  const n = 25,
    cells = [];
  const mark = (x, y) => x < 7 && y < 7 && (x % 6 === 0 || y % 6 === 0 || (x > 1 && x < 5 && y > 1 && y < 5));
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const m = mark(x, y) || mark(n - 1 - x, y) || mark(x, n - 1 - y);
      const inMark = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
      if (m || (!inMark && (x * 7 + y * 13 + x * y) % 5 < 2)) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
    }
  return `<svg viewBox="-2 -2 ${n + 4} ${n + 4}" aria-hidden="true"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><g fill="#111">${cells.join('')}</g></svg>`;
}
function loginBrand(S) {
  const plat = (S.login || {}).door === 'admin';
  return {
    plat,
    name: plat ? S.app.sys.name : S.app.tnt.name,
    welcome: plat ? S.app.sys.welcome : S.app.tnt.welcome,
    host: plat ? 'apps.example.org/#/admin' : 'apps.example.org',
  };
}
function secLogin(S) {
  setSub(null);
  const L = S.login || (S.login = { door: 'tenant', step: 'cred' });
  const B = loginBrand(S);
  const err = (t) => `<p class="lg-err">${ic('alert', 14)} ${t}</p>`;
  const submit = (label) => btn(label, { kind: 'pri' }).replace('type="button"', 'type="submit"');
  let body;
  if (L.door === 'admin') {
    const restart = `<p class="lg-switch"><button type="button" class="lg-door" data-act="loginadmin">← Start again</button></p>`;
    if (L.step === 'totp') {
      body = `<div class="lg-title"><h1>${ic('key', 20)} Second step</h1><p>Write the 6-digit code of your authenticator app${L.rec ? ', or one of your recovery codes' : ''}.</p></div>
        <form class="lg-form" data-form="login"><label class="lbl">${L.rec ? 'Recovery code' : 'Code'}<input type="text" id="lg-code" ${L.rec ? 'placeholder="abcd-efgh"' : 'inputmode="numeric" value="482 913"'} autocomplete="one-time-code" class="mono lg-code"></label>${submit('Verify')}</form>
        <button type="button" class="lg-link" data-act="loginrec">${L.rec ? 'Use the code of the app' : 'Lost the phone? Use a recovery code'}</button>
        <p class="lg-reg muted small">No phone and no recovery code: another administrator removes your second factor, or, from the console of the server, <span class="mono">reset-totp --user ${L.user || 'admin'}</span>.</p>${restart}`;
    } else if (L.step === 'setup') {
      body = `<div class="lg-title"><h1>${ic('key', 20)} Register the app</h1><p>First sign-in: scan the code with Google or Microsoft Authenticator, FreeOTP or a similar app.</p></div>
        <div class="lg-qr" role="img" aria-label="QR code to scan with the app">${qrArt()}</div>
        <p class="muted small">Or type the key by hand: <span class="mono">JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP</span></p>
        <form class="lg-form" data-form="login"><label class="lbl">Code shown by the app<input type="text" id="lg-code" inputmode="numeric" value="482 913" autocomplete="one-time-code" class="mono lg-code"></label>${submit('Turn on and sign in')}</form>${restart}`;
    } else if (L.step === 'codes') {
      const codes = ['k7pm-q2xd', 'w9cr-h4tn', 'b3fz-m8jv', 'y6ga-r2kp', 'n5ue-t7wq', 'c8hs-v3mb', 'p2ld-x9ey', 'f4jr-a6nz', 'q7tc-e5gu', 'h3wb-s8kd'];
      body = `<div class="lg-title"><h1>Recovery codes</h1><p>The second factor is on. Keep these codes in a safe place: each one works once, if you lose the phone. They are not shown again.</p></div>
        <ul class="lg-codes">${codes.map((c) => `<li class="mono">${c}</li>`).join('')}</ul>
        <div class="row">${btn('Copy', { icon: 'copy', act: 'toast', v: 'Codes copied.' })}${btn('Download', { icon: 'download', act: 'toast', v: 'In the product a text file with the codes is saved.' })}</div>
        ${btn('I saved the codes: continue', { kind: 'pri', act: 'loginok' }).replace('class="btn pri', 'class="btn pri lg-sso')}`;
    } else {
      body = `<div class="lg-title"><h1>${ic('key', 20)} Administrator access</h1><p>Always with the local password of the platform and the second factor, whatever the tenants use.</p></div>
        <form class="lg-form" data-form="login"><label class="lbl">Username<input type="text" id="lg-user" value="${L.user || ''}" autocomplete="username"></label><label class="lbl">Password<input type="password" id="lg-pwd" value="${L.err ? '' : '••••••••••'}" autocomplete="current-password" aria-invalid="${!!L.err}"></label>
          ${L.err ? err(`Wrong username or password. After ${L.err} more attempts the sign-in locks for 15 minutes.`) : ''}${submit('Sign in')}</form>
        <p class="lg-switch"><button type="button" class="lg-door" data-act="logintenant">← Sign-in of the tenants</button></p>`;
    }
  } else {
    const list = loginTenants(S);
    const only = L.host === 'one' ? list[0] : null;
    const pre = L.host === 'pre' ? list[0].slug : null;
    const slug = only ? only.slug : pre || L.tenant || '';
    const tn = list.find((x) => x.slug === slug);
    const auth = tn ? tenAuthOf(S, tn.slug) : null;
    const pick =
      only || pre
        ? `<p class="lg-ente">Tenant: <b>${tn.n}</b>${pre ? ` · <button type="button" class="lnk" data-act="loginhost" data-v="all">Change tenant</button>` : ''}</p>`
        : `<form class="lg-form" onsubmit="return false"><label class="lbl">Tenant<select data-logintenant><option value="" ${slug ? '' : 'selected'} disabled>Choose your tenant…</option>${list.map((x) => `<option value="${x.slug}" ${x.slug === slug ? 'selected' : ''}>${x.n}</option>`).join('')}</select></label></form>`;
    const how = !tn
      ? `<p class="muted small">The tenant decides how you sign in: with a username and password, or with its identity provider.</p>`
      : auth === 'oidc'
        ? `${btn('Sign in with ' + TEN_EXTRA[tn.slug].idpName, { kind: 'pri', icon: 'key', act: 'loginok' }).replace('class="btn pri', 'class="btn pri lg-sso')}
          <p class="muted small">${tn.n} uses its own identity provider: the credentials are asked there, never by Mosaikit. On return you are in.</p>`
        : `<form class="lg-form" data-form="login"><label class="lbl">Username<input type="text" id="lg-user" value="${L.user || ''}" autocomplete="username"></label><label class="lbl">Password<input type="password" id="lg-pwd" value="${L.err ? '' : '••••••••••'}" autocomplete="current-password" aria-invalid="${!!L.err}"></label>
          ${L.err ? err(`Wrong username or password. After ${L.err} more attempts the sign-in locks for 15 minutes.`) : ''}${submit('Sign in')}</form>
          <p class="lg-reg muted small">Forgot the password? The Tenant Manager of ${tn.n} sets a new one.</p>`;
    body = `<div class="lg-title"><h1>Sign in</h1><p>${only || pre ? `to the tenant <b>${tn.n}</b>${pre ? ` · <button type="button" class="lnk" data-act="loginhost" data-v="all">Change tenant</button>` : ''}` : 'with the credentials of your tenant'}</p></div>${only || pre ? '' : pick}${how}
      <p class="lg-note">Invited to other tenants? Sign in to your own, then switch from the top bar.</p>
      <details class="lg-ex"><summary class="muted small">Sample accounts of the mockup</summary><div>${LOGIN_EX.map((x) => `<button type="button" class="chip" data-act="loginex" data-v="${x[0]}" data-u="${x[1]}" title="${x[1]}">${x[2]}</button>`).join('')}</div></details>
      <p class="lg-switch"><button type="button" class="lg-door" data-act="loginadmin">${ic('key', 14)} Administrator access</button></p>`;
  }
  const tn0 = TENANT_SEL[0];
  const langs = LANGS.filter((l) => (B.plat ? S.app.sys.langs : S.app.tnt.langs).includes(l[0]));
  const mode = MODES.find((m) => m[0] === S.mode) || MODES[0];
  // as in the shell: on the left the panel of the brand in the colours of the band, with the tiles in
  // the corner; on the right language, mode and support, the form and the legal notes
  return `<div class="lg-page2">
    <section class="lg-hero" aria-label="${B.name}"><div class="lg-art" aria-hidden="true">${mosaicArt(B.plat ? 7 : 3)}</div>
      <div class="lg-hero-in"><div class="lg-hero-b">${B.plat ? brandMark(48) : crest(tn0, 48)}<div><b>${B.name}</b><span>${B.plat ? 'Platform' : 'Workspace of the tenants'}</span></div></div>
        <div class="lg-claim"><h2>${B.plat ? 'The platform, in one place' : 'Your work, in one place'}</h2><p>${B.plat ? 'Tenants, plugins and administrators: the whole platform from here.' : `${B.welcome}: the apps of your tenant, for the people who work in it every day.`}</p>
          <ul class="lg-feat">${(B.plat ? ['Tenants, users and managers', 'Signed plugins, catalog and KPIs', 'Second factor at every sign-in'] : ['The apps of the tenant, with everyone’s permissions', 'Shares, public links and activity in one place', 'Accessible according to WCAG 2.1 AA']).map((f) => `<li><span class="lg-chk">${ic('check', 14)}</span><span>${f}</span></li>`).join('')}</ul></div>
        <p class="lg-ver">Mosaikit 1.0.0</p></div></section>
    <section class="lg-side"><div class="lg-top"><label class="lg-lang">${ic('globe', 16)}<span class="sr">Language</span><select data-melang>${langs.map((l) => `<option value="${l[0]}" ${S.lang === l[0] ? 'selected' : ''}>${l[1]}</option>`).join('')}</select></label><button type="button" class="ib" data-act="lgmode" aria-label="Mode: ${mode[1]}" title="Mode: ${mode[1]}">${ic(mode[2], 17)}</button><button type="button" class="lg-sup" data-act="toast" data-v="Support: ${B.plat ? 'support@platform.example.org' : 'help@city.example.org'}, Monday to Friday 9–17.">${ic('help', 16)} Support</button></div>
      <main class="lg-main"><div class="lg-mob">${B.plat ? brandMark(36) : crest(tn0, 36)}<b>${B.name}</b></div><div class="lg-card">${body}</div>
      <div class="lg-host"><span class="muted small">Mockup · you come from</span>${[
        ['all', 'apps.example.org'],
        ['pre', 'apps.example.org/#/login/example-city'],
        ['one', 'an installation with one tenant'],
        ['admin', 'apps.example.org/#/admin'],
      ]
        .map(
          (h) =>
            `<button type="button" class="chip" aria-pressed="${h[0] === 'admin' ? L.door === 'admin' : L.door !== 'admin' && (L.host || 'all') === h[0]}" data-act="${h[0] === 'admin' ? 'loginadmin' : 'loginhost'}" data-v="${h[0]}">${h[1]}</button>`,
        )
        .join('')}</div></main>
      <footer class="lg-foot"><nav class="lg-legal2" aria-label="Legal notes"><a>Accessibility</a><a>Privacy</a><a>Legal notes</a></nav></footer></section></div>`;
}

/* ── Home: the launcher of the apps ───────────────────────────────── */

function secHome(S) {
  setSub(null);
  const R = ROLES[S.role],
    first = R.who.split(' ')[0];
  const recent = ITEMS.slice(0, 4);
  const about0 = [
    [
      'message',
      '<b>Elena Ricci</b> mentioned you in a comment on <b>Site visit, north depot</b>',
      '12 min ago',
    ],
    [
      'share',
      '<b>Sara Greco</b> gave you «Edit» on <b>Estimate 2026-109 · office furniture</b>',
      '1 hour ago',
    ],
    [
      'alert',
      'The automation <b>Monthly report of open tasks</b> failed: it exceeded the time limit',
      'Yesterday 16:12',
    ],
    [
      'lock',
      'Your request for access to <b>Quarterly review with finance</b> was approved',
      'Yesterday',
    ],
  ];
  const about = about0;
  const due0 = [
    ['bad', 'Prepare the budget draft', 'Tasks · due tomorrow', 'tasks'],
    ['warn', 'Quarterly review with finance', 'Activities · Thursday 10:00', 'activities'],
    ['info', 'Estimate 2026-114 to approve', 'Estimates · waiting for 2 days', 'estimates'],
  ];
  const due = due0;
  const mineShared = ITEMS.filter((x) => x.own === R.who && x.acc !== 'private').sort((a, b) => (b.acc === 'public') - (a.acc === 'public'));
  const launch = `<section class="launch"><div class="panel-h"><h2>Your apps</h2><span class="muted small">Installed in ${S.app.tnt.name}</span></div>
    <div class="tiles">${APPS.map((a) => `<button type="button" class="tile ${a.tone}" data-act="appopen" data-v="${a.id}">${ic(a.ic, 22)}<b>${a.n}</b><span>${a.d}</span><span class="small">${a.cnt}</span></button>`).join('')}</div></section>`;
  if (S.fresh)
    return `<div class="page">${lhead(S, { compact: true, title: `Welcome, ${first}`, total: S.app.tnt.welcome })}
    ${launch}<div class="empty big">${ic('grid', 34)}<b>Your work will be here</b><span class="muted">You have no notes, activities or tasks yet. Start from one of the apps above.</span>
      <button type="button" class="lnk small" data-act="fresh">Back to the overview of someone who already works here</button></div></div>`;
  return `<div class="page">
    ${lhead(S, { compact: true, title: `Good morning, ${first}`, total: `${S.app.tnt.welcome} · ${R.unit}`, create: { label: 'New', act: 'new' } })}
    ${launch}
    <div class="grid-home">
      <section class="panel span2"><div class="panel-h"><h2>Pick up where you left off</h2><span class="row"><a data-act="fresh" class="small">How a newcomer sees it</a></span></div>
        <ul class="rows">${recent.map((x) => `<li><span class="ri">${ic(APP(x.app).ic, 16)}</span><div class="rt"><b>${x.t}</b><span>${APP(x.app).n} · ${x.d}</span></div>${btn('', { icon: 'share', act: 'share', v: x.id, al: 'Share ' + x.t })}${btn('Open', { act: 'appopen', v: x.app })}</li>`).join('')}</ul></section>
      <section class="panel"><div class="panel-h"><h2>Due soon</h2><span class="num muted">${due.length}</span></div>
        <ul class="alerts">${due.map((a) => `<li class="sev-${a[0]}"><div><b>${a[1]}</b><span>${a[2]}</span></div>${btn('Open', { act: 'appopen', v: a[3] })}</li>`).join('')}</ul></section>
      <section class="panel span2"><div class="panel-h"><h2>For you</h2><a data-go="inbox">All notifications</a></div>
        <ul class="rows">${about.map((x) => `<li><span class="ri">${ic(x[0], 16)}</span><div class="rt"><span class="rich">${x[1]}</span><span>${x[2]}</span></div>${btn('See', { go: 'inbox' })}</li>`).join('')}</ul></section>
      <section class="panel"><div class="panel-h"><h2>Shared by me</h2><span class="num muted">${mineShared.length}</span></div>
        <ul class="rows">${mineShared.map((x) => `<li><span class="ri">${ic(APP(x.app).ic, 15)}</span><div class="rt"><b>${x.t}</b><span>${accPill(x.acc)}</span></div>${btn('Manage', { icon: 'share', act: 'share', v: x.id, al: 'Manage the sharing of ' + x.t })}</li>`).join('')}</ul>
        <p class="small muted">Whoever owns an item decides who sees it; public items and links show first.</p></section>
    </div></div>`;
}
/* The header of list pages: name with the total under it, actions on the right. */
function lhead(S, o) {
  const create = o.create
    ? `<button type="button" class="btn pri" ${o.create.act ? `data-act="${o.create.act}"` : ''}>${ic('plus', 15)}<span>${o.create.label}</span></button>`
    : '';
  return `<header class="lhead ${o.compact ? 'lh-compact' : ''}"><div class="lh-r1"><div class="lh-t"><h1>${o.title}</h1><span class="lh-n num">${o.total}</span></div><div class="lh-a">${create}</div></div></header>`;
}

/* ── Notifications, profile, trash ──────────────────────────────────── */

function secInbox(S) {
  setSub(null);
  const items = inboxItems(S),
    unread = items.filter((x) => x[4]).length;
  const kinds = [...new Set(items.map((x) => x[5]))];
  return resPage(
    S,
    {
      title: 'Notifications',
      total: `${items.length} notifications · ${unread} unread`,
      actions: `<button type="button" class="btn" data-act="toast" data-v="All marked as read.">${ic('check', 15)}<span>Mark all as read</span></button><button type="button" class="btn" data-act="accgo" data-v="notifications">${ic('cog', 15)}<span>What I receive</span></button>`,
      bulk: {
        key: 'inbox',
        ids: items.map((x, i) => i),
        acts: [
          ['check', 'Mark as read'],
          ['trash', 'Delete', 1],
        ],
      },
    },
    filterCol(
      S,
      'inbox',
      [['Kind', kinds.map((k) => [k, items.filter((x) => x[5] === k).length])], PERIOD],
      {
        search: 'Search the notifications',
        sort: SORT_TIME,
        scope: [
          ['All', items.length],
          ['Unread', unread],
        ],
      },
    ),
    `<ul class="rows panel">${items.map((x, i) => `<li class="${x[4] ? 'unread' : ''} ${selOf(S, 'inbox').includes(String(i)) ? 'picked' : ''}">${selBox(S, 'inbox', i, x[1])}<span class="ri">${ic(x[0], 16)}</span><div class="rt"><b>${x[1]}</b><span>${x[2]}</span></div><span class="muted small num">${x[3]}</span></li>`).join('')}</ul>`,
  );
}
/* ── Account: what is personal, in one page ───────────────────────────
   Profile, sign-in and security (with the change of one's own password), notifications, appearance
   and language, the tenants one belongs to, one's own usage and keys. It opens from the menu of the
   person; the palette, the bell and the other pages link to its sections. */
function accIds(S) {
  return S.role === 'admin'
    ? ['profile', 'security', 'notifications', 'appearance']
    : ['profile', 'security', 'notifications', 'appearance', 'tenants', 'usage', 'keys'];
}
/* How the person signs in: the administrator always locally with the second factor; the others the
   way their home tenant decided (local account or identity provider). */
function mySignIn(S) {
  if (S.role === 'admin') return { kind: 'admin', text: 'Local password of the platform and second factor (TOTP)' };
  const home = TENANT_SEL.find((x) => x.id === (S.home || 'example-city')) || TENANT_SEL[0];
  return tenAuthOf(S, home.id) === 'oidc'
    ? { kind: 'oidc', home, text: `Identity provider (OIDC) of ${home.name} · ${TEN_EXTRA[home.id].idpName}` }
    : { kind: 'local', home, text: `Local account of ${home.name}, kept by Mosaikit` };
}
/* What each person uses, of the quotas of the tenant: there are no quotas per person. */
const MY_USE = {
  user: { space: 1.1, auto: 230, ai: 18 },
  manager: { space: 0.7, auto: 21, ai: 10 },
};
function accParts(S) {
  const R = ROLES[S.role],
    adm = S.role === 'admin',
    mine = MY_TENANTS[S.role],
    si = mySignIn(S);
  const [first, ...rest] = R.who.split(' ');
  const ext = si.kind === 'oidc';
  const sw = (on, lbl, sub, dis) =>
    `<li><div class="rt grow"><b>${lbl}</b>${sub ? `<span>${sub}</span>` : ''}</div>${dis ? toggle(on).replace('<button', '<button disabled') : toggle(on)}</li>`;
  const profile = `<section class="panel">${avatarEdit(S, R.ini, { admin: 5, manager: 2, user: 3 }[S.role], true)}</section>
    <section class="panel mt"><h2>Details</h2><div class="fgrid">${fld('First name', first, { ro: ext })}${fld('Last name', rest.join(' '), { ro: ext })}${fld('Email', R.mail, { type: 'email', ro: ext, hint: ext ? `Comes from the identity provider of ${si.home.name}: it changes there` : '' })}${fld('Office', R.unit, { ro: true, hint: adm ? '' : 'Set by the Tenant Manager' })}</div></section>
    <p class="muted small legal-f">${adm ? S.app.sys.name : S.app.tnt.name} · <a>Privacy</a> · <a>Legal notes</a></p>`;
  const pwd = ext
    ? `<section class="panel mt"><div class="panel-h"><div><h2>Password</h2><p class="muted small">You sign in with the identity provider of ${si.home.name}: the password and the second factor are managed there, never by Mosaikit.</p></div>${btn('Open the identity provider', { icon: 'key', act: 'toast', v: 'In the product the page of the account of ' + TEN_EXTRA[si.home.id].idpName + ' opens.' })}</div></section>`
    : `<section class="panel mt"><h2>Change the password</h2><div class="fgrid">${fld('Current password', '', { type: 'password' })}<span></span>${fld('New password', '', { type: 'password', hint: 'At least 10 characters: the minimum of the platform' })}${fld('Repeat the new password', '', { type: 'password' })}</div>
      <div class="row mt">${btn('Change the password', { kind: 'pri', icon: 'key', act: 'toast', v: 'Password changed. The other sessions are closed: this one stays open.' })}</div></section>`;
  const second = adm
    ? `<section class="panel mt"><div class="panel-h"><div><h2>Second factor</h2><p class="muted small">Required for administrators. An authenticator app, registered on 1 Sep 2026, and 10 recovery codes (8 left).</p></div>${pill('On', 'ok', 'check')}</div>
      <div class="row">${btn('Register another phone', { icon: 'refresh', act: 'toast', v: 'In the product the QR code to scan shows here.' })}${btn('New recovery codes', { icon: 'key', act: 'toast', v: 'New codes generated: the old ones no longer work.' })}</div></section>`
    : ext
      ? ''
      : `<section class="panel mt"><h2>Second factor</h2><ul class="rows">${sw(S.role === 'manager', 'An authenticator app at every sign-in', S.role === 'manager' ? 'Required for Tenant Managers by the rules of the platform' : 'Recommended: a code of the phone after the password', S.role === 'manager')}</ul></section>`;
  const sessions = `<section class="panel mt"><div class="panel-h"><h2>Sessions</h2>${btn('Close the other sessions', { act: 'toast', v: 'The other sessions are closed: this one stays open.' })}</div>
    <div class="tbl-w"><table class="tbl sm"><thead><tr><th>Where</th><th>From</th><th>Last used</th><th></th></tr></thead><tbody>${[
      ['This browser', 'Edge · Windows', 'Now', 1],
      ['Phone', 'Safari · iPhone', 'Yesterday 18:20', 0],
    ]
      .map((r) => `<tr><td><b>${r[0]}</b></td><td class="muted">${r[1]}</td><td class="num">${r[2]}</td><td class="r">${r[3] ? '<span class="muted small">this one</span>' : btn('Close', { act: 'toast', v: 'Session closed.' })}</td></tr>`)
      .join('')}</tbody></table></div></section>`;
  const tokens = adm
    ? ''
    : `<section class="panel mt"><h2>Personal access tokens</h2><ul class="rows"><li><span class="ri">${ic('key', 15)}</span><div class="rt"><b>Token for scripts and desktop tools</b><span>${S.pat ? '<span class="mono">mk_pat_4f9c…a12e</span> · created now: copy it, you will not see it again' : 'Calls the API of the platform with your permissions, and nothing more'}</span></div>${S.pat ? btn('Revoke', { act: 'pat' }) : btn('Create token', { act: 'pat' })}</li></ul></section>`;
  const security = `<section class="panel"><h2>How you sign in</h2><dl class="kv"><dt>Sign-in</dt><dd>${si.text}</dd>${adm ? '<dt>Address</dt><dd class="mono">apps.example.org/#/admin</dd>' : `<dt>Home tenant</dt><dd>${si.home.name}</dd>`}</dl></section>${pwd}${second}${sessions}${tokens}`;
  const kinds = adm
    ? [
        ['Updates of plugins', 1, 1],
        ['Backups that fail', 1, 1],
        ['Services degraded or down', 1, 1],
        ['Tenants near a quota', 1, 0],
        ['Trials that end', 1, 0],
      ]
    : [
        ['Mentions', 1, 1],
        ['Shares and access to my items', 1, 1],
        ['Due dates', 1, 0],
        ['Automations of mine that fail', 1, 1],
      ].concat(
        S.role === 'manager'
          ? [
              ['Access requests to decide', 1, 1],
              ['Invitations accepted', 1, 0],
            ]
          : [],
      );
  const notes = `<section class="panel"><div class="panel-h"><div><h2>What I receive</h2><p class="muted small">In the app every notification arrives in the bell; by email only what you choose.</p></div></div>
    <div class="tbl-w"><table class="tbl sm"><thead><tr><th>Kind</th><th class="c">In the app</th><th class="c">Email</th></tr></thead><tbody>${kinds
      .map((k) => `<tr><td><b>${k[0]}</b></td><td class="c"><input type="checkbox" class="pchk" checked disabled aria-label="${k[0]} in the app"></td><td class="c"><input type="checkbox" class="pchk" ${k[2] ? 'checked' : ''} aria-label="${k[0]} by email"></td></tr>`)
      .join('')}</tbody></table></div>
    <div class="fgrid mt"><label class="lbl">Emails<select><option>At once</option><option selected>One summary a day, at 8:00</option><option>Never</option></select></label></div></section>
    <p class="muted small mt">${adm ? 'Who gets the alerts of the platform is decided in <a data-go="monitoring">Monitoring › Alerts</a>.' : S.role === 'manager' ? 'Who gets the alerts on the quotas of the tenant is decided in <a data-go="usage">Usage › Alerts</a>.' : 'The alerts on the quotas of the tenant go to its Tenant Managers.'}</p>`;
  const tenants = mine
    ? `<section class="panel"><div class="panel-h"><div><h2>Your tenants</h2><p class="muted small">You always sign in with the access of your home tenant; in the others you work with the same identity, from the switcher at the top.</p></div></div>
      <div class="tbl-w"><table class="tbl"><thead><tr><th>Tenant</th><th>Link</th><th>Role</th><th></th></tr></thead><tbody>${mine
        .map((m) => {
          const tn = TENANT_SEL.find((x) => x.id === m[0]);
          return `<tr><td><div class="cell-t">${crest(tn, 22)}<b>${tn.name}</b></div></td><td>${m[2] === 'home' ? pill('Home', 'info', 'key') : pill('Guest')}</td><td>${pill(m[1])}</td><td class="r">${m[2] === 'home' ? '<span class="muted small">Only the administrator changes it</span>' : btn('Leave', { act: 'ask', v: 'leave' })}</td></tr>`;
        })
        .join('')}</tbody></table></div></section>`
    : '';
  const U = MY_USE[S.role] || MY_USE.user;
  const usage = adm
    ? ''
    : `<section class="panel"><div class="panel-h"><div><h2>What you use this month</h2><p class="muted small">Your part of the quotas of ${S.app.tnt.name}: there are no quotas per person.</p></div></div>
      <div class="kpis">${[
        ['Storage of your items', fmtN(U.space) + ' GB', 'attachments and documents'],
        ['Automation minutes', String(U.auto), 'of the automations you own'],
        ['AI credits', String(U.ai), 'assistant and AI steps'],
      ]
        .map((k) => `<div class="kpi-t"><span class="muted small">${k[0]}</span><b class="num">${k[1]}</b><span class="small muted">${k[2]}</span></div>`)
        .join('')}</div></section>
    <section class="panel mt"><div class="panel-h"><div><h2>Left in the tenant</h2><p class="muted small">The quotas of the tenant, set by the administrator of the platform. At the limit nothing is deleted: additions stop.</p></div>${S.role === 'manager' ? btn('Usage of the tenant', { icon: 'pie', go: 'usage' }) : ''}</div>
      ${qMeter(S, 'space', 'Storage')}${qMeter(S, 'auto', 'Automation minutes')}${qMeter(S, 'ai', 'AI credits')}</section>`;
  const all = {
    profile: ['Profile', 'user', profile],
    security: ['Sign-in and security', 'key', security],
    notifications: ['Notifications', 'bell', notes],
    appearance: ['Appearance and language', 'eye', myAppearance(S)],
    tenants: ['Your tenants', 'building', tenants],
    usage: ['Usage', 'pie', usage],
    keys: ['Keys of outside services', 'link', keysSection(S, 'me')],
  };
  return accIds(S).map((id) => all[id].concat(id));
}
function secAccount(S) {
  const R = ROLES[S.role];
  const nav = secNav(S, 'acc', accParts(S));
  return detailPage(S, {
    title: 'Account',
    sub: `${R.who} · ${R.mail} · ${R.long}`,
    body: nav.body,
    side: nav.side,
    sideNav: true,
  });
}
function secTrash(S) {
  setSub(null);
  const items = (
    [
          ['note', 'Snow plan 2025 (draft)', 'Note', 'Davide Conti', 'today', 30],
          ['receipt', 'Test estimate (draft)', 'Estimate', 'Sara Greco', '2 Oct 2026', 23],
          ['checklist', 'Old supplier list', 'Task', 'Davide Conti', '20 Sep 2026', 11],
        ]
  ).filter((x) => !(S.restored || []).includes(x[1]));
  return resPage(
    S,
    {
      title: 'Trash',
      total: items.length ? `${items.length} items · deleted for good after 30 days` : 'empty',
    },
    filterCol(
      S,
      'trash',
      [
        [
          'App',
          [
            ['Notes', 1],
            ['Estimates', 1],
            ['Tasks', 1],
          ],
        ],
      ],
      { search: 'Search the trash', sort: SORT_TIME },
    ),
    items.length
      ? `<ul class="rows panel">${items.map((x) => `<li><span class="ri">${ic(x[0], 15)}</span><div class="rt grow"><b>${x[1]}</b><span>${x[2]} · deleted ${x[4]} by ${x[3]} · stays ${x[5]} more days</span></div>${btn('Restore', { icon: 'undo', act: 'restore', v: x[1] })}</li>`).join('')}</ul>`
      : `<div class="empty">${ic('trash', 28)}<b>The trash is empty</b><span class="muted">What you delete stays here for 30 days, then it goes away by itself.</span></div>`,
  );
}

/* ── Usage: one source ────────────────────────────────────────────────
   Quotas are set by the administrator for each tenant (Details of the tenant), use from here. Sidebar,
   overview, usage and the tenant page all read these two functions: they change together. */
function tenUsage(S, x) {
  x = x || TENANTS[0];
  const f = x.users / 128,
    q = tenQuota(S, x);
  return {
    space: x.data,
    people: x.users,
    auto: Math.round(312 * f),
    collab: Math.min(3, Math.ceil(3 * f)),
    ai: q.ai ? Math.round(41 * f) : 0,
  };
}
function tenQuota(S, x) {
  x = x || TENANTS[0];
  return Object.assign({}, x.q, S.tenQ && S.tenQ[x.slug]);
}
function tenSt(S, x) {
  return (S.tenSt && S.tenSt[x.slug]) || x.st;
}
function qPct(u, lim) {
  if (lim == null || lim === 0) return '';
  const p = Math.round((u / lim) * 100);
  return ` · ${p}%${p > 100 ? ' · over the limit' : ''}`;
}
function qText(k, u, lim) {
  const unit = (QUOTA_Q.find((q) => q[0] === k) || [])[2] || '';
  if (lim === 0) return 'not available';
  return lim == null
    ? `${fmtN(u)}${unit ? ' ' + unit : ''}, no limit`
    : `${fmtN(u)} of ${fmtN(lim)}${unit ? ' ' + unit : ''}`;
}
function qMeter(S, k, label) {
  const u = tenUsage(S)[k],
    lim = tenQuota(S)[k];
  return lim == null
    ? meter(1, 100, `${label} · ${qText(k, u, lim)}`)
    : meter(Math.min(u, lim), lim, `${label} · ${qText(k, u, lim)}`);
}
/* Short names of the quotas, for the alert at the foot of the sidebar. */
const Q_SHORT = {
  space: 'Storage',
  people: 'People',
  auto: 'Automation',
  collab: 'Sessions',
  ai: 'AI',
};
function qTone(p) {
  return p >= 100 ? 'bad' : p >= 80 ? 'warn' : 'ok';
}
function tenWorst(S, x, keys) {
  const u = tenUsage(S, x),
    q = tenQuota(S, x);
  return (keys || Object.keys(Q_SHORT))
    .filter((k) => q[k] != null)
    .map((k) => [k, q[k] ? Math.round((u[k] / q[k]) * 100) : u[k] ? 999 : 0, u[k], q[k]])
    .sort((a, b) => b[1] - a[1]);
}
function qRing(p, tone, center, label, tip, attr) {
  const r = 14,
    c = 2 * Math.PI * r,
    pp = Math.min(100, p);
  return `<button type="button" class="side-ring q-${tone}" ${attr} aria-label="${tip}" data-stip="${tip}"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="${r}" class="rg-b"/><circle cx="18" cy="18" r="${r}" class="rg-v" stroke-dasharray="${((c * pp) / 100).toFixed(1)} ${c.toFixed(1)}"/></svg><span class="num">${center}</span><em>${label}</em></button>`;
}
/* The foot of the sidebar is empty while every quota is under 80%: then an alert shows, which opens
   where the quotas are read (Tenants for the administrator, Usage for the manager, Account › Usage
   for a user). */
function quotaWidget(S) {
  if (S.role === 'admin') {
    const hot = TENANTS.map((x) => [x, tenWorst(S, x)[0]]).filter((z) => z[1][1] >= 80);
    if (!hot.length) return '';
    const tone = hot.some((z) => z[1][1] >= 100) ? 'bad' : 'warn';
    const tip = `Tenants near a limit: ${hot.map((z) => `${z[0].n} (${Q_SHORT[z[1][0]]} ${z[1][1] > 900 ? 'used up' : z[1][1] + '%'})`).join(', ')}`;
    return `<button type="button" class="qw" data-go="tenants"><span class="qw-h"><b>${hot.length === 1 ? '1 tenant' : hot.length + ' tenants'} near a limit</b><i class="dot ${tone}"></i></span>
      <span class="small muted">${hot
        .slice(0, 2)
        .map((z) => `${z[0].n} · ${Q_SHORT[z[1][0]]} ${z[1][1]}%`)
        .join('<br>')}</span></button>${qRing(100, tone, hot.length, 'near limit', tip, 'data-go="tenants"')}`;
  }
  const mgr = S.role === 'manager';
  const list = tenWorst(S, TENANTS[0], mgr ? null : ['space', 'auto', 'ai']),
    w = list[0];
  if (!w || w[1] < 80) return '';
  const tone = qTone(w[1]),
    attr = mgr ? 'data-go="usage"' : 'data-act="accgo" data-v="usage"';
  const tip = `${Q_SHORT[w[0]]} of the tenant at ${w[1]}%: ${qText(w[0], w[2], w[3])}`;
  return `<button type="button" class="qw" ${attr}><span class="qw-h"><b>${Q_SHORT[w[0]]} at ${w[1]}%</b><i class="dot ${tone}"></i></span>
    <span class="meter-b q-${tone}"><i style="width:${Math.min(100, w[1])}%"></i></span><span class="small muted">${qText(w[0], w[2], w[3])} · ${w[1] >= 100 ? 'over the limit of the tenant' : 'near the limit of the tenant'}</span></button>${qRing(w[1], tone, w[1] + '%', Q_SHORT[w[0]], tip, attr)}`;
}

/* ── Tenant overview (Tenant Manager) ──────────────────────────────────
   Decisions first (access requests, invitations, integrations down), counts after. */
function secSpace(S) {
  setSub(null);
  const tn = TENANT_SEL[0];
  const recent = LOG.filter((e) => e.ten === 'Example City').slice(0, 3);
  return detailPage(S, {
    title: 'Tenant overview',
    actions:
      moreMenu(S, 'space', [['sliders', 'Customize the overview', 'data-act="toast" data-v="In the product the panels can be chosen and moved."']]) +
      btn('Invite people', { kind: 'pri', icon: 'plus', act: 'invite' }),
    sub: `${tn.name} · 128 people`,
    body: `
    ${kpis([
      ['People', '128', '6 invitations pending'],
      ['Groups', '5', 'from the identity provider', 'ok'],
      ['Plugins', '4 apps', '3 more plugins on'],
      [
        'Storage',
        fmtN(tenUsage(S).space) + ' GB',
        'of ' + fmtN(tenQuota(S).space) + ' GB',
      ],
    ])}
    <div class="grid-home"><section class="panel span2"><div class="panel-h"><h2>Waiting for you</h2></div><ul class="rows">
      <li><span class="ri">${ic('lock', 15)}</span><div class="rt"><b>2 access requests</b><span>Site visit, north depot (Front office) · Estimate 2026-114 (Field team)</span></div>${btn('Decide', { act: 'memreq' })}</li>
      <li><span class="ri">${ic('users', 15)}</span><div class="rt"><b>6 invitations not accepted yet</b><span>The oldest is 9 days old</span></div>${btn('See', { act: 'meminv' })}</li>
      <li><span class="ri">${ic('alert', 15)}</span><div class="rt"><b>1 service does not answer</b><span>Mail relay · for 14 minutes · the administrators of the platform are on it</span></div>${btn('Open', { go: 'splugins' })}</li>
      <li><span class="ri">${ic('globe', 15)}</span><div class="rt"><b>1 item shared publicly this week</b><span>Open day 2026 · by Davide Conti</span></div><button type="button" class="btn" data-go="shares" data-settab="shk:pub"><span>Review</span></button></li></ul></section>
    <section class="panel"><div class="panel-h"><h2>Services</h2><a data-go="splugins">Plugins</a></div><ul class="health">${[
      ['Identity provider (OIDC)', 'ok', 'Keycloak of Example City'],
      ['Collaboration relay', 'ok', '3 sessions open'],
      ['Automation worker', 'warn', '1 job queued for 6 min'],
      ['Mail relay', 'bad', 'does not answer'],
    ]
      .map(
        (h) =>
          `<li><i class="dot ${h[1]}"></i><b>${h[0]}</b><span class="muted small">${h[2]}</span></li>`,
      )
      .join('')}</ul></section>
    <section class="panel span2"><div class="panel-h"><h2>Recent activity</h2><a data-go="activity">Log</a></div><ul class="rows">${recent.map((e) => `<li><span class="ri">${ic(e.ok ? 'history' : 'alert', 15)}</span><div class="rt"><b>${e.act}</b><span>${e.who} · ${e.target} · ${logDate(e)} ${e.t}</span></div></li>`).join('')}</ul></section>
    <section class="panel"><div class="panel-h"><h2>Usage this month</h2><a data-go="usage">Details</a></div>${qMeter(S, 'space', 'Storage')}${qMeter(S, 'auto', 'Automation')}${qMeter(S, 'ai', 'AI credits')}</section></div>`,
  });
}

/* ── People of the tenant (Tenant Manager) ────────────────────────────── */

function personHome(p) {
  return p.home || 'Example City';
}
function personTenants(p) {
  if (p.assoc)
    return [[personHome(p), p.role, 'home'], ...p.assoc.map((n) => [n, 'User', 'assoc'])];
  if (p.ini === 'LB')
    return [
      ['Example City', p.role, 'home'],
      ['Green Region', 'User', 'assoc'],
    ];
  if (p.home)
    return [
      [p.home, 'User', 'home'],
      ['Example City', p.role, 'assoc'],
    ];
  return [['Example City', p.role, 'home']];
}
function viaLabel(p) {
  if (p.via === 'SSO') return 'Identity provider (OIDC) of Example City';
  if (p.via === 'Local')
    return p.home ? `Local account of ${p.home}` : 'Local account';
  return '—';
}
/* Manage: people, groups, permission profiles, and what is pending (invitations not accepted and
   access requests to decide), one section at a time from the list on the left. */
const ACC_REQS = [
  [
    'r1',
    'Giulia Marini',
    'GM',
    'Front office',
    'Site visit, north depot',
    'View',
    'To answer questions from the public about the depot',
    'Elena Ricci',
  ],
  [
    'r2',
    'Chiara Rinaldi',
    'CR',
    'Field team',
    'Estimate 2026-114 · roof repairs',
    'View and download',
    'To check the items on site',
    'Davide Conti',
  ],
];
function secMembers(S) {
  const t0 = tabOf(S, 'mem', 'users'),
    t = ['inv', 'req'].includes(t0) ? 'pend' : t0;
  setSub({ users: 'people', groups: 'groups', prof: 'profiles', pend: 'pending' }[t]);
  let body;
  if (t === 'prof') {
    body = profilesSection(S);
  } else if (t === 'groups') {
    body = `<div class="tbl-w"><table class="tbl"><thead><tr><th class="cbx"><span class="sr">Select</span></th><th>Group</th><th class="r">People</th><th class="r">Shared items</th><th>Comes from</th><th></th></tr></thead><tbody>
    ${GROUPS.map((g, i) => `<tr class="clk ${selOf(S, 'mem-groups').includes(String(i)) ? 'picked' : ''}" data-res="group:${i}" data-go="group">${selTd(S, 'mem-groups', i, g.n)}<td><div class="cell-t"><span class="ri">${ic('users', 15)}</span><div><b>${g.n}</b><span class="muted small">${g.d}</span></div></div></td><td class="r num">${g.m}</td><td class="r num">${g.res}</td><td>${g.kc ? pill('Identity provider', 'info', 'key') : pill('Mosaikit')}</td><td>${btn('', { icon: 'more' })}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted small mt">With an identity provider (OIDC) the groups arrive in the <span class="mono">groups</span> claim at every sign-in; for local accounts the Tenant Manager assigns them.</p>`;
  } else if (t === 'pend') {
    const open = ACC_REQS.filter((r) => !(S.reqDone && S.reqDone[r[0]])).length;
    body = `<section class="panel"><div class="panel-h"><div><h2>Access requests <span class="num muted">${open}</span></h2><p class="muted small">Who asks, for what, and why. Approving creates the share; the owner gets a notification. If you prefer that the owner decides, forward the request.</p></div></div>
      <ul class="rows">${ACC_REQS.map((r) => {
        const done = S.reqDone && S.reqDone[r[0]];
        return `<li><span>${av(r[2], 5, 30)}</span><div class="rt grow"><b>${r[1]} · ${r[3]}</b><span>${r[5]} on <b>${r[4]}</b> · «${r[6]}» · owner ${r[7]}</span></div>${done ? pill(done === 'ok' ? 'Approved' : done === 'fw' ? 'Forwarded' : 'Refused', done === 'ok' ? 'ok' : done === 'fw' ? 'info' : 'bad') : `<div class="row">${btn('Refuse', { act: 'req', v: 'no:' + r[0] })}${btn('Forward to the owner', { act: 'req', v: 'fw:' + r[0] })}${btn('Approve', { kind: 'pri', act: 'req', v: 'ok:' + r[0] })}</div>`}</li>`;
      }).join('')}</ul></section>
    <section class="panel mt"><div class="panel-h"><div><h2>Invitations not accepted <span class="num muted">${INVITES.length}</span></h2><p class="muted small">An invitation expires after 14 days; sending it again starts the 14 days over.</p></div></div>
      <div class="mg-bar in-panel">${bulkBar(S, { key: 'mem-inv', ids: INVITES.map((x, i) => i), acts: [['mail', 'Send again'], ['trash', 'Delete', 1]] })}</div>
      <ul class="rows">${INVITES.map((x, i) => `<li class="${selOf(S, 'mem-inv').includes(String(i)) ? 'picked' : ''}">${selBox(S, 'mem-inv', i, x.split(' · ')[0])}<span class="ri">${ic('user', 15)}</span><div class="rt"><b>${x.split(' · ')[0]}</b><span>${x.split(' · ').slice(1).join(' · ')}</span></div>${btn('Send again', { act: 'toast', v: 'Invitation sent again: it expires in 14 days.' })}${btn('', { icon: 'trash', act: 'toast', v: 'Invitation cancelled.', al: 'Cancel the invitation' })}</li>`).join('')}</ul></section>`;
  } else {
    body = `<div class="tbl-w"><table class="tbl"><thead><tr><th class="cbx"><span class="sr">Select</span></th><th>Name</th><th>Role and profile</th><th>Groups</th><th>Status</th><th>Signs in with</th><th>Last sign-in</th><th></th></tr></thead><tbody>
    ${PEOPLE.map((p) => `<tr class="clk ${selOf(S, 'mem-users').includes(p.ini) ? 'picked' : ''}" data-res="person:${p.ini}" data-go="person">${selTd(S, 'mem-users', p.ini, p.n)}<td><div class="cell-t">${av(p.ini, p.c, 28)}<div><b>${p.n}${p.home ? ' ' + pill('Guest · ' + p.home, 'info') : ''}</b><span class="muted small">${p.mail}</span></div></div></td><td>${p.role === 'Tenant Manager' ? pill('Tenant Manager', 'info') : `<div class="rp">${pill('User')}<span class="muted small">${PROF(p.prof).n}</span></div>`}</td><td class="small">${p.groups.join(', ')}</td><td>${pill(p.st, p.st === 'Active' ? 'ok' : p.st === 'Suspended' ? 'bad' : 'warn')}</td><td class="small">${viaLabel(p)}</td><td class="num muted">${p.last}</td><td>${btn('', { icon: 'more' })}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted small mt">Local accounts are kept by Mosaikit (argon2id); with an identity provider (OIDC) the password stays there. Every app checks the permissions of each person on every request.</p>`;
  }
  // One primary action per section; the people of the list come in through an invitation.
  const create =
    t === 'groups'
      ? btn('New group', { kind: 'pri', icon: 'plus', act: 'groupnew' })
      : t === 'prof'
        ? btn('New profile', { kind: 'pri', icon: 'plus', act: 'profnew' })
        : btn('Invite people', { kind: 'pri', icon: 'plus', act: 'invite' });
  const actions =
    (t === 'users'
      ? `<button type="button" class="btn" data-act="toast" data-v="In the product you pick a CSV file with email, profile and groups: every row becomes an invitation.">${ic('upload', 15)}<span>Import from CSV</span></button>`
      : '') + create;
  const bulk =
    t === 'groups'
      ? { key: 'mem-groups', ids: GROUPS.map((g, i) => i), acts: [['trash', 'Delete', 1]] }
      : t === 'users'
        ? {
            key: 'mem-users',
            ids: PEOPLE.map((p) => p.ini),
            acts: [
              ['key', 'Change role'],
              ['user', 'Change profile'],
              ['users', 'Add to a group'],
              ['lock', 'Suspend'],
              ['x', 'Remove from the tenant', 1],
              ['trash', 'Delete the account', 1],
            ],
          }
        : null;
  const pend = ACC_REQS.filter((r) => !(S.reqDone && S.reqDone[r[0]])).length + INVITES.length;
  const secs = [
    ['users', 'People', 'users', 128],
    ['groups', 'Groups', 'grid', 5],
    ['prof', 'Permission profiles', 'key', PROFILES.length],
    ['pend', 'Pending', 'clock', pend],
  ];
  const search = { users: 'Search by name or email', groups: 'Search a group', pend: 'Search a request or an invitation' }[t];
  const bar = search
    ? `<div class="mg-bar"><div class="field sm">${ic('search', 14)}<input type="search" placeholder="${search}" aria-label="${search}"></div>${bulk ? bulkBar(S, bulk) : ''}</div>`
    : '';
  return detailPage(S, {
    title: 'Manage',
    sub: {
      users: '128 people · ' + pend + ' pending',
      groups: '5 groups',
      prof: PROFILES.length + ' permission profiles',
      pend: `${ACC_REQS.length} access requests · ${INVITES.length} invitations not accepted`,
    }[t],
    actions,
    side: `<aside class="facets secnav" aria-label="Sections"><label class="secnav-sel"><span class="sr">Section</span><select data-tabsel="mem">${secs.map((x) => `<option value="${x[0]}" ${t === x[0] ? 'selected' : ''}>${x[1]}</option>`).join('')}</select></label><nav class="secnav-l">${secs.map((x) => `<button type="button" data-tab="mem:${x[0]}" aria-current="${t === x[0]}" class="${t === x[0] ? 'on' : ''}">${ic(x[2], 16)}<span>${x[1]}</span><span class="num muted sn-n">${x[3]}</span></button>`).join('')}</nav></aside>`,
    sideNav: true,
    body:
      (S.bulkDone ? `<div class="banner info bdone">${ic('check', 18)}<div>${S.bulkDone}</div></div>` : '') +
      bar +
      body,
  });
}
/* The permissions in the plugins, one row per plugin: the ones held, with where each comes from.
   When editing (Advanced in the invitation) the missing ones can be added as exceptions. */
function permTable(eff, o) {
  const x = o || {};
  const mods = Object.keys(eff).filter(
    (k) => FEAT(k) && (x.all || eff[k].some((p) => p.src.length)),
  );
  const tag = (s) => (s === 'personal' ? 'exception' : s);
  return `<div class="ptab">${mods
    .map((k) => {
      const on = eff[k].filter((p) => p.src.length).length;
      return `<div class="ptab-r"><div class="ptab-m">${ic(FEAT(k).ic || 'puzzle', 15)}<b>${FEAT(k).n}</b><span class="muted small num">${on} of ${eff[k].length}</span></div><div class="ptab-p">${eff[
        k
      ]
        .map((p, i) =>
          p.src.length
            ? `<span class="pchip on" title="${PERM_DESC[p.perm] || ''}">${ic('check', 11)}${p.perm}<em>${p.src.map(tag).join(', ')}</em>${x.edit && p.src.includes('exception') ? `<button type="button" data-act="invx" data-v="${k}:${i}" aria-label="Remove the exception ${p.perm}">${ic('x', 11)}</button>` : ''}</span>`
            : x.edit
              ? `<button type="button" class="pchip add" data-act="invx" data-v="${k}:${i}" title="${PERM_DESC[p.perm] || ''}">${ic('plus', 11)}${p.perm}</button>`
              : x.off
                ? `<span class="pchip">${p.perm}</span>`
                : '',
        )
        .join('')}</div></div>`;
    })
    .join('')}</div>`;
}
function roleHelp() {
  return `<button type="button" class="rhelp" data-act="rolesinfo" aria-label="What each role can do" title="What each role can do">${ic('help', 15)}</button>`;
}
/* What each role can do: a dialog opened from wherever a role is given. The role says how far one
   reaches; for a User, profile, groups and exceptions say what they do in the plugins, and shares
   say on which items. */
function rolesInfoHtml() {
  const roles = [
    ['Administrator', 'Platform'],
    ['Tenant Manager', 'Tenant'],
    ['User', 'Tenant'],
  ];
  const Y = 1,
    N = 0,
    P = 2;
  const rows = [
    [
      'How far it reaches',
      [
        'Configuration of the platform',
        'Their items and the management of the tenant',
        'What profile and groups give them, on the items they see',
      ],
      'txt',
    ],
    ['Use the apps', [N, Y, P], '', 'Only the plugins on in the tenant'],
    ['Create items of their own', [N, Y, P]],
    ['Edit their own items', [N, Y, Y]],
    ['Edit items shared for editing', [N, Y, Y]],
    ['See items shared for viewing', [N, Y, Y]],
    ['Share for viewing or editing', [N, Y, Y], '', 'The owner of an item'],
    ['Outside links and public sharing', [N, Y, Y], '', 'Decided by the owner of the item'],
    ['Manage people, groups, profiles and invitations', [N, Y, N]],
    ['Turn plugins on and give permissions', [N, Y, N]],
    ['Appearance, keys and usage of the tenant', [N, Y, N]],
    ['Tenants, people, plugins and system', [Y, N, N]],
  ];
  const cell = (v, kind) =>
    kind === 'txt'
      ? `<td class="small">${v}</td>`
      : v === P
        ? `<td class="c"><span class="chk part" title="According to profile and groups">${ic('sliders', 12)}</span></td>`
        : `<td class="c"><span class="chk ${v ? 'on' : ''}">${v ? ic('check', 13) : ''}</span></td>`;
  const li = (x, k) =>
    x[1][k] === P
      ? `<li class="on part">${ic('sliders', 15)}<span>${x[0]}, according to profile and groups</span></li>`
      : `<li class="${x[1][k] ? 'on' : ''}">${x[1][k] ? ic('check', 15) : ic('x', 15)}<span>${x[0]}</span></li>`;
  return `
    <div class="roles4-cards">${roles
      .map(
        (r, k) =>
          `<section class="panel"><h2>${r[0]} <span class="muted small">${r[1]}</span></h2><p class="small">${rows[0][1][k]}</p><ul class="feats">${rows
            .slice(1)
            .map((x) => li(x, k))
            .join('')}</ul></section>`,
      )
      .join('')}</div>
    <div class="tbl-w"><table class="tbl matrix roles4"><thead><tr><th></th>${roles.map((r) => `<th>${r[0]}<span class="muted small">${r[1]}</span></th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr><th>${r[0]}${r[3] ? `<span class="muted small">${r[3]}</span>` : ''}</th>${r[1].map((v) => cell(v, r[2])).join('')}</tr>`).join('')}</tbody></table></div>
    <section class="panel mt"><h2>What a User does: the profile</h2><p class="small">Every User has a <b>profile</b>, where their permissions in the plugins start. <b>Groups</b> add permissions, and the Tenant Manager can give <b>exceptions</b> to a single person. The permission profiles of the tenant are in Manage › Permission profiles.</p>
      <ul class="rows">${PROFILES.map((pr) => `<li><span class="ri">${ic('user', 15)}</span><div class="rt grow"><b>${pr.n}${pr.def ? ' <span class="muted small">· for new invitations</span>' : ''}</b><span>${pr.d}</span></div><span class="num muted small">${pr.cnt} people</span></li>`).join('')}</ul></section>`;
}

/* ── Plugins of the tenant (Tenant Manager) ───────────────────────────── */

/* The row of a plugin: the same for the administrator (tenant page) and for the Tenant Manager
   (Plugins), who also gets «Access and permissions». */
function featRow(S, f, on, o) {
  const ok = o.ok !== false,
    scope = o.scope || '';
  const req = [
    ...(f.needs || []).map((n) => FEAT(n).n),
    ...(f.needsAny ? [f.needsAny.map((n) => FEAT(n).n).join(' or ')] : []),
  ];
  const soft = (f.soft || [])
    .filter((s) => !on[s[0]])
    .map((s) => `<span class="small soft">${ic('alert', 13)} ${s[1]}</span>`)
    .join('');
  const conf =
    S.featAsk && S.featAsk.k === f.k && (S.featAsk.scope || '') === scope
      ? `<div class="banner warn fconf">${ic('alert', 18)}<div><b>Turning off ${f.n} also turns off: ${S.featAsk.deps.map((n) => FEAT(n).n).join(', ')}.</b> Nothing is deleted: the items stay and come back when it is turned on again.</div>${btn('Cancel', { act: 'featno' })}${btn('Turn all off', { kind: 'pri', act: 'featyes' })}</div>`
      : '';
  const g = modRows(f.k),
    gp = g.filter((x) => x[4] === 'prof').length;
  const acc =
    o.access && g.length
      ? `<div class="acc-row"><span class="muted small">${ic('users', 13)} ${[
          gp ? gp + (gp === 1 ? ' profile' : ' profiles') : '',
        ]
          .concat(g.filter((x) => x[4] !== 'prof').map((x) => x[1]))
          .filter(Boolean)
          .join(
            ' · ',
          )}</span><button type="button" class="btn sm" data-act="modacc" data-v="${f.k}" ${on[f.k] ? '' : 'disabled'}>${ic('key', 14)}<span>Permissions</span></button></div>`
      : '';
  const kind = featKind(f);
  return `<li class="${ok ? '' : 'off'} ${on[f.k] ? 'is-on' : ''}"><span class="ri">${ic(f.ic, 16)}</span><div class="rt"><b class="pl-n">${f.n} ${kindPill(kind)}</b><span>${f.d}</span>${kind === 'Extension' && f.ext ? `<span class="needs">${ic('puzzle', 12)} Extends ${FEAT(f.ext).n}: it adds to its pages, it has none of its own</span>` : ''}<span class="muted small">${f.how}</span>
    ${req.length ? `<span class="needs">${ic('link', 12)} Requires ${req.join(', ')}</span>` : ''}${soft}${acc}${conf}</div>
    <button type="button" class="tgl" role="switch" data-act="tenfeat" data-v="${f.k}" ${scope ? `data-scope="${scope}"` : ''} aria-label="${f.n}" aria-checked="${ok && !!on[f.k]}" ${ok ? '' : 'disabled'}><i></i></button></li>`;
}
function tenFeats(S, x) {
  const base = {
    notes: true,
    tasks: true,
    activities: true,
    estimates: true,
    collab: true,
    auto: x.slug !== 'sandbox',
    files: true,
    ai: ['example-city', 'example-county'].includes(x.slug),
  };
  MP.filter((m) => !m.sys).forEach((m) => {
    base['ext:' + m.id] = (m.tenants || []).includes(x.slug);
  });
  return Object.assign(base, S.tenFeat && S.tenFeat[x.slug]);
}
/* The Tenant Manager turns on and off only among the plugins the administrator enabled. */
function mgrFeats(S) {
  const adm = tenFeats(S, TENANTS[0]);
  return Object.fromEntries(
    FEATS.map((f) => [f.k, !!adm[f.k] && (!S.mgrFeat || S.mgrFeat[f.k] !== false)]),
  );
}
function secSplugins(S) {
  setSub(null);
  const adm = tenFeats(S, TENANTS[0]),
    on = mgrFeats(S);
  const mine = (f) => MGR_FEATS.includes(f.k) || f.k.startsWith('ext:');
  const list = FEATS.filter((f) => mine(f) && adm[f.k]);
  const kinds = ['App', 'Service', 'Extension'];
  const n = list.filter((f) => on[f.k]).length;
  return resPage(
    S,
    {
      title: 'Plugins',
      total: `${list.length} available · ${n} on`,
      actions: `<span class="inh lock" title="The administrator of the platform decides which plugins are available to the tenant">${ic('lock', 12)}Available: decided by the administrator</span>`,
      create: {
        label: 'Ask for a plugin',
        act: 'toast',
        v: 'Request sent to the administrators of the platform.',
      },
    },
    filterCol(
      S,
      'mod',
      [
        [
          'Kind',
          kinds.map((k) => [k === 'App' ? 'Apps' : k + 's', list.filter((f) => featKind(f) === k).length]),
        ],
        [
          'State',
          [
            ['On', n],
            ['Off', list.length - n],
          ],
        ],
      ],
      { search: 'Search a plugin', sort: SORT_NAME },
    ),
    `${S.featNote && S.route === 'splugins' ? `<div class="banner info fnote">${ic('check', 18)}<div>${S.featNote}</div></div>` : ''}
    <ul class="ints">${list.map((f) => featRow(S, f, on, { scope: 'mgr', access: true })).join('')}</ul>`,
  );
}
/* Access and permissions of a plugin: the whole tenant, groups, people. Profiles give the
   start, groups and people add; the role stays the ceiling. */
function secModule(S) {
  setSub(null);
  const f = FEAT(S.modKey || 'notes'),
    perms = MOD_PERMS[f.k],
    g = modRows(f.k);
  const pl = f.k.startsWith('ext:')
    ? MP.find((m) => 'ext:' + m.id === f.k)
    : MP.find((m) => m.sys === f.k);
  const nProf = g.filter((r) => r[4] === 'prof').length;
  return detailPage(S, {
    back: ['splugins', 'Back to Plugins'],
    title: `Permissions · ${f.n}`,
    sub: `${nProf ? nProf + (nProf === 1 ? ' profile' : ' profiles') : 'no profile'} · ${g.length - nProf} groups and people`,
    body: `<div class="banner info">${ic('key', 18)}<div>The only place where the permissions of ${f.n} are given. The columns are the <b>permissions ${f.n} declares</b> in its manifest${pl ? ` (<span class="mono">${pl.id} ${pl.ver}</span>)` : ''}. Every User starts from their <b>profile</b>; groups and people <b>add</b>. A new permission that arrives with an update starts off, and we tell you.</div></div>
    ${nProf ? '' : `<div class="banner warn mt">${ic('lock', 18)}<div><b>It is in no profile.</b> Only whoever is in the list sees it, by group or by name.</div></div>`}
    <section class="panel mt" data-dirty="module"><div class="panel-h"><h2>Who has access, and with which permissions</h2><a data-act="proftab">Edit the permission profiles</a></div>
      <div class="field">${ic('search', 15)}<input type="text" placeholder="Add a group or a person" aria-label="Add"></div>
      <div class="tbl-w mt"><table class="tbl perm macc"><thead><tr><th>Who</th>${perms.map((p) => `<th class="c">${p}</th>`).join('')}<th></th></tr></thead><tbody>
      ${g.map((s) => `<tr class="${s[4] === 'prof' ? 'prow' : ''}"><td><div class="cell-t"><span class="ri">${ic(s[4] === 'prof' ? 'user' : s[0], 15)}</span><div><b>${s[1]}</b><span class="muted small">${s[2]}${s[4] === 'prof' ? ' · changes in Manage › Permission profiles' : ''}</span></div></div></td>${s[3].map((v, i) => `<td class="c"><input type="checkbox" class="pchk" ${v ? 'checked' : ''} ${s[4] === 'prof' ? 'disabled' : ''} aria-label="${perms[i]} for ${s[1]}"></td>`).join('')}<td class="r">${s[4] === 'prof' ? '' : `<button type="button" class="btn" aria-label="Remove ${s[1]}" title="Remove">${ic('x', 15)}</button>`}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="panel mt"><h2>What each permission means</h2><dl class="kv">${perms.map((p) => `<dt>${p}</dt><dd>${PERM_DESC[p] || 'From the manifest of the plugin'}</dd>`).join('')}</dl></section>${saveBar(S, 'module')}
    <p class="muted small mt">Changes apply from the next sign-in of each person and stay in the log. The backend checks the permissions on every request: hiding a button is not enough.</p>`,
  });
}

/* ── Usage (Tenant Manager) ──────────────────────────────────────────────────
   The quotas are set by the administrator of the platform: here the Tenant Manager sees them, how they
   are used, who uses the most, and decides whom to warn near a limit. */
function secUsage(S) {
  const tn = TENANTS[0],
    Q = tenQuota(S, tn);
  const used = tenUsage(S, tn);
  const atLimit = {
    space: 'No new files are uploaded; the ones there stay',
    people: 'No new people are invited',
    auto: 'Scheduled automations stop until next month; manual runs still work',
    collab: 'No new session opens until one closes',
    ai: 'The assistant and AI steps stop until next month',
  };
  const row = (q) => {
    const lim = Q[q[0]],
      u = used[q[0]],
      pc = lim ? Math.min(100, Math.round((u / lim) * 100)) : 0,
      tone = pc >= 100 ? 'bad' : pc >= 80 ? 'warn' : '';
    const bar =
      q[0] === 'space'
        ? `<div class="meter-b stack ${tone === 'bad' ? 'over' : ''}"><i style="width:${Math.min(100, ((u * 0.7) / lim) * 100).toFixed(1)}%"></i><i class="b2" style="width:${Math.min(100, ((u * 0.3) / lim) * 100).toFixed(1)}%"></i></div><div class="qlegend small muted"><span><i></i>Database ${fmtN(u * 0.7)} GB</span><span><i class="b2"></i>File storage ${fmtN(u * 0.3)} GB</span></div>`
        : `<div class="meter-b ${tone === 'bad' ? 'over' : ''}"><i style="width:${lim == null ? 3 : pc}%"></i></div>`;
    return `<li><div class="q-l"><b>${q[1]}</b><span class="num ${tone ? tone + '-t' : 'muted'}">${qText(q[0], u, lim)}${qPct(u, lim)}</span></div>${bar}${lim == null ? '' : `<span class="small muted q-n">At the limit: ${atLimit[q[0]]}.</span>`}</li>`;
  };
  const months = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
  const trend = (title, vals, unit, note) =>
    `<section class="panel"><div class="panel-h"><h2>${title}</h2><span class="muted small">${unit}</span></div>${bars(vals, months)}${note ? `<p class="small mt ${note[0]}">${note[1]}</p>` : ''}</section>`;
  const autoNote = (() => {
    const day = Math.ceil(Q.auto / (used.auto / 9));
    return day <= 9
      ? ['bad-t', `October: ${used.auto} minutes in 9 days, over the limit of ${fmtN(Q.auto)}.`]
      : day <= 31
        ? [
            'warn-t',
            `October: ${used.auto} minutes in 9 days. At this pace the limit of ${fmtN(Q.auto)} is reached around 31 October.`,
          ]
        : [
            'muted',
            `October: ${used.auto} minutes in 9 days. At this pace the limit of ${fmtN(Q.auto)} is not reached by the end of the month.`,
          ];
  })();
  const spaceNote = (() => {
    const mo = Math.max(0, Math.round((Q.space - used.space) / 0.5));
    return mo <= 3
      ? [
          'warn-t',
          `It grows by about half a GB a month: at this pace the limit of ${fmtN(Q.space)} GB arrives in ${mo <= 1 ? 'a month' : mo + ' months'}.`,
        ]
      : [
          'muted',
          `It grows by about half a GB a month: at this pace the limit of ${fmtN(Q.space)} GB arrives in about ${mo} months.`,
        ];
  })();
  const parts = [
    [
      'Quotas',
      'gauge',
      `<section class="panel"><div class="panel-h"><div><h2>Quotas of the tenant</h2><p class="muted small">Set by the administrator of the platform: here they are read, not changed. They reset on the first of every month, except storage and people.</p></div>${inhLock()}</div><ul class="quota">${QUOTA_Q.map(row).join('')}</ul></section>`,
      'quotas',
    ],
    [
      'Trend',
      'activity',
      `<div class="stack-s">${trend('Automation minutes', [180, 220, 205, 260, 330, used.auto], 'a month · limit ' + fmtN(Q.auto), autoNote)}${trend('Storage', [5.1, 5.6, 6.0, 6.5, 7.1, used.space], 'GB at the end of the month · limit ' + fmtN(Q.space), spaceNote)}${trend('AI credits', [12, 25, 30, 44, 76, used.ai], 'a month · limit ' + fmtN(Q.ai), null)}</div>`,
      'trend',
    ],
    [
      'Who uses the most',
      'users',
      `<div class="stack-s"><section class="panel"><h2>Automation, by automation</h2><div class="tbl-w"><table class="tbl sm"><thead><tr><th>Automation</th><th>Of</th><th class="r">Minutes</th><th class="r">Quota</th></tr></thead><tbody>${[
        ['Monthly report of open tasks', 'Davide Conti', 142],
        ['Reminders of due tasks', 'Davide Conti', 88],
        ['Weekly digest of activities', 'Sara Greco', 61],
        ['Approval of estimates', 'Elena Ricci', 21],
      ]
        .map(
          (r) =>
            `<tr><td><b>${r[0]}</b></td><td class="small">${r[1]}</td><td class="r num">${r[2]}</td><td class="r num muted">${Math.round((r[2] / Q.auto) * 100)}%</td></tr>`,
        )
        .join('')}</tbody></table></div></section>
      <section class="panel"><h2>Storage, by group</h2><div class="tbl-w"><table class="tbl sm"><thead><tr><th>Group</th><th class="r">GB</th><th class="r">Items</th></tr></thead><tbody>${[
        ['Finance', 3.2, 61],
        ['Planning', 2.1, 44],
        ['Field team', 1.4, 38],
        ['Operations office', 0.7, 19],
      ]
        .map(
          (r) =>
            `<tr><td><b>${r[0]}</b></td><td class="r num">${fmtN(r[1])}</td><td class="r num">${r[2]}</td></tr>`,
        )
        .join('')}</tbody></table></div></section>
      <section class="panel"><h2>AI credits, by person</h2><div class="tbl-w"><table class="tbl sm"><thead><tr><th>Person</th><th class="r">Credits</th></tr></thead><tbody>${[
        ['Davide Conti', 18],
        ['Sara Greco', 13],
        ['Elena Ricci', 10],
      ]
        .map((r) => `<tr><td><b>${r[0]}</b></td><td class="r num">${r[1]}</td></tr>`)
        .join('')}</tbody></table></div></section></div>`,
      'consumers',
    ],
    [
      'Alerts',
      'bell',
      `<section class="panel"><div class="panel-h"><div><h2>When to warn</h2><p class="muted small">One alert for every quota that crosses the threshold, once a month.</p></div></div>
      <ul class="rows"><li><div class="rt grow"><b>At 80%</b><span>There is still time to act</span></div>${toggle(1)}</li><li><div class="rt grow"><b>At 100%</b><span>The quota is used up: additions stop</span></div>${toggle(1)}</li><li><div class="rt grow"><b>Forecast</b><span>If at the current pace the limit arrives before the end of the month</span></div>${toggle(1)}</li></ul></section>
      <section class="panel mt"><h2>Who gets them</h2><div class="gchips">${['The Tenant Managers of the tenant', 'Elena Ricci', 'Operations office'].map((g) => `<span class="gchip">${ic(g.startsWith('The ') ? 'key' : g === 'Operations office' ? 'users' : 'user', 13)}${g}<button type="button" aria-label="Remove ${g}">${ic('x', 12)}</button></span>`).join('')}<button type="button" class="gchip add">${ic('plus', 13)}Add</button></div>
        <div class="fgrid mt"><label class="lbl">How<select><option>Notification and email</option><option>Only notification</option><option>Only email</option></select></label></div></section>`,
      'alerts',
    ],
  ];
  const nav = secNav(S, 'use', parts);
  return detailPage(S, {
    title: 'Usage',
    sub: 'Quotas set by the administrator of the platform',
    body: nav.body,
    side: nav.side,
    sideNav: true,
  });
}

/* ── Shares (Tenant Manager) ──────────────────────────────────────────
   Every share of the tenant in one list: public items and outside links first, because they leave
   the tenant, then groups, the whole tenant and single people. The owner decides; the Tenant Manager
   sees everything and can take a share back. [item, kind, with, level, since, expires] */
const SHARES = [
  ['a2', 'public', 'Public: anybody with the address', 'View', '3 Oct 2026', '—'],
  ['n1', 'link', 'Link with password', 'View', '1 Oct 2026', '31 Oct 2026'],
  ['e1', 'link', 'Link', 'View', '6 Oct 2026', '6 Nov 2026'],
  ['e1', 'group', 'Group Field team', 'Edit', '3 Sep 2026', '—'],
  ['a1', 'group', 'Group Planning', 'View', '28 Aug 2026', '—'],
  ['e2', 'tenant', 'The whole tenant', 'View', '2 Oct 2026', '—'],
  ['t2', 'tenant', 'The whole tenant', 'Edit', '25 Sep 2026', '—'],
  ['n2', 'person', 'Sara Greco', 'Edit', '5 Oct 2026', '—'],
];
const SH_IC = { public: 'globe', link: 'link', group: 'users', tenant: 'building', person: 'user' };
function secShares(S) {
  setSub(null);
  const sc = tabOf(S, 'shk', 'all');
  const live = SHARES.map((r, i) => [i, r]).filter(([i]) => !(S.revoked || []).includes(i));
  const out = (r) => r[1] === 'public' || r[1] === 'link';
  const rows = live.filter(([, r]) => sc === 'all' || (sc === 'pub' ? out(r) : !out(r)));
  return resPage(
    S,
    {
      title: 'Shares',
      total: `${live.length} shares · ${live.filter(([, r]) => out(r)).length} outside the tenant`,
      bulk: { key: 'sh', ids: rows.map(([i]) => i), acts: [['x', 'Revoke', 1]] },
    },
    filterCol(
      S,
      'sh',
      [
        [
          'With',
          ['public', 'link', 'group', 'tenant', 'person'].map((k) => [
            { public: 'Public', link: 'Links', group: 'Groups', tenant: 'The whole tenant', person: 'People' }[k],
            live.filter(([, r]) => r[1] === k).length,
          ]),
        ],
        ['App', APPS.map((a) => [a.n, live.filter(([, r]) => ITEMS.find((x) => x.id === r[0]).app === a.id).length])],
        ['Level', ['View', 'Edit'].map((l) => [l, live.filter(([, r]) => r[3] === l).length])],
      ],
      {
        search: 'Search an item or a person',
        sort: SORT_TIME,
        scopeKey: 'shk',
        scope: [
          ['All', live.length, 'all'],
          ['Public and links', live.filter(([, r]) => out(r)).length, 'pub'],
          ['Inside the tenant', live.filter(([, r]) => !out(r)).length, 'in'],
        ],
      },
    ),
    `${sc === 'pub' ? `<div class="banner info">${ic('globe', 18)}<div><b>What leaves the tenant.</b> A public item is seen by anybody with the address; a link by whoever has it, until it expires. The owner decides them; you can take them back.</div></div>` : ''}
    <div class="tbl-w ${sc === 'pub' ? 'mt' : ''}"><table class="tbl"><thead><tr><th class="cbx"><span class="sr">Select</span></th><th>Item</th><th>Shared with</th><th>Level</th><th>Owner</th><th>Since</th><th>Expires</th><th></th></tr></thead><tbody>${rows
      .map(([i, r]) => {
        const it = ITEMS.find((x) => x.id === r[0]),
          a = APP(it.app);
        return `<tr class="${selOf(S, 'sh').includes(String(i)) ? 'picked' : ''}">${selTd(S, 'sh', i, it.t)}<td><div class="cell-t"><span class="ri">${ic(a.ic, 15)}</span><div><b>${it.t}</b><span class="muted small">${a.n}</span></div></div></td><td>${pill(r[2], out(r) ? 'warn' : '', SH_IC[r[1]])}</td><td>${pill(r[3], r[3] === 'Edit' ? 'info' : '')}</td><td class="small">${it.own}</td><td class="num muted">${r[4]}</td><td class="num muted">${r[5]}</td><td class="r">${btn('Revoke', { act: 'revoke', v: String(i) })}</td></tr>`;
      })
      .join('') || '<tr><td colspan="8" class="muted">Nothing shared here.</td></tr>'}</tbody></table></div>
    <p class="muted small mt">Revoking tells the owner. Items shared with a group follow the group: whoever joins gets them, whoever leaves loses them.</p>`,
  );
}

/* ── Person page ──────────────────────────────────────────────────────
   Opens from Manage (Tenant Manager) and from People (administrator) and goes back where it came
   from. Profile, sign-in, effective permissions, activity; the administrator also sees the tenants. */
const P_ST = {
  Active: { tone: 'ok', d: 'Signs in and works as usual.' },
  Suspended: {
    tone: 'bad',
    d: 'Cannot sign in: sessions closed and tokens revoked. Their items stay, and whoever saw them still does.',
  },
  Invited: { tone: 'warn', d: 'Has not accepted the invitation yet.' },
};
const ROLE_LIST = ['Tenant Manager', 'User'];
/* The profile image: PNG, JPG or WebP up to 2 MB, cropped to a circle. */
function avatarEdit(S, ini, c, self) {
  const has = !!AV_IMG[ini];
  return `<div class="avedit"><span class="avedit-p">${av(ini, c, 72)}</span><div class="avedit-t"><b>Profile image</b>
    <span class="muted small">PNG, JPG or WebP, up to 2 MB. It shows as a circle, so a face in the centre works best.</span>
    ${S.avErr && S.avErr.ini === ini ? `<span class="small bad">${S.avErr.msg}</span>` : ''}
    <div class="row"><label class="btn"><input type="file" class="sr" accept="image/png,image/jpeg,image/webp" data-avatar="${ini}">${ic('upload', 15)}<span>${has ? 'Change image' : 'Upload image'}</span></label>${has ? btn('Remove', { act: 'avrm', v: ini }) : ''}</div>
    ${self ? '' : '<span class="muted small">Usually the person sets it from their profile; whoever manages the tenant can change it here.</span>'}</div></div>`;
}
/* New person (administrator). The home tenant is required, because it decides how the person
   will sign in; other tenants can be added now or later. */
function secNewUser(S) {
  setSub('new');
  const N = S.newUser || {};
  const home = TENANTS.find((x) => x.n === N.home);
  const ok = !!(home && N.first && N.last && N.email && /@/.test(N.email));
  const v = (k) => (N[k] || '').replace(/"/g, '&quot;');
  let how = `<p class="muted small">Pick the tenant: how the person will sign in depends on it.</p>`;
  if (home) {
    const dom = (N.email || '').split('@')[1] || '',
      ssoDom = TEN_EXTRA[home.slug].mail;
    how = /^SSO/.test(home.auth)
      ? `<div class="banner info">${ic('key', 18)}<div><b>They will sign in with the identity provider (OIDC) of ${home.n}</b>. The account is created at the first sign-in; this email is only to let them know.${dom && dom !== ssoDom ? `<br><b>Note:</b> the email is not of the domain of the tenant (<span class="mono">${ssoDom}</span>): its identity provider may not recognize it.` : ''}</div></div>`
      : `<div class="banner info">${ic('mail', 18)}<div><b>They will sign in with a local account of ${home.n}</b>, kept by Mosaikit. They get a link to choose the password; the second factor follows the rules of ${home.n}.</div></div>`;
  }
  const assoc = N.assoc || [];
  return detailPage(S, {
    back: ['gusers', 'Back to People'],
    title: 'New person',
    sub: 'The home tenant decides how they will sign in',
    actions:
      btn('Cancel', { icon: 'undo', go: 'gusers' }) +
      `<button type="button" class="btn pri" data-act="nucreate" ${ok ? '' : 'disabled'} aria-label="Create" title="${ok ? 'Create the person' : 'First name, last name, email and home tenant are needed'}">${ic('save', 15)}<span>Create</span></button>`,
    body: `<section class="panel"><h2>Details</h2><div class="fgrid">
      <label class="lbl">First name<input type="text" data-nu="first" value="${v('first')}"></label><label class="lbl">Last name<input type="text" data-nu="last" value="${v('last')}"></label>
      <label class="lbl span2">Email<input type="email" data-nu="email" value="${v('email')}" placeholder="name@tenant.example"></label></div></section>
    <section class="panel mt"><h2>Home tenant <span class="req">required</span></h2>
      <div class="fgrid"><label class="lbl">Tenant<select data-nuhome><option value="">Choose…</option>${TENANTS.map(
        (x) => {
          const off = tenSt(S, x) === 'Suspended';
          return `<option ${x.n === N.home ? 'selected' : ''} ${off ? 'disabled' : ''}>${x.n}${off ? ' · suspended' : ''}</option>`;
        },
      ).join(
        '',
      )}</select><span class="hint">A suspended tenant takes no new people</span></label>
        <label class="lbl"><span class="lbl-h">Role in this tenant${roleHelp()}</span><select data-nu-sel="role">${ROLE_LIST.map((r) => `<option ${r === (N.role || 'User') ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
        <label class="lbl">Permission profile<select data-nu-sel="prof" ${(N.role || 'User') === 'Tenant Manager' ? 'disabled' : ''}>${PROFILES.map((pr) => `<option value="${pr.id}" ${pr.id === (N.prof || 'std') ? 'selected' : ''}>${pr.n}</option>`).join('')}</select><span class="hint">The profiles are those of the chosen tenant</span></label></div>
      <div class="mt">${how}</div></section>
    <section class="panel mt"><h2>Other tenants <span class="muted small">optional</span></h2><p class="muted small">They enter them as a guest, with the same sign-in. The role is at most the one each tenant grants to guests.</p>
      <ul class="rows">${TENANTS.filter((x) => x.n !== N.home && tenSt(S, x) !== 'Suspended')
        .map((x) => {
          const on = assoc.includes(x.n);
          return `<li><label class="assoc"><input type="checkbox" data-nuassoc="${x.n}" ${on ? 'checked' : ''} ${home ? '' : 'disabled'}><b>${x.n}</b></label><span class="grow"></span>${on ? `<select class="sm-sel" aria-label="Profile in ${x.n}"><option>View and edit</option><option>Standard</option><option>Analyst</option></select>` : `<span class="muted small">${home ? '' : 'pick the home tenant first'}</span>`}</li>`;
        })
        .join('')}</ul></section>`,
  });
}
function auditRows(rows, who) {
  return `<div class="tbl-w"><table class="tbl"><thead><tr><th>When</th>${who ? '' : '<th>Who</th>'}<th>What</th><th>On what</th><th>Outcome</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="num">${r[0]}</td>${who ? '' : `<td>${r[1]}</td>`}<td>${r[2]}${who && r[1] !== who ? ` <span class="muted small">· by ${r[1]}</span>` : ''}</td><td>${r[3]}</td><td>${pill(r[4], r[4] === 'Succeeded' ? 'ok' : 'bad')}</td></tr>`).join('')}</tbody></table></div>`;
}
function secPerson(S) {
  if (S.resId && S.resId.person === 'NEW') return secNewUser(S);
  const p = PEOPLE.find((x) => x.ini === (S.resId && S.resId.person)) || PEOPLE[1];
  const st = (S.pSt && S.pSt[p.ini]) || p.st;
  const role = (S.pRole && S.pRole[p.ini]) || p.role;
  const prof = (S.pProf && S.pProf[p.ini]) || p.prof || 'std';
  const sso = p.via === 'SSO';
  const guest = !!p.home,
    solo = personTenants(p).length === 1;
  const from =
    S.personFrom === 'gusers' || S.role === 'admin'
      ? ['gusers', 'Back to People']
      : ['members', 'Back to Manage'];
  const tabsL = [
    ['prof', 'Details'],
    ['acc', 'Sign-in'],
    ['perm', 'Permissions'],
    ['act', 'Activity'],
  ].concat(S.role === 'admin' ? [['ten', 'Tenants']] : []);
  const t0 = tabOf(S, 'per', 'prof');
  const t = tabsL.some((x) => x[0] === t0) ? t0 : 'prof';
  setSub(
    { prof: 'profile', acc: 'sign-in', perm: 'permissions', act: 'activity', ten: 'organizations' }[
      t
    ],
  );
  const [first, ...rest] = p.n.split(' ');
  let body;
  if (t === 'acc') {
    body = `${guest ? `<div class="banner info">${ic('building', 18)}<div><b>Guest from ${p.home}.</b> Signs in with the identity of their home tenant; here they only have role and groups. Password, second factor and sessions are managed by ${p.home}.</div></div>` : ''}
    <div class="two ${guest ? 'mt' : ''}"><section class="panel"><h2>How they sign in</h2><dl class="kv"><dt>Home tenant</dt><dd>${personHome(p)}</dd><dt>Sign-in</dt><dd>${sso ? viaLabel(p) : p.via === 'Local' ? viaLabel(p) + ', email and password' : 'Not yet: invitation pending'}</dd><dt>Second factor</dt><dd>${role === 'Tenant Manager' ? pill('On, required for the role', 'ok', 'check') : sso ? 'Managed by the identity provider of the tenant' : pill('Off', 'warn')}</dd><dt>Last sign-in</dt><dd>${p.last}</dd></dl>
        <div class="row mt">${guest ? '' : sso ? `<span class="muted small">The password and the second factor are managed by the identity provider of ${personHome(p)}.</span>` : p.via === 'Local' ? btn('Send the password link', { icon: 'mail' }) + btn('Reset the second factor') : btn('Send the invitation again', { icon: 'mail' })}</div></section>
      <section class="panel"><h2>Tokens</h2><dl class="kv"><dt>Personal access tokens</dt><dd>${p.last === 'Never' ? 'None' : '1 · created on 2 Sep 2026'}</dd><dt>Assistant</dt><dd>${p.last === 'Never' ? 'None' : '1 token for an AI client · expires on 30 Nov 2026'}</dd></dl>
        <p class="muted small">A token acts with the permissions of the person, and stops working when the person is suspended or removed.</p></section>
      <section class="panel span2"><div class="panel-h"><h2>Sessions and tokens</h2>${btn('Close every session')}</div>
        <div class="tbl-w"><table class="tbl sm"><thead><tr><th>What</th><th>From where</th><th>Last used</th><th></th></tr></thead><tbody>${
          (p.last === 'Never'
            ? []
            : [
                ['Web session', 'Chrome · Example City', p.last],
                ['Personal access token', 'created on 2 Sep 2026', 'Yesterday'],
                ['Assistant token', 'expires on 30 Nov 2026', '3 days ago'],
              ]
          )
            .map(
              (r) =>
                `<tr><td><b>${r[0]}</b></td><td class="muted">${r[1]}</td><td class="num">${r[2]}</td><td class="r">${btn(r[0].startsWith('Web') ? 'Close' : 'Revoke')}</td></tr>`,
            )
            .join('') ||
          '<tr><td colspan="4" class="muted">No session: they never signed in.</td></tr>'
        }</tbody></table></div></section></div>`;
  } else if (t === 'perm') {
    const g = p.groups[0];
    const rows = [
      ['note', 'Site visit, north depot', 'Edit', 'Shared directly'],
      ['receipt', 'Estimate 2026-114 · roof repairs', 'View', 'Group ' + g],
      ['calendar', 'Quarterly review with finance', 'View', 'Whole tenant'],
      ['checklist', 'Prepare the budget draft', 'Edit', 'Group ' + g],
      ['calendar', 'Open day 2026', 'View', 'Public'],
    ];
    const eff = effPerms(role === 'Tenant Manager' ? null : prof, p.groups, p.n);
    const why = S.whyItem
      ? (() => {
          const x = ITEMS.find((y) => y.id === S.whyItem),
            shared =
              x.acc === 'public' ||
              x.acc === 'org' ||
              (x.acc === 'groups' && ['Planning', 'Finance'].includes(g)),
            mod = role === 'Tenant Manager' || !!(PROF(prof).p[x.app] || [])[0];
          return `<ul class="chain">${[
            [
              shared,
              'Sharing',
              shared
                ? x.acc === 'groups'
                  ? 'To the group ' + g
                  : 'To ' + ACCESS[x.acc].label.toLowerCase()
                : `Not shared with them: the owner, ${x.own}, shares it`,
            ],
            [
              mod,
              'Plugin ' + APP(x.app).n,
              mod
                ? `${MOD_PERMS[x.app][0]}, from the ${PROF(prof).n} profile`
                : `The ${PROF(prof).n} profile does not give «${MOD_PERMS[x.app][0]}»`,
            ],
          ]
            .map(
              (c) =>
                `<li class="${c[0] ? 'ok' : 'no'}">${ic(c[0] ? 'check' : 'x', 14)}<div><b>${c[1]}</b><span class="small">${c[2]}</span></div></li>`,
            )
            .join(
              '',
            )}</ul><p class="small ${shared && mod ? 'ok-t' : 'bad'}">${shared && mod ? 'They see it.' : 'They do not see it, because of the first step in red.'}</p>`;
        })()
      : '';
    body = `${kpis([
      [
        'Role',
        role,
        role === 'Tenant Manager' ? 'every permission in the tenant' : PROF(prof).n + ' profile',
      ],
      ['Groups', p.groups.length, p.groups.join(', ')],
      ['Items they see', '86', 'of 214 in the apps'],
      ['Owner of', p.ini === 'DC' ? '7' : '3', 'notes, estimates and tasks'],
    ])}
      <section class="panel mt"><div class="panel-h"><div><h2>In the plugins</h2><p class="muted small">${role === 'Tenant Manager' ? 'A Tenant Manager has every permission of every plugin on in the tenant.' : `What they can do in every plugin, and where it comes from: the ${PROF(prof).n} profile, the groups, or a personal exception.`}</p></div>${role === 'Tenant Manager' ? '' : `<div class="row">${btn('Change profile', { icon: 'user', act: 'pproftab' })}${S.role === 'manager' ? btn('Edit in Plugins › Permissions', { icon: 'puzzle', go: 'splugins' }) : ''}</div>`}</div>${role === 'Tenant Manager' ? '' : permTable(eff, { off: true })}</section>
      <section class="panel mt"><div class="panel-h"><div><h2>Why can they not see an item?</h2><p class="muted small">Pick the item: the platform rebuilds the chain, from the share to the permission of the plugin.</p></div></div>
        <label class="lbl">Item<select data-whynot><option value="">Choose…</option>${ITEMS.map((x) => `<option value="${x.id}" ${S.whyItem === x.id ? 'selected' : ''}>${x.t}</option>`).join('')}</select></label>${why}</section>
      <section class="panel mt"><div class="panel-h"><div><h2>On the items</h2><p class="muted small">For every item the highest level they get wins.</p></div></div>
      <div class="tbl-w"><table class="tbl"><thead><tr><th>Item</th><th>Level</th><th>Comes from</th></tr></thead><tbody>${rows.map((r) => `<tr><td><div class="cell-t"><span class="ri">${ic(r[0], 15)}</span><b>${r[1]}</b></div></td><td>${pill(r[2], r[2] === 'Edit' ? 'info' : '')}</td><td class="small">${r[3]}</td></tr>`).join('')}</tbody></table></div></section>`;
  } else if (t === 'act') {
    body =
      auditRows(
        [
          ['Today 09:14', p.n, 'Opened the note', 'Site visit, north depot', 'Succeeded'],
          [
            'Today 09:12',
            p.n,
            sso ? 'Signed in with SSO' : 'Signed in with a local account',
            '—',
            'Succeeded',
          ],
          ['Yesterday 16:12', p.n, 'Ran the automation', 'Monthly report of open tasks', 'Failed'],
          ['Yesterday 11:03', 'Elena Ricci', 'Added to the group', p.groups[0], 'Succeeded'],
          [
            '2 Oct 2026',
            p.n,
            'Created an estimate',
            'Estimate 2026-114 · roof repairs',
            'Succeeded',
          ],
        ],
        p.n,
      ) +
      `<div class="row mt">${btn('See everything in the log', { icon: 'history', act: 'logperson', v: p.n })}</div>`;
  } else if (t === 'ten') {
    body = `<section class="panel"><div class="panel-h"><div><h2>Tenants they belong to</h2><p class="muted small">One home tenant, which decides how they sign in; the others as a guest, each with its role, reached with the same identity.</p></div>${btn('Add to a tenant', { icon: 'plus' })}</div>
      <div class="tbl-w"><table class="tbl"><thead><tr><th>Tenant</th><th>Link</th><th><span class="lbl-h">Role${roleHelp()}</span></th><th>Profile</th><th>Groups</th><th>Since</th><th></th></tr></thead><tbody>${personTenants(
        p,
      )
        .map(
          (m, i) =>
            `<tr><td><b>${m[0]}</b></td><td>${m[2] === 'home' ? pill('Home', 'info', 'key') : pill('Guest')}</td><td><select class="sm-sel" aria-label="Role in ${m[0]}">${ROLE_LIST.map((r) => `<option ${r === m[1] ? 'selected' : ''}>${r}</option>`).join('')}</select></td><td>${m[1] === 'Tenant Manager' ? '<span class="muted small">every permission</span>' : `<select class="sm-sel" aria-label="Profile in ${m[0]}">${PROFILES.map((pr) => `<option ${pr.id === (i ? 'view' : p.prof) ? 'selected' : ''}>${pr.n}</option>`).join('')}</select>`}</td><td class="small">${(i ? ['Field team'] : p.groups).join(', ')}</td><td class="num muted">${i ? '14 Mar 2026' : '9 Jan 2025'}</td><td class="r">${m[2] === 'home' ? (solo ? '' : btn('Move the home tenant', { act: 'movehome' })) : btn('Remove')}</td></tr>`,
        )
        .join('')}</tbody></table></div>
      <p class="muted small mt">The role in every tenant can be changed by the administrator, here, or by the Tenant Manager of that tenant; groups are given by the Tenant Manager. Moving the home tenant changes how one signs in: from the next day the person uses the sign-in of the new tenant, and must know it first.</p></section>`;
  } else {
    const profSel = `<label class="lbl">Permission profile<select data-pprof ${role === 'Tenant Manager' ? 'disabled' : ''}>${PROFILES.map((pr) => `<option value="${pr.id}" ${pr.id === prof ? 'selected' : ''}>${pr.n}</option>`).join('')}</select><span class="hint">${role === 'Tenant Manager' ? 'A Tenant Manager already has every permission' : 'Where the permissions in the plugins start; groups add. <a data-tab="per:perm">See the permissions</a>'}</span></label>`;
    const roleSel = `<label class="lbl"><span class="lbl-h">Role${roleHelp()}</span><select data-prole ${sso ? 'disabled' : ''}>${ROLE_LIST.map((r) => `<option ${r === role ? 'selected' : ''}>${r}</option>`).join('')}</select>${sso ? '<span class="hint">With an identity provider (OIDC) the role arrives from its groups at every sign-in: the administrator sets the rules in the Sign-in of the tenant</span>' : '<span class="hint">What they can do in general; on what, shares say</span>'}</label>`;
    body = `<section class="panel"><h2>Details</h2>${guest ? `<p class="muted small">Name, email and image are managed by ${p.home}, their home tenant.</p>` : avatarEdit(S, p.ini, p.c)}<div class="fgrid">${fld('First name', first, { ro: guest })}${fld('Last name', rest.join(' '), { ro: guest })}${fld('Email', p.mail, { type: 'email', ro: sso || guest, hint: sso ? 'Comes from the identity provider of the tenant: it changes there' : '' })}${fld('Office', p.groups[0])}</div></section>
    ${
      S.role === 'admin'
        ? `<section class="panel mt"><h2>Role and groups</h2><p class="muted small">They change from tenant to tenant: they are chosen in the tab <a data-tab="per:ten">Tenants</a>.</p></section>`
        : `<section class="panel mt"><h2>Role, profile and groups</h2><div class="fgrid">${roleSel}${profSel}
      <div class="lbl">Groups<div class="gchips">${p.groups.map((g) => `<span class="gchip">${ic('users', 13)}${g}<button type="button" aria-label="Remove from ${g}">${ic('x', 12)}</button></span>`).join('')}<button type="button" class="gchip add">${ic('plus', 13)}Add</button></div><span class="hint">${sso ? 'The groups of the identity provider arrive by themselves; here one adds the groups that exist only in Mosaikit' : 'Groups receive shares and permissions in the plugins'}</span></div></div></section>`
    }
    <section class="panel mt danger">${S.role === 'admin' ? '' : `<div class="panel-h"><div><h2>Remove from the tenant</h2><p class="muted small">They own ${p.ini === 'DC' ? '7' : '3'} items here: first one picks who gets them. ${guest ? `The account stays: it belongs to ${p.home}.` : solo ? 'They are in no other tenant: removing them here leaves the account without a tenant, so deleting it is better.' : 'The account stays, because it is in other tenants too.'}</p></div>${btn('Remove from the tenant', { icon: 'x', act: 'rmperson' })}</div>`}
      ${guest ? '' : `<div class="panel-h ${S.role === 'admin' ? '' : 'mt'}"><div><h2>Delete the account</h2><p class="muted small">Removes the person from Mosaikit and from every tenant${solo ? '' : ' they are in'}; their items go to whoever is chosen, tokens are revoked.${sso ? ' With an identity provider (OIDC), if the tenant does not remove them from its identity provider, they would come back as new at the next sign-in: the platform blocks them until the identity provider confirms.' : ''}</p></div>${btn('Delete the account', { icon: 'trash', kind: 'danger', act: 'ask', v: 'delacc' })}</div>`}</section>`;
  }
  const stBanner =
    st === 'Suspended'
      ? `<div class="banner bad">${ic('lock', 18)}<div><b>Suspended.</b> ${P_ST.Suspended.d}</div>${btn('Reactivate', { kind: 'pri', act: 'pst', v: 'Active' })}</div>`
      : st === 'Invited'
        ? `<div class="banner warn">${ic('mail', 18)}<div><b>Invitation sent 9 days ago, not accepted yet.</b> It expires in 5 days.</div>${btn('Send again')}</div>`
        : '';
  // The state is a badge next to the name; changing it is in «⋯», with the other secondary actions.
  const more = moreMenu(S, 'person', [
    st === 'Suspended'
      ? ['refresh', 'Reactivate', 'data-act="pst" data-v="Active"', P_ST.Active.d]
      : st === 'Invited'
        ? ['mail', 'Send the invitation again', 'data-act="toast" data-v="Invitation sent again: it expires in 14 days."']
        : ['lock', 'Suspend', 'data-act="pst" data-v="Suspended"', P_ST.Suspended.d],
    ['history', 'See everything in the log', `data-act="logperson" data-v="${p.n}"`],
  ]);
  return detailPage(S, {
    back: from,
    crumbs: from[0] === 'gusers' ? [['People', 'gusers']] : [['Manage', 'members', 'mem:users']],
    title: p.n,
    badges: pill(st, P_ST[st].tone),
    sub: `${p.mail} · ${role === 'Tenant Manager' ? role : 'User, ' + PROF(prof).n} · ${p.groups.join(', ')}`,
    actions: more,
    tabs: tabs(tabsL, t, 'per'),
    body: stBanner + (t === 'prof' ? `<div data-dirty="person">${body}</div>${saveBar(S, 'person')}` : body),
  });
}

/* ── Group page (Tenant Manager) ─────────────────────────────────────────────
   A group belongs to the tenant. One tab each for what it is for: who is in it, what is
   shared with it, which plugins it adds. */
function secGroup(S) {
  const gi = +((S.resId && S.resId.group) || 0);
  const g = GROUPS[gi] || GROUPS[0];
  const t0 = tabOf(S, 'grp', 'set');
  const t = ['set', 'mem', 'res', 'mod'].includes(t0) ? t0 : 'set';
  setSub({ set: 'settings', mem: 'members', res: 'shared', mod: 'modules' }[t]);
  const members = PEOPLE.filter((p) => p.groups.includes(g.n));
  let body;
  if (t === 'res') {
    const res = [
      ['note', 'Site visit, north depot', 'Note', 'Edit', 'Elena Ricci', '12 Sep 2026'],
      [
        'receipt',
        'Estimate 2026-114 · roof repairs',
        'Estimate',
        'View',
        'Davide Conti',
        '3 Sep 2026',
      ],
      [
        'calendar',
        'Quarterly review with finance',
        'Activity',
        'View',
        'Sara Greco',
        '28 Aug 2026',
      ],
      ['checklist', 'Prepare the budget draft', 'Task', 'Edit', 'Davide Conti', '20 Aug 2026'],
    ];
    body = `<p class="muted small">The items shared with the group: whoever joins the group gets them at once, whoever leaves loses them. ${g.res} in all.</p>
      <div class="tbl-w mt"><table class="tbl"><thead><tr><th>Item</th><th>Kind</th><th>Level</th><th>Shared by</th><th>Since</th><th></th></tr></thead><tbody>${res.map((r) => `<tr><td><div class="cell-t"><span class="ri">${ic(r[0], 15)}</span><b>${r[1]}</b></div></td><td>${r[2]}</td><td>${pill(r[3], r[3] === 'Edit' ? 'info' : '')}</td><td class="small">${r[4]}</td><td class="num muted">${r[5]}</td><td class="r">${btn('Remove')}</td></tr>`).join('')}</tbody></table></div>`;
  } else if (t === 'mod') {
    const mods = Object.keys(MOD_GRANTS)
      .map((k) => [k, (MOD_GRANTS[k] || []).find((r) => r[1] === 'Group ' + g.n)])
      .filter((x) => x[1]);
    body = `<div class="panel-h"><p class="muted small">What the group adds, plugin by plugin, to the permissions of the profile of each member. It changes in Plugins › Permissions, the only place where permissions are given.</p>${btn('Edit in Plugins › Permissions', { icon: 'puzzle', go: 'splugins' })}</div>
      <ul class="rows panel mt">${mods.map((m) => `<li><span class="ri">${ic(FEAT(m[0]) ? FEAT(m[0]).ic : 'puzzle', 15)}</span><div class="rt"><b>${FEAT(m[0]) ? FEAT(m[0]).n : m[0]}</b><span>${MOD_PERMS[m[0]].filter((p, i) => m[1][3][i]).join(' · ')}</span></div>${btn('Open', { act: 'modacc', v: m[0] })}</li>`).join('') || '<li class="muted">The group adds no permission: members have the ones of their profile.</li>'}</ul>`;
  } else if (t === 'set') {
    body = `<section class="panel"><h2>Group</h2><div class="fgrid">${fld('Name', g.n)}${fld('Description', g.d)}</div></section>
      <section class="panel mt"><h2>Where members come from</h2>
        <div class="opts"><label class="opt ${g.kc ? 'sel' : ''}"><input type="radio" name="gorig" ${g.kc ? 'checked' : ''}><b>From the identity provider of the tenant</b><span>Whoever has <span class="mono">${g.n.toLowerCase().replace(/ /g, '-')}</span> in the <span class="mono">groups</span> claim joins the group by themselves, at every sign-in; whoever loses it leaves.</span></label>
          <label class="opt ${g.kc ? '' : 'sel'}"><input type="radio" name="gorig" ${g.kc ? '' : 'checked'}><b>Only from Mosaikit</b><span>Members are added and removed by the Tenant Manager. Useful for guests and for groups the identity provider does not know.</span></label></div></section>
      <section class="panel mt danger"><div class="panel-h"><div><h2>Delete the group</h2><p class="muted small">The ${g.res} shares of the group go away; people stay in the tenant and lose what they received through the group.</p></div>${btn('Delete the group', { icon: 'trash', kind: 'danger', act: 'ask', v: 'delgroup' })}</div></section>`;
  } else {
    body = `${g.kc ? `<div class="banner info">${ic('key', 18)}<div><b>Members from the identity provider of the tenant.</b> Whoever has the group in their account of the tenant joins and leaves by themselves, at every sign-in. Here one adds only members the identity provider does not know, like guests.</div></div>` : ''}
      <div class="field mt">${ic('search', 15)}<input type="text" placeholder="Add people of the tenant or guests" aria-label="Add people"></div>
      <div class="tbl-w mt"><table class="tbl"><thead><tr><th>Name</th><th>Role</th><th>Joined through</th><th></th></tr></thead><tbody>${members.map((p) => `<tr class="clk" data-res="person:${p.ini}" data-go="person"><td><div class="cell-t">${av(p.ini, p.c, 26)}<div><b>${p.n}</b><span class="muted small">${p.mail}</span></div></div></td><td>${pill(p.role)}</td><td class="small">${p.home ? pill('Guest · ' + p.home, 'info') : g.kc && p.via === 'SSO' ? 'Identity provider' : 'Added in Mosaikit'}</td><td class="r">${g.kc && p.via === 'SSO' && !p.home ? '<span class="muted small">removed from the identity provider</span>' : btn('Remove')}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted small mt">${members.length} of ${g.m} members shown.</p>`;
  }
  return detailPage(S, {
    back: ['members', 'Back to Manage'],
    crumbs: [['Manage', 'members', 'mem:groups']],
    title: g.n,
    sub: `${g.d} · ${g.m} people · ${g.kc ? 'from the identity provider' : 'only Mosaikit'}`,
    tabs: tabs(
      [
        ['set', 'Settings'],
        ['mem', 'Members'],
        ['res', 'Shared items'],
        ['mod', 'Plugins'],
      ],
      t,
      'grp',
    ),
    body: t === 'set' ? `<div data-dirty="group">${body}</div>${saveBar(S, 'group')}` : body,
  });
}

/* ── Activity log (Tenant Manager) and audit log (administrator) ─────────────
   Three questions, three filters: WHO (people, groups, the platform), WHAT (family of action),
   ON WHAT (kind and item). A click on a name or an item in the table becomes a filter; the active
   filters sit above the table. A click on a row opens the detail. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function logDate(e) {
  if (e.d === 0) return 'Today';
  if (e.d === 1) return 'Yesterday';
  const x = new Date(2026, 9, 8 - e.d);
  return `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
}
function isoDate(s) {
  const [y, m, d] = s.split('-');
  return `${+d} ${MONTHS[+m - 1]} ${y}`;
}
function logF(S, k) {
  S.lf = S.lf || {};
  S.lf[k] = S.lf[k] || {
    who: [],
    fam: [],
    type: [],
    target: [],
    ten: [],
    ok: 'all',
    per: '30',
    from: '2026-10-01',
    to: '2026-10-08',
    q: '',
  };
  return S.lf[k];
}
function logGroupOf(name) {
  const p = PEOPLE.find((x) => x.n === name);
  return p ? p.groups : [];
}
function logRows(S, k) {
  const F = logF(S, k),
    adm = k === 'aud';
  return LOG.filter((e) => adm || e.ten === 'Example City')
    .filter((e) => {
      if (
        F.who.length &&
        !F.who.some(
          (w) => w === e.who || (w.startsWith('Group ') && logGroupOf(e.who).includes(w.slice(6))),
        )
      )
        return false;
      if (F.fam.length && !F.fam.includes(e.fam)) return false;
      if (F.type.length && !F.type.includes(e.type)) return false;
      if (F.target.length && !F.target.includes(e.target)) return false;
      if (F.ten.length && !F.ten.includes(e.ten)) return false;
      if (F.ok === 'ko' && e.ok) return false;
      if (F.per === '0' && e.d !== 0) return false;
      if (F.per === '7' && e.d >= 7) return false;
      if (F.per === '30' && e.d >= 30) return false;
      if (F.per === 'custom') {
        const day = new Date(2026, 9, 8 - e.d),
          a = new Date(F.from),
          b = new Date(F.to);
        b.setHours(23, 59);
        if (day < a || day > b) return false;
      }
      if (
        F.q &&
        !(e.who + ' ' + e.act + ' ' + e.target + ' ' + e.ten)
          .toLowerCase()
          .includes(F.q.toLowerCase())
      )
        return false;
      return true;
    })
    .sort((a, b) => a.d - b.d || b.t.localeCompare(a.t));
}
/* Multiple choice with search: the chosen values are chips in the field; typing filters the list,
   which opens below and shows at most 8 values. */
function logOptions(S, k, key) {
  const adm = k === 'aud',
    base = LOG.filter((e) => adm || e.ten === 'Example City');
  const cnt = (fn) => base.filter(fn).length;
  if (key === 'who') {
    const people = [...new Set(base.map((e) => e.who))]
      .filter((p) => p !== 'Unknown')
      .sort((a, b) => (a === 'Mosaikit') - (b === 'Mosaikit') || a.localeCompare(b));
    const groups = [...new Set(base.flatMap((e) => logGroupOf(e.who)))].sort();
    return people
      .map((p) => [
        p,
        p === 'Mosaikit' ? 'Mosaikit (automatic)' : p,
        p === 'Mosaikit' ? 'cpu' : 'user',
        cnt((e) => e.who === p),
      ])
      .concat(
        groups.map((g) => [
          'Group ' + g,
          'Group ' + g,
          'users',
          cnt((e) => logGroupOf(e.who).includes(g)),
        ]),
      );
  }
  return [...new Set(base.filter((e) => e.type !== 'person').map((e) => e.target))]
    .sort()
    .map((x) => [
      x,
      x,
      {
        note: 'note',
        activity: 'calendar',
        estimate: 'receipt',
        task: 'checklist',
        group: 'users',
        settings: 'sliders',
        organization: 'building',
      }[(base.find((e) => e.target === x) || {}).type] || 'file',
      cnt((e) => e.target === x),
    ]);
}
function msItems(S, k, key) {
  const F = logF(S, k),
    q = ((S.msQ || {})[key] || '').toLowerCase();
  const all = logOptions(S, k, key).filter((o) => !q || o[1].toLowerCase().includes(q));
  const shown = all.slice(0, 8);
  return shown.length
    ? shown
        .map(
          (o) =>
            `<button type="button" role="option" aria-selected="${F[key].includes(o[0])}" data-act="lfx" data-k="${key}" data-v="${o[0]}"><span class="ms-ck">${F[key].includes(o[0]) ? ic('check', 12) : ''}</span>${ic(o[2], 14)}<span class="ms-t">${o[1]}</span><span class="num muted">${o[3]}</span></button>`,
        )
        .join('') +
        (all.length > 8
          ? `<p class="muted small ms-more">and ${all.length - 8} more: type to narrow</p>`
          : '')
    : `<p class="muted small ms-more">Nothing with «${q}»</p>`;
}
function multiSelect(S, k, key, ph) {
  const F = logF(S, k),
    opts = logOptions(S, k, key);
  const lab = (v) => (opts.find((o) => o[0] === v) || [v, v])[1];
  return `<div class="ms" data-ms="${key}"><div class="ms-box">${F[key].map((v) => `<span class="gchip">${lab(v)}<button type="button" data-act="lfx" data-k="${key}" data-v="${v}" aria-label="Remove ${lab(v)}">${ic('x', 12)}</button></span>`).join('')}
    <input type="text" data-msq="${key}" placeholder="${F[key].length ? 'Add…' : ph}" value="${((S.msQ || {})[key] || '').replace(/"/g, '&quot;')}" aria-label="${ph}" role="combobox" aria-expanded="false" autocomplete="off"></div>
    <div class="ms-dd" role="listbox" aria-multiselectable="true" data-mslist="${key}">${msItems(S, k, key)}</div></div>`;
}
function logFilters(S, k) {
  const F = logF(S, k),
    adm = k === 'aud';
  const base = LOG.filter((e) => adm || e.ten === 'Example City');
  const cnt = (fn) => base.filter(fn).length;
  const opt = (key, v, label, n) =>
    `<label><input type="checkbox" data-act="lfx" data-k="${key}" data-v="${v}" ${F[key].includes(v) ? 'checked' : ''}><span>${label}</span><span class="num muted">${n}</span></label>`;
  const per = [
    ['0', 'Today'],
    ['7', 'Last 7 days'],
    ['30', 'Last 30 days'],
    ['all', 'Always'],
    ['custom', 'From… to…'],
  ];
  return `<aside class="facets ${S.filtersOpen ? 'open' : ''}" aria-label="Filters">
    <div class="facets-top"><fieldset class="facet scope"><legend>Show</legend>${[
      ['all', 'Everything', base.length],
      ['ko', 'Only failed', cnt((e) => !e.ok)],
    ]
      .map(
        (o) =>
          `<label><input type="radio" name="${k}-ok" data-act="lfok" data-v="${o[0]}" ${F.ok === o[0] ? 'checked' : ''}><span>${o[1]}</span><span class="num muted">${o[2]}</span></label>`,
      )
      .join('')}</fieldset></div>
    <div class="facets-scroll"><div class="facets-h"><b>Filters</b><a data-act="lfclear">Reset</a></div>
      <div class="fq"><div class="field sm">${ic('search', 14)}<input type="search" placeholder="Search the whole log" data-lfsearch="${k}" value="${F.q.replace(/"/g, '&quot;')}" aria-label="Search the whole log"></div></div>
      <fieldset class="facet"><legend>Who</legend>${multiSelect(S, k, 'who', 'A person or a group')}</fieldset>
      <fieldset class="facet"><legend>What</legend>${Object.keys(LOG_FAM)
        .filter((f) => cnt((e) => e.fam === f))
        .map((f) =>
          opt(
            'fam',
            f,
            LOG_FAM[f],
            cnt((e) => e.fam === f),
          ),
        )
        .join('')}</fieldset>
      <fieldset class="facet"><legend>On what</legend>${Object.keys(LOG_TYPE)
        .filter((ty) => cnt((e) => e.type === ty))
        .map((ty) =>
          opt(
            'type',
            ty,
            LOG_TYPE[ty],
            cnt((e) => e.type === ty),
          ),
        )
        .join('')}
        <div class="lf-sub">One precise item</div>${multiSelect(S, k, 'target', 'Search an item')}</fieldset>
      ${
        adm
          ? `<fieldset class="facet"><legend>Tenant</legend>${['Mosaikit (Platform)']
              .concat(TENANTS.map((x) => x.n))
              .map((n) =>
                opt(
                  'ten',
                  n,
                  n,
                  cnt((e) => e.ten === n),
                ),
              )
              .join('')}</fieldset>`
          : ''
      }
      <fieldset class="facet"><legend>Period</legend>${per.map((p) => `<label><input type="radio" name="${k}-per" data-act="lfper" data-v="${p[0]}" ${F.per === p[0] ? 'checked' : ''}><span>${p[1]}</span></label>`).join('')}
        ${F.per === 'custom' ? `<div class="lf-dates"><label class="lbl">From<input type="date" data-lfdate="from" value="${F.from}"></label><label class="lbl">To<input type="date" data-lfdate="to" value="${F.to}"></label></div>` : ''}</fieldset>
    </div></aside>`;
}
function logChips(S, k) {
  const F = logF(S, k),
    chips = [];
  F.who.forEach((v) =>
    chips.push(['who', v, `Who: ${v === 'Mosaikit' ? 'Mosaikit (automatic)' : v}`]),
  );
  F.fam.forEach((v) => chips.push(['fam', v, `What: ${LOG_FAM[v]}`]));
  F.type.forEach((v) => chips.push(['type', v, `On: ${LOG_TYPE[v]}`]));
  F.target.forEach((v) => chips.push(['target', v, `On: ${v}`]));
  F.ten.forEach((v) => chips.push(['ten', v, `Tenant: ${v}`]));
  if (F.ok === 'ko') chips.push(['ok', 'ko', 'Only failed']);
  if (F.per !== '30')
    chips.push([
      'per',
      F.per,
      F.per === 'custom'
        ? `From ${isoDate(F.from)} to ${isoDate(F.to)}`
        : { 0: 'Today', 7: 'Last 7 days', all: 'Always' }[F.per],
    ]);
  if (F.q) chips.push(['q', F.q, `Text: «${F.q}»`]);
  return chips.length
    ? `<div class="lf-chips">${chips.map((c) => `<span class="gchip">${c[2]}<button type="button" data-act="lfdel" data-k="${c[0]}" data-v="${c[1]}" aria-label="Remove the filter ${c[2]}">${ic('x', 12)}</button></span>`).join('')}<button type="button" class="lf-clear" data-act="lfclear">Remove all</button></div>`
    : '';
}
function logDetail(S, e, adm) {
  return `<aside class="preview" aria-label="Detail of the event">
    <button type="button" class="btn pv-close" data-act="logclose" aria-label="Close the detail" title="Close the detail">${ic('x', 15)}</button>
    <h2>${e.act}</h2><p class="muted small">${logDate(e)}, ${e.t} · ${e.ok ? 'succeeded' : 'failed'}</p>
    <dl class="kv"><dt>Who</dt><dd>${e.who}${logGroupOf(e.who).length ? `<span class="muted small"> · ${logGroupOf(e.who).join(', ')}</span>` : ''}</dd><dt>On what</dt><dd>${LOG_TYPE[e.type]} · ${e.target}</dd>${adm ? `<dt>Tenant</dt><dd>${e.ten}</dd>` : ''}
      ${e.before ? `<dt>Before</dt><dd>${e.before}</dd>` : ''}${e.after ? `<dt>${e.before ? 'After' : 'Outcome'}</dt><dd>${e.after}</dd>` : ''}<dt>From where</dt><dd class="mono small">${e.ip}</dd><dt>Device</dt><dd>${e.dev}</dd></dl>
    <div class="pv-a">${e.who !== 'Unknown' ? `<button type="button" class="btn" data-act="lfset" data-k="who" data-v="${e.who}">${ic('user', 15)}<span>Only ${e.who === 'Mosaikit' ? 'Mosaikit' : e.who.split(' ')[0]}</span></button>` : ''}<button type="button" class="btn" data-act="lfset" data-k="target" data-v="${e.target}">${ic('filter', 15)}<span>Only this item</span></button></div></aside>`;
}
function logPage(S, k) {
  setSub(null);
  const adm = k === 'aud',
    rows = logRows(S, k),
    sel = rows.find((e) => e.id === S.logSel);
  const link = (key, v, label) =>
    `<button type="button" class="lf-link" data-act="lfset" data-k="${key}" data-v="${v}" title="Filter: ${label}">${label}</button>`;
  const table = rows.length
    ? `<div class="tbl-w"><table class="tbl"><thead><tr><th class="cbx"><span class="sr">Select</span></th><th>When</th><th>Who</th><th>What</th><th>On what</th>${adm ? '<th>Tenant</th>' : ''}<th>Outcome</th></tr></thead><tbody>
    ${rows.map((e) => `<tr class="clk ${S.logSel === e.id ? 'picked' : ''}" data-act="logsel" data-v="${e.id}">${selTd(S, k, e.id, e.act)}<td class="num">${logDate(e)} ${e.t}</td><td>${e.who === 'Unknown' ? '<span class="muted">Unknown</span>' : link('who', e.who, e.who)}</td><td>${e.act}</td><td><span class="muted small">${LOG_TYPE[e.type]}</span> ${link('target', e.target, e.target)}</td>${adm ? `<td class="small">${link('ten', e.ten, e.ten)}</td>` : ''}<td>${pill(e.ok ? 'Succeeded' : 'Failed', e.ok ? 'ok' : 'bad')}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty"><b>No event with these filters.</b><span class="muted small">Try removing a filter or widening the period.</span></div>`;
  return resPage(
    S,
    {
      title: 'Log',
      total: `${rows.length} events${S.lf && Object.values(logF(S, k)).some((v) => Array.isArray(v) && v.length) ? ' with the active filters' : ''}`,
      actions: `<button type="button" class="btn" data-act="logexport" data-key="${k}">${ic('download', 15)}<span>Export CSV</span></button>`,
      bulk: { key: k, ids: rows.map((e) => e.id), acts: [['download', 'Export the selected']] },
    },
    logFilters(S, k),
    logChips(S, k) + table,
    sel ? logDetail(S, sel, adm) : '',
  );
}
function secActivity(S) {
  return logPage(S, 'act');
}
function secAudit(S) {
  return logPage(S, 'aud');
}

/* ── Dialogs of the tenant ─────────────────────────────────────── */

/* Inviting: the email says whether the person already has an account, and so how they will sign in. */
function inviteInfo(S) {
  const e = (S.invEmail || '').trim().toLowerCase();
  if (!e || !e.includes('@'))
    return {
      html: `<p class="muted small">Write an email: the platform tells you whether the person already has an account and how they will sign in.</p>`,
      ok: false,
    };
  const a = ACCOUNTS[e];
  if (a && a.tenants.some((m) => m[0] === 'Example City'))
    return {
      html: `<div class="banner info">${ic('check', 18)}<div><b>${a.who} is already part of Example City.</b> The role changes from their page.</div></div>`,
      ok: false,
    };
  if (a)
    return {
      guest: true,
      ok: true,
      html: `<div class="banner info">${ic('building', 18)}<div><b>${a.who} already has an account: they belong to ${a.home}.</b> They will enter as a <b>guest</b>, with their own sign-in (${a.via === 'sso' ? 'identity provider (OIDC) of ' + a.home : 'local account of ' + a.home}). Here they get role and groups; for guests the highest role is User.</div></div>`,
    };
  const dom = e.split('@')[1];
  if (SSO_DOMAINS[dom] === 'Example City')
    return {
      ok: true,
      html: `<div class="banner info">${ic('user', 18)}<div><b>New account of Example City.</b> This will be their home tenant: they will sign in with the identity provider (OIDC) of Example City, and the account is created at the first sign-in.</div></div>`,
    };
  return {
    ok: false,
    html: `<div class="banner warn">${ic('alert', 18)}<div><b>They have no account and Example City signs in only with its identity provider (OIDC).</b> A person from outside can get in if they already have an account in another tenant, or if the identity provider of Example City creates one for them.</div></div>`,
  };
}
DIALOGS.invite = (S) => {
  const inf = inviteInfo(S);
  const I =
    S.inv ||
    (S.inv = {
      role: 'User',
      prof: PROFILES.find((p) => p.def).id,
      groups: [],
      extra: {},
      adv: false,
    });
  const ex = [
    'm.ferri@region.example.org',
    'new@city.example.org',
    'd.conti@city.example.org',
    'g.green@freelance.example.org',
  ];
  return {
    html: `<div class="dlg-h"><h2>Invite people</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b stack">
      <label class="lbl">Email<input type="email" id="inv-email" value="${S.invEmail || ''}" placeholder="name@tenant.example" autocomplete="off"></label>
      <div class="lg-ex"><span class="muted small">Try with</span>${ex.map((x) => `<button type="button" class="chip" data-act="invex" data-v="${x}">${x}</button>`).join('')}</div>
      <div id="inv-info">${inf.html}</div>
      <div class="fgrid"><label class="lbl"><span class="lbl-h">Role${roleHelp()}</span><select data-invrole>${ROLE_LIST.map((r) => `<option ${r === I.role ? 'selected' : ''} ${inf.guest && r === 'Tenant Manager' ? 'disabled' : ''}>${r}${inf.guest && r === 'Tenant Manager' ? ' · not for guests' : ''}</option>`).join('')}</select></label></div>
      ${
        I.role === 'Tenant Manager'
          ? `<p class="muted small">A Tenant Manager has every permission of the plugins on in the tenant: profile and groups are not needed.</p>`
          : `<div><div class="lbl-h inv-l">Permission profile</div><div class="opts prof-o sm">${PROFILES.map((pr) => `<button type="button" class="opt ${pr.id === I.prof ? 'sel' : ''}" data-act="invprof" data-v="${pr.id}" aria-pressed="${pr.id === I.prof}"><b>${pr.n}</b><span>${pr.d}</span></button>`).join('')}</div></div>
      <div><div class="lbl-h inv-l">Groups</div><div class="gchips">${GROUPS.map((g) => {
        const on = I.groups.includes(g.n);
        return `<button type="button" class="gchip tg ${on ? 'on' : ''}" data-act="invgrp" data-v="${g.n}" aria-pressed="${on}">${on ? ic('check', 12) : ic('plus', 12)}${g.n}</button>`;
      }).join('')}</div></div>
      <section class="inv-prev"><div class="panel-h"><div><b>What they will be able to do</b><span class="muted small"> · from the profile and the groups</span></div></div>
        ${permTable(effPerms(I.prof, I.groups, null, {}), {})}<p class="muted small">A permission for this person only is given after, in Plugins › Permissions: the one place where permissions are given.</p></section>`
      }</div>
      <div class="dlg-f"><span class="muted small">The invitation expires in 14 days. Whoever accepts signs in with their own access, and finds this tenant in the choice.</span>${btn('Cancel', { act: 'close' })}<button type="button" class="btn pri" id="inv-send" ${inf.ok ? '' : 'disabled'}>${ic('mail', 15)}<span>Send the invitation</span></button></div>`,
  };
};
DIALOGS.groupnew = () => ({
  html: `<div class="dlg-h"><h2>New group</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b stack">
      <div class="fgrid">${fld('Name', '', { wide: true })}${fld('Description', '', { wide: true })}</div>
      <div><div class="lbl-h inv-l">Where members come from</div><div class="opts"><label class="opt sel"><input type="radio" name="gn-o" checked><b>Only from Mosaikit</b><span>You add them: useful for guests and for groups the identity provider does not know.</span></label><label class="opt"><input type="radio" name="gn-o"><b>From the identity provider of the tenant</b><span>Whoever has the group in their account of the tenant joins by themselves, at every sign-in.</span></label></div></div>
      <div class="field">${ic('search', 15)}<input type="text" placeholder="Add people of the tenant or guests" aria-label="Add people"></div>
      <p class="muted small">After creating it: share items with the group, and give it permissions in the plugins from its page.</p></div>
      <div class="dlg-f"><span class="grow"></span>${btn('Cancel', { act: 'close' })}${btn('Create the group', { kind: 'pri', act: 'okmodal', v: 'Group created: now items can be shared with it.' })}</div>`,
});
DIALOGS.rmperson = (S) => {
  const p = PEOPLE.find((x) => x.ini === (S.resId && S.resId.person)) || PEOPLE[1];
  const res = [
    ['note', 'Weekly team sync', 'Note'],
    ['receipt', 'Estimate 2026-114 · roof repairs', 'Estimate'],
    ['calendar', 'Open day 2026', 'Activity'],
    ['checklist', 'Prepare the budget draft', 'Task'],
  ];
  return {
    wide: true,
    html: `<div class="dlg-h"><h2>Remove ${p.n} from the tenant</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b stack">
      <p>They own ${res.length} items. Before removing them, pick who gets them: whoever uses them goes on using them.</p>
      <label class="lbl">They all go to<select><option>Elena Ricci (Tenant Manager)</option>${PEOPLE.filter(
        (x) => x.ini !== p.ini && x.role !== 'Tenant Manager',
      )
        .map((x) => `<option>${x.n}</option>`)
        .join('')}</select><span class="hint">One can also choose item by item below</span></label>
      <ul class="rows">${res.map((r) => `<li><span class="ri">${ic(r[0], 15)}</span><div class="rt grow"><b>${r[1]}</b><span>${r[2]}</span></div><select class="sm-sel" aria-label="New owner of ${r[1]}"><option>Elena Ricci</option><option>Sara Greco</option></select></li>`).join('')}</ul>
      <ul class="sync"><li><i class="dot warn"></i><div><span>They leave their groups and lose the shares of this tenant</span></div></li><li><i class="dot ok"></i><div><span>${p.home ? `Their account stays, in ${p.home}` : personTenants(p).length > 1 ? 'Their account stays: it is in other tenants too' : 'They are in no other tenant: the account stays without one, and deleting it is better'}</span></div></li></ul></div>
      <div class="dlg-f"><span class="grow"></span>${btn('Cancel', { act: 'close' })}${btn('Remove from the tenant', { kind: 'danger', act: 'okmodal', v: p.n + ' left the tenant: their items went to Elena Ricci.' })}</div>`,
  };
};
DIALOGS.newten = (S) => {
  const st = S.nt || (S.nt = { step: 0, auth: 'local' }),
    steps = ['Tenant', 'Sign-in', 'Tenant Manager', 'Summary'];
  const body = [
    `<div class="fgrid">${fld('Name', 'Example Town', { wide: true })}${fld('Identifier', 'example-town', { mono: true, hint: 'In the address and in the database: it does not change later' })}${fld('Registration number', 'EX-0007', { mono: true })}</div><ul class="rows mt"><li><div class="rt grow"><b>Starts on trial</b><span>30 days, then it is suspended unless confirmed</span></div>${toggle(0)}</li></ul>`,
    `<div class="opts">${[
      ['local', 'Local accounts', 'Username and password kept by Mosaikit; the Tenant Manager creates people and resets passwords'],
      ['oidc', 'External identity provider (OIDC)', 'Keycloak or the provider of the customer; issuer, client and roles are set later, on the page of the tenant'],
    ]
      .map(
        (o) =>
          `<button type="button" class="opt ${st.auth === o[0] ? 'sel' : ''}" data-act="ntset" data-k="auth" data-v="${o[0]}" aria-pressed="${st.auth === o[0]}"><b>${o[1]}</b><span>${o[2]}</span></button>`,
      )
      .join('')}</div>`,
    st.auth === 'oidc'
      ? `<div class="fgrid">${fld('Username of the Tenant Manager', 'e.ricci', { mono: true, hint: 'The account is created at the first sign-in with the identity provider; this username becomes Tenant Manager' })}</div>`
      : `<div class="fgrid">${fld('Username of the Tenant Manager', 'manager', { mono: true })}${fld('Full name', '')}${fld('Initial password', '', { type: 'password', hint: 'At least 10 characters; the Tenant Manager changes it at the first sign-in' })}</div>`,
    `<p>Creating the tenant, the platform prepares by itself:</p><ul class="sync">${['The tenant in the database, with row-level security on every table', 'Its space in the file storage', st.auth === 'oidc' ? 'The sign-in with the identity provider, to complete on the page of the tenant' : 'The local account of the Tenant Manager', 'The first Tenant Manager: there is always at least one'].map((x) => `<li><i class="dot ok"></i><div><span>${x}</span></div></li>`).join('')}</ul>`,
  ][st.step];
  return {
    wide: true,
    html: `<div class="dlg-h"><h2>New tenant</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b stack"><ol class="wiz">${steps.map((x, i) => `<li class="${i < st.step ? 'done' : i === st.step ? 'on' : ''}"><i>${i < st.step ? ic('check', 12) : i + 1}</i><span>${x}</span></li>`).join('')}</ol>${body}</div>
      <div class="dlg-f"><span class="grow"></span>${st.step ? btn('Back', { act: 'ntstep', v: '-1' }) : btn('Cancel', { act: 'close' })}${st.step < steps.length - 1 ? btn('Next', { kind: 'pri', act: 'ntstep', v: '1' }) : btn('Create the tenant', { kind: 'pri', icon: 'plus', act: 'okmodal', v: 'Tenant «Example Town» created with its Tenant Manager.' })}</div>`,
  };
};
DIALOGS.newadmin = () => ({
  html: `<div class="dlg-h"><h2>New administrator of the platform</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b stack">
      <div class="fgrid">${fld('Full name', '')}${fld('Email', '', { type: 'email' })}</div>
      <ul class="sync"><li><i class="dot ok"></i><div><span>An account of the platform: signs in from the Administrator access page, with a local password and the second factor, never through the provider of a tenant</span></div></li><li><i class="dot ok"></i><div><span>Configures the platform: does not work in tenants and does not see their content</span></div></li></ul></div>
      <div class="dlg-f"><span class="grow"></span>${btn('Cancel', { act: 'close' })}${btn('Create and send the invitation', { kind: 'pri', act: 'okmodal', v: 'Administrator created: they get the invitation and set the second factor at the first sign-in.' })}</div>`,
});
DIALOGS.movehome = (S) => {
  const p = PEOPLE.find((x) => x.ini === (S.resId && S.resId.person)) || PEOPLE[3];
  const others = personTenants(p).filter((m) => m[2] !== 'home');
  return {
    html: `<div class="dlg-h"><h2>Move the home tenant of ${p.n}</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b stack">
      <p>Today they belong to <b>${personHome(p)}</b> and sign in with ${viaLabel(p)}. The new home tenant must be one they are already in.</p>
      <div class="opts">${others.map((m, i) => `<label class="opt ${i === 0 ? 'sel' : ''}"><input type="radio" name="mh" ${i === 0 ? 'checked' : ''}><b>${m[0]}</b><span>Today: ${m[1]} · after the move they sign in with the access of ${m[0]}</span></label>`).join('')}</div>
      <ul class="sync">${[
        [
          'warn',
          'The way they sign in changes',
          'from the next day they use the access of the new tenant: with an identity provider (OIDC), they need an account there',
        ],
        [
          'ok',
          'Roles and groups stay',
          'in every tenant, including the one they leave as home, where they become a guest',
        ],
        ['ok', 'Items and shares stay', 'nothing changes owner'],
        ['warn', 'Sessions and tokens', 'close: they must sign in again'],
      ]
        .map(
          (r) =>
            `<li><i class="dot ${r[0]}"></i><div><b>${r[1]}</b><span class="muted small">${r[2]}</span></div></li>`,
        )
        .join('')}</ul>
      <label class="lg-rem"><input type="checkbox" checked> Tell ${p.n.split(' ')[0]} by email, with the instructions for the new sign-in</label></div>
      <div class="dlg-f"><span class="muted small">Only the administrator of the platform can do it, and it stays in the log.</span>${btn('Cancel', { act: 'close' })}${btn('Move', { kind: 'pri', act: 'okmodal', v: 'Home tenant moved. ' + p.n.split(' ')[0] + ' gets the instructions by email.' })}</div>`,
  };
};
DIALOGS.rolesinfo = () => ({
  wide: true,
  html: `<div class="dlg-h"><h2>What each role can do</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b">${rolesInfoHtml()}</div>
      <div class="dlg-f"><span class="muted small">Three fixed roles. For a User, the profile says where the permissions in the plugins start; shares say on which items.</span>${btn('Got it', { kind: 'pri', act: 'close' })}</div>`,
});
DIALOGS.confirm = (S) => {
  const c = CONFIRMS[S.askKey] || CONFIRMS.delacc;
  return {
    html: `<div class="dlg-h"><h2>${c.t}</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b stack"><p>${c.d}</p><ul class="sync">${c.items.map((i) => `<li><i class="dot warn"></i><div><span>${i}</span></div></li>`).join('')}</ul></div>
      <div class="dlg-f"><span class="grow"></span>${btn('Cancel', { act: 'close' })}${btn(c.ok, { kind: 'danger', act: 'confirmok' })}</div>`,
  };
};
/* Actions that cannot be undone ask first, and say what is lost. */
const CONFIRMS = {
  delacc: {
    t: 'Delete the account?',
    d: 'It is removed from Mosaikit and from every tenant it is in. It cannot be undone.',
    items: [
      'Their items go to whoever you choose: that comes first',
      'Sessions close and personal tokens are revoked',
      'The log keeps the name, for the record',
    ],
    ok: 'Delete the account',
    done: 'Account deleted. The items went to Elena Ricci.',
  },
  delgroup: {
    t: 'Delete the group?',
    d: 'People stay in the tenant; they lose what they received through the group.',
    items: [
      'The shares made to the group go away',
      'The permissions the group added in the plugins no longer apply to its members',
    ],
    ok: 'Delete the group',
    done: 'Group deleted. People stayed in the tenant.',
  },
  mpoff: {
    t: 'Disable the plugin?',
    d: 'It turns off in every tenant. It turns on again whenever you want, and nothing is lost.',
    items: [
      'Whoever uses it no longer sees it in the navigation',
      'The items made with the plugin stay, and come back when it is turned on',
    ],
    ok: 'Disable',
    done: 'Plugin disabled in every tenant.',
  },
  mpdel: {
    t: 'Uninstall the plugin?',
    d: 'It is removed from the platform. To get it back, install it again from the catalog.',
    items: [
      'It turns off in every tenant',
      'The settings of the plugin are deleted',
      'The items made with the plugin stay, but do not open until it is installed again',
    ],
    ok: 'Uninstall',
    done: 'Plugin uninstalled.',
  },
  leave: {
    t: 'Leave this tenant?',
    d: 'You leave a tenant you are a guest in. Your account stays, in your home tenant.',
    items: [
      'You lose access to what was shared with you here',
      'The items you created here go to the Tenant Manager of the tenant',
      'To come back you need a new invitation',
    ],
    ok: 'Leave the tenant',
    done: 'You left Green Region.',
  },
  tenarch: {
    t: 'Archive the tenant?',
    d: 'Nobody signs in any more; the data stays and the tenant reopens whenever you want.',
    items: ['Sessions close', 'Public links and embedded pages stop answering'],
    ok: 'Archive',
    done: 'Tenant archived. It reopens from its page.',
  },
  tendel: {
    t: 'Delete the tenant?',
    d: 'Everything is deleted in 30 days: until then it can be undone from the page of the tenant.',
    items: [
      'People, groups and the items of every app of the tenant',
      'Its Keycloak realm, its schema in the database and its space in the file storage',
      'Guests go back to their home tenant only',
    ],
    ok: 'Delete the tenant',
    done: 'The tenant will be deleted on 8 Nov 2026. Until then it can be undone.',
  },
};

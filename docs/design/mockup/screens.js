// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/* eslint-disable -- plain browser scripts of a static mockup: they share globals across files */

/* Mosaikit mockup: the screens of people and of the organization. Every screen is a function of
   the state S that returns HTML; the ones of the platform administrator are in platform.js. */

/* Items shared with the User of the View and edit profile, and the ones they may edit. */
const COLLAB_SEES = ['n1', 'a1'];
const COLLAB_EDITS = ['n1'];

/* ── Sign-in ──────────────────────────────────────────────────────────
   One always signs in with the access of the HOME organization, whatever address one comes from:
   the email says who you are, the account says where you belong, the home organization says how
   you sign in. Then, with several organizations, one picks where to work. */
function loginFind(email) {
  const e = (email || '').trim().toLowerCase();
  if (ACCOUNTS[e]) return Object.assign({ kind: 'known' }, ACCOUNTS[e]);
  const dom = e.split('@')[1];
  if (dom && SSO_DOMAINS[dom]) return { kind: 'newsso', home: SSO_DOMAINS[dom] };
  return { kind: 'unknown' };
}
const LOGIN_EX = [
  ['d.conti@city.example.org', 'SSO, three organizations'],
  ['e.ricci@city.example.org', 'SSO, manager'],
  ['p.fontana@city.example.org', 'SSO, one organization'],
  ['a.verdi@county.example.org', 'SSO or password'],
  ['r.leone@region.example.org', 'password and second factor'],
  ['p.ferri@platform.example.org', 'administrator'],
  ['new@city.example.org', 'first sign-in'],
  ['g.green@freelance.example.org', 'no account'],
];
function loginBrand(S) {
  const plat = S.loginHost === 'sys';
  return {
    plat,
    name: plat ? S.app.sys.name : S.app.tnt.name,
    welcome: plat ? S.app.sys.welcome : S.app.tnt.welcome,
    host: plat ? 'apps.example.org' : 'example-city.apps.example.org',
  };
}
function secLogin(S) {
  setSub(null);
  const L = S.login || { step: 'email' };
  const acc = L.email ? loginFind(L.email) : null;
  // The administrator enters the platform: the brand is the one of Mosaikit, and there is no organization to pick.
  const B =
    acc && acc.admin ? loginBrand(Object.assign({}, S, { loginHost: 'sys' })) : loginBrand(S);
  const stepN = L.step === 'email' ? 1 : L.step === 'pick' ? 3 : 2;
  const many = acc && (acc.tenants || []).length > 1;
  const steps = `<ol class="lg-steps">${(acc && acc.admin ? ['Email', 'Sign-in'] : ['Email', 'Sign-in', 'Workspace']).map((s, n) => `<li class="${n + 1 < stepN ? 'done' : n + 1 === stepN ? 'on' : ''} ${n === 2 && acc && !many ? 'skip' : ''}"><span>${n + 1 < stepN ? ic('check', 12) : n + 1}</span>${s}</li>`).join('')}</ol>`;
  const back = `<button type="button" class="lg-back" data-act="loginback">${ic('back', 14)} Use another email</button>`;
  const who =
    acc && acc.who
      ? `<div class="lg-who">${av(
          acc.who
            .split(' ')
            .map((x) => x[0])
            .join(''),
          2,
          30,
        )}<div><b>${acc.who}</b><span class="muted small">${L.email}</span></div><span class="muted small">${acc.home}</span></div>`
      : `<div class="lg-who">${ic('mail', 16)}<div><b>${L.email || ''}</b></div></div>`;
  const sso = (home) =>
    btn(`Continue with the single sign-on of ${home}`, {
      kind: 'pri',
      icon: 'key',
      act: 'loginok',
    }).replace('class="btn pri', 'class="btn pri lg-sso');
  const pwd =
    () => `<form class="lg-form" data-form="login"><label class="lbl">Password<input type="password" id="lg-pwd" value="${L.err ? '' : '••••••••••'}" autocomplete="current-password" aria-invalid="${!!L.err}"></label>
      ${L.err ? `<p class="lg-err">${ic('alert', 14)} Wrong password. After ${L.err} more attempts the sign-in locks for 15 minutes.</p>` : ''}<div class="lg-row"><label class="lg-rem"><input type="checkbox" checked> Remember me</label>${L.reset ? '' : '<button type="button" class="lg-link" data-act="loginreset">Forgot the password?</button>'}</div>${btn('Sign in', { kind: 'pri' }).replace('type="button"', 'type="submit"')}</form>
      ${L.reset ? `<p class="lg-ok">${ic('mail', 14)} We sent you a link to choose a new password. It is valid for 30 minutes.</p>` : ''}`;
  let body;
  if (L.step === 'email') {
    body = `<h1>Sign in</h1><p class="lg-ente">${B.plat ? 'Administration of the platform' : `Organization: <b>${B.name}</b>`} · <button type="button" class="lnk" data-act="loginhost" data-v="${B.plat ? 'tnt' : 'sys'}">${B.plat ? 'Sign in to an organization' : 'Change organization'}</button></p>
      ${B.plat ? '' : `<div class="lg-idp">${btn('Sign in with a digital identity', { kind: 'pri', icon: 'user', act: 'toast', v: 'In the product the choice of the identity provider opens; on return you are in.' })}${btn('Sign in with an ID card', { icon: 'key', act: 'toast', v: 'In the product the sign-in with the electronic ID card opens.' })}</div><div class="lg-or"><span>or with your email</span></div>`}
      <form class="lg-form" data-form="login" novalidate><label class="lbl">Email<input type="email" id="lg-email" value="${L.email || ''}" autocomplete="username" placeholder="name@organization.example" aria-invalid="${!!L.bad}"></label>
        ${L.bad ? `<p class="lg-err">${ic('alert', 14)} Write a complete email address.</p>` : ''}${btn('Continue', { kind: 'pri' }).replace('type="button"', 'type="submit"')}</form>
      <p class="lg-reg muted small">No account? The manager of your organization creates it, with an invitation.</p>
      <details class="lg-ex"><summary class="muted small">Sample accounts of the mockup</summary><div>${LOGIN_EX.map((x) => `<button type="button" class="chip" data-act="loginex" data-v="${x[0]}" title="${x[0]}">${x[1]}</button>`).join('')}</div></details>`;
  } else if (L.step === 'mfa') {
    body = `${who}<h1>Second step</h1><p class="muted">${acc.home} asks for a second factor: write the 6-digit code of your authenticator app.</p>
      <form class="lg-form" data-form="login"><label class="lbl">Code<input type="text" inputmode="numeric" autocomplete="one-time-code" value="482 913" class="mono lg-code"></label><label class="lg-rem"><input type="checkbox"> Do not ask again for 30 days on this device</label>${btn('Verify', { kind: 'pri' }).replace('type="button"', 'type="submit"')}</form>
      <button type="button" class="lg-link" data-act="toast" data-v="Write one of the recovery codes you saved when you turned the second factor on.">Use a recovery code</button>${back}`;
  } else if (L.step === 'pick') {
    const list = acc.tenants;
    body = `${who}<h1>Where do you want to work?</h1><p class="muted">You belong to ${list.length} organizations. You can switch at any time from the logo at the top, without signing in again.</p>
      <div class="lg-pick">${list
        .map((m) => {
          const tn = TENANT_SEL.find((x) => x.name === m[0]);
          return `<button type="button" data-act="loginpick" data-v="${m[0]}" data-r="${m[1]}">${tn ? crest(tn, 30) : `<span class="ri">${ic('building', 16)}</span>`}<span><b>${m[0]}</b><span class="muted small">${m[1]}${acc.last === m[0] ? ' · the last one you worked in' : ''}</span></span>${m[2] === 'home' ? pill('Home', 'info', 'key') : pill('Guest')}</button>`;
        })
        .join('')}</div>
      <label class="lg-rem"><input type="checkbox" checked> Next time open the last one directly</label>`;
  } else if (acc.kind === 'known' && acc.via === 'both') {
    body = `${who}<h1>How do you want to sign in?</h1><p class="muted"><b>${acc.home}</b>, your home organization, accepts both its single sign-on and a local account.</p>
      ${sso(acc.home)}<div class="lg-or"><span>or with the password</span></div>${pwd()}${back}`;
  } else if (acc.kind === 'known' && acc.via === 'sso') {
    body = `${who}<h1>Sign in with the access of ${acc.home}</h1><p class="muted">Your home organization uses single sign-on: the credentials are asked by the system of the organization, not by Mosaikit. On return you are in.</p>${sso(acc.home)}${back}`;
  } else if (acc.kind === 'known') {
    body = `${who}<h1>Password</h1><p class="muted">You belong to <b>${acc.home}</b>: you sign in with its local account, the same password in every organization you work in.</p>${pwd()}${back}`;
  } else if (acc.kind === 'newsso') {
    body = `${who}<h1>First sign-in</h1><p class="muted">There is no account with this email yet, but the domain belongs to <b>${acc.home}</b>. Signing in with its single sign-on creates the account, and ${acc.home} becomes your home organization.</p>${sso(acc.home)}${back}`;
  } else {
    body = `${who}<h1>No account</h1><p class="muted">There is no account with this email and the domain does not belong to a connected organization. To get in you need an invitation: whoever invites you also chooses how you will sign in.</p>${back}`;
  }
  const tn = TENANT_SEL[0];
  const langs = LANGS.filter((l) => (B.plat ? S.app.sys.langs : S.app.tnt.langs).includes(l[0]));
  return `<div class="lg-page2">
    <section class="lg-hero" aria-label="${B.name}"><div class="lg-art" aria-hidden="true">${mosaicArt(B.plat ? 7 : 3)}</div>
      <div class="lg-hero-in"><div class="lg-hero-b">${B.plat ? brandMark(52) : crest(tn, 52)}<div><b>${B.name}</b><span>${B.plat ? 'Platform' : 'Workspace of the organization'}</span></div></div>
        <div class="lg-claim"><h2>${B.plat ? 'The platform, in one place' : 'Your work, in one place'}</h2><p>${B.welcome}${B.plat ? '' : ': the apps of the organization, for the people who work in it every day'}.</p>
          <ul class="lg-feat">${(B.plat ? ['Organizations, plans and modules', 'Services, security and audit log', 'Accessible according to WCAG 2.1 AA'] : ['The apps of the organization, with the permissions of each person', 'Notifications and activity in one place', 'Accessible according to WCAG 2.1 AA']).map((f) => `<li>${ic('check', 16)}<span>${f}</span></li>`).join('')}</ul></div>
        <p class="lg-ver">Mosaikit 1.0.0</p></div></section>
    <section class="lg-side"><div class="lg-top"><label class="lg-lang"><span class="sr">Language</span><select data-melang>${langs.map((l) => `<option value="${l[0]}" ${S.lang === l[0] ? 'selected' : ''}>${l[1]}</option>`).join('')}</select></label><button type="button" class="ib" data-act="lgmode" aria-label="Mode: ${(MODES.find((m) => m[0] === S.mode) || MODES[0])[1]}" title="Mode: ${(MODES.find((m) => m[0] === S.mode) || MODES[0])[1]}">${ic('contrast', 17)}</button><button type="button" class="lnk" data-act="toast" data-v="Support: ${B.plat ? 'support@platform.example.org' : 'help@city.example.org'}, Monday to Friday 9–17.">Support</button></div>
      <div class="lg-card">${steps}${body}</div>
      <div class="lg-foot"><nav class="lg-legal2"><a>Accessibility statement</a><a>Privacy</a><a>Legal notes</a></nav><span class="mono small muted">${B.host}</span></div>
      <div class="lg-host"><span class="muted small">Mockup · you come from</span>${[
        ['tnt', 'example-city.apps.example.org'],
        ['sys', 'apps.example.org'],
      ]
        .map(
          (h) =>
            `<button type="button" class="chip" aria-pressed="${(S.loginHost || 'tnt') === h[0]}" data-act="loginhost" data-v="${h[0]}">${h[1]}</button>`,
        )
        .join('')}</div></section></div>`;
}

/* ── Overview: the launcher of the apps ───────────────────────────────── */

function secHome(S) {
  setSub(null);
  const R = ROLES[S.role],
    first = R.who.split(' ')[0],
    collab = S.role === 'collab';
  const recent = collab ? ITEMS.filter((i) => COLLAB_SEES.includes(i.id)) : ITEMS.slice(0, 4);
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
  const about = collab ? about0.filter((x) => !['share', 'alert'].includes(x[0])) : about0;
  const due0 = [
    ['bad', 'Prepare the budget draft', 'Tasks · due tomorrow', 'tasks'],
    ['warn', 'Quarterly review with finance', 'Activities · Thursday 10:00', 'activities'],
    ['info', 'Estimate 2026-114 to approve', 'Estimates · waiting for 2 days', 'estimates'],
  ];
  const due = collab ? due0.filter((a) => a[3] === 'activities') : due0;
  const launch = `<section class="launch"><div class="panel-h"><h2>Your apps</h2><span class="muted small">Installed in ${S.app.tnt.name}</span></div>
    <div class="tiles">${APPS.map((a) => `<button type="button" class="tile ${a.tone}" data-act="appopen" data-v="${a.id}">${ic(a.ic, 22)}<b>${a.n}</b><span>${a.d}</span><span class="small">${a.cnt}</span></button>`).join('')}</div></section>`;
  if (S.fresh)
    return `<div class="page">${lhead(S, { compact: true, title: `Welcome, ${first}`, total: S.app.tnt.welcome })}
    ${launch}<div class="empty big">${ic('grid', 34)}<b>Your work will be here</b><span class="muted">You have no notes, activities or tasks yet${collab ? ': when someone shares them with you, they show here' : '. Start from one of the apps above'}.</span>
      <button type="button" class="lnk small" data-act="fresh">Back to the overview of someone who already works here</button></div></div>`;
  return `<div class="page">
    ${lhead(S, { compact: true, title: `Good morning, ${first}`, total: `${S.app.tnt.welcome} · ${R.unit}`, create: collab ? null : { label: 'New', act: 'new' } })}
    ${launch}
    <div class="grid-home">
      <section class="panel span2"><div class="panel-h"><h2>Pick up where you left off</h2><span class="row"><a data-act="fresh" class="small">How a newcomer sees it</a></span></div>
        <ul class="rows">${recent.map((x) => `<li><span class="ri">${ic(APP(x.app).ic, 16)}</span><div class="rt"><b>${x.t}</b><span>${APP(x.app).n} · ${x.d}</span></div>${collab ? '' : btn('', { icon: 'share', act: 'share', v: x.id, al: 'Share ' + x.t })}${btn('Open', { act: 'appopen', v: x.app })}</li>`).join('')}</ul></section>
      <section class="panel"><div class="panel-h"><h2>Due soon</h2><span class="num muted">${due.length}</span></div>
        <ul class="alerts">${due.map((a) => `<li class="sev-${a[0]}"><div><b>${a[1]}</b><span>${a[2]}</span></div>${btn('Open', { act: 'appopen', v: a[3] })}</li>`).join('')}</ul></section>
      <section class="panel span2"><div class="panel-h"><h2>For you</h2><a data-go="inbox">All notifications</a></div>
        <ul class="rows">${about.map((x) => `<li><span class="ri">${ic(x[0], 16)}</span><div class="rt"><span class="rich">${x[1]}</span><span>${x[2]}</span></div>${btn('See', { go: 'inbox' })}</li>`).join('')}</ul></section>
      ${
        collab
          ? `<section class="panel"><div class="panel-h"><h2>You can edit</h2></div>
        <ul class="rows"><li><span class="ri">${ic('note', 16)}</span><div class="rt"><b>Site visit, north depot</b><span>Shared for editing by Elena Ricci</span></div>${btn('Open', { act: 'appopen', v: 'notes' })}</li></ul>
        <p class="small muted">You work on what others share with you: you do not create items of your own, and where you may write you can edit.</p></section>`
          : `<section class="panel"><div class="panel-h"><h2>Storage of the organization</h2></div>
        ${qMeter(S, 'space', 'Storage')}
        <p class="small muted">Attachments and documents of every app count here. Whoever owns an item decides who sees it; the platform enforces it.</p></section>`
      }
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
      actions: `<button type="button" class="btn" data-act="toast" data-v="All marked as read.">${ic('check', 15)}<span>Mark all as read</span></button>${S.role === 'admin' ? '' : `<button type="button" class="btn" data-go="profile">${ic('cog', 15)}<span>What I receive</span></button>`}`,
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
function secProfile(S) {
  setSub(null);
  const R = ROLES[S.role],
    mine = MY_TENANTS[S.role],
    adm = S.role === 'admin';
  return detailPage(S, {
    title: R.who,
    sub: `${R.mail} · ${R.long}`,
    actions: btn('Sign out', { icon: 'back', act: 'logout' }),
    body: `
    <section class="panel">${avatarEdit(S, R.ini, { admin: 5, manager: 2, user: 3, collab: 2 }[S.role], true)}</section>
    ${
      mine
        ? `<section class="panel mt"><div class="panel-h"><div><h2>Your organizations</h2><p class="muted small">You always sign in with the access of your home organization; in the others you work with the same identity.</p></div></div>
      <div class="tbl-w"><table class="tbl"><thead><tr><th>Organization</th><th>Link</th><th>Role</th><th></th></tr></thead><tbody>${mine
        .map((m) => {
          const tn = TENANT_SEL.find((x) => x.id === m[0]);
          return `<tr><td><b>${tn.name}</b></td><td>${m[2] === 'home' ? pill('Home', 'info', 'key') : pill('Guest')}</td><td>${pill(m[1])}</td><td class="r">${m[2] === 'home' ? '<span class="muted small">Only the administrator changes it</span>' : btn('Leave', { act: 'ask', v: 'leave' })}</td></tr>`;
        })
        .join('')}</tbody></table></div></section>`
        : ''
    }
    <div class="two mt"><section class="panel"><h2>How you sign in</h2><dl class="kv"><dt>Sign-in</dt><dd>${adm ? 'Keycloak account with a second factor' : 'SSO · Keycloak, realm example-city'}</dd>${adm ? '<dt>If Keycloak does not answer</dt><dd>The emergency access, in System › Security</dd>' : `<dt>Organizations</dt><dd>${mine.map((m) => TENANT_SEL.find((x) => x.id === m[0]).name + (m[2] === 'home' ? '' : ' (guest)')).join(' · ')}</dd><dt>Groups</dt><dd>${S.role === 'user' ? 'Planning' : S.role === 'collab' ? 'Field team' : 'Operations office'}</dd>`}</dl></section>
    ${adm ? '' : `<section class="panel"><h2>Personal access tokens</h2><ul class="rows"><li><span class="ri">${ic('key', 15)}</span><div class="rt"><b>Token for scripts and desktop tools</b><span>${S.pat ? '<span class="mono">mk_pat_4f9c…a12e</span> · created now: copy it, you will not see it again' : 'Calls the API of the platform with your permissions, and nothing more'}</span></div>${S.pat ? btn('Revoke', { act: 'pat' }) : btn('Create token', { act: 'pat' })}</li></ul></section>`}
    <section class="panel"><h2>Email notifications</h2><div class="fgrid one"><label class="lbl">What I receive<select><option>Everything</option><option selected>Only mentions and due dates</option><option>Nothing</option></select></label></div></section>
    <section class="panel"><h2>Appearance and keys</h2><p class="muted small">Mode, contrast, language and sidebar change from the Appearance menu at the top${adm ? '' : '; everything, with your keys of outside services, in Settings'}.</p>${adm ? '' : btn('Open Settings', { icon: 'cog', go: 'config' })}</section>
    <p class="muted small span2 legal-f">${adm ? S.app.sys.name : S.app.tnt.name} · <a>Privacy</a> · <a>Legal notes</a></p></div>`,
  });
}
function secTrash(S) {
  setSub(null);
  const items = (
    S.role === 'collab'
      ? []
      : [
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
   Quotas come from the plan of the organization (PLANS), use from here. Sidebar, overview, usage
   and the organization page all read these two functions: when the plan changes, they change together. */
function tenUsage(S, x) {
  x = x || TENANTS[0];
  const f = x.users / 128,
    q = PLANS[tenPlan(S, x)].q;
  return {
    space: x.data,
    people: x.users,
    auto: Math.round(312 * f),
    collab: Math.min(3, Math.ceil(3 * f)),
    ai: q.ai ? Math.round(41 * f) : 0,
  };
}
function tenQuota(S, x) {
  return PLANS[tenPlan(S, x || TENANTS[0])].q;
}
function tenSt(S, x) {
  return (S.tenSt && S.tenSt[x.slug]) || x.st;
}
function tenPlan(S, x) {
  return (S.tenPlan && S.tenPlan[x.slug]) || x.plan;
}
function qPct(u, lim) {
  if (lim == null || lim === 0) return '';
  const p = Math.round((u / lim) * 100);
  return ` · ${p}%${p > 100 ? ' · over the limit' : ''}`;
}
function qText(k, u, lim) {
  const unit = (PLAN_Q.find((q) => q[0] === k) || [])[2] || '';
  if (lim === 0) return 'not included in the plan';
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
/* The indicator at the foot of the sidebar: the manager sees the quota nearest to the limit (a click
   opens Usage); a user what is left; the administrator how many organizations are near a limit. */
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
function qRing(p, tone, center, label, tip, go) {
  const r = 14,
    c = 2 * Math.PI * r,
    pp = Math.min(100, p);
  return `<${go ? 'button type="button"' : 'div'} class="side-ring q-${tone}" ${go ? `data-go="${go}"` : 'role="img" tabindex="0"'} aria-label="${tip}" data-stip="${tip}"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="${r}" class="rg-b"/><circle cx="18" cy="18" r="${r}" class="rg-v" stroke-dasharray="${((c * pp) / 100).toFixed(1)} ${c.toFixed(1)}"/></svg><span class="num">${center}</span><em>${label}</em></${go ? 'button' : 'div'}>`;
}
function quotaWidget(S) {
  if (S.role === 'admin') {
    const hot = TENANTS.map((x) => [x, tenWorst(S, x)[0]]).filter((z) => z[1][1] >= 80);
    const tone = hot.some((z) => z[1][1] >= 100) ? 'bad' : hot.length ? 'warn' : 'ok';
    const tip = hot.length
      ? `Organizations near a limit: ${hot.map((z) => `${z[0].n} (${Q_SHORT[z[1][0]]} ${z[1][1] > 900 ? 'used up' : z[1][1] + '%'})`).join(', ')}`
      : 'No organization near a limit';
    return `<button type="button" class="qw" data-go="tenants"><span class="qw-h"><b>${hot.length ? `${hot.length} near the limit` : 'Organizations within limits'}</b><i class="dot ${tone}"></i></span>
      <span class="small muted">${
        hot.length
          ? hot
              .slice(0, 2)
              .map((z) => `${z[0].n} · ${Q_SHORT[z[1][0]]}`)
              .join('<br>')
          : 'Every quota under 80%'
      }</span></button>${qRing((hot.length / TENANTS.length) * 100, tone, hot.length, 'at limit', tip, 'tenants')}`;
  }
  const mgr = S.role === 'manager';
  const list = tenWorst(S, TENANTS[0], mgr ? null : ['space', 'auto', 'ai']),
    w = list[0],
    tone = qTone(w[1]);
  const left = (k) => {
    const z = list.find((y) => y[0] === k);
    if (!z) return '';
    const rest = Math.max(0, z[3] - z[2]);
    return k === 'space'
      ? `${fmtN(rest)} GB free`
      : k === 'ai'
        ? `${fmtN(rest)} AI credits`
        : `${fmtN(rest)} automation minutes`;
  };
  if (mgr) {
    const tip = `The quota nearest to the limit: ${Q_SHORT[w[0]]}, ${qText(w[0], w[2], w[3])} (${w[1]}%). Then ${list
      .slice(1, 3)
      .map((z) => `${Q_SHORT[z[0]]} ${z[1]}%`)
      .join(', ')}`;
    return `<button type="button" class="qw" data-go="usage"><span class="qw-h"><b>${Q_SHORT[w[0]]}</b><span class="num ${tone === 'ok' ? '' : tone + '-t'}">${w[1]}%</span></span>
      <span class="meter-b q-${tone}"><i style="width:${Math.min(100, w[1])}%"></i></span><span class="small muted">${qText(w[0], w[2], w[3])} · ${w[1] >= 100 ? 'over the limit' : 'the nearest to the limit'}</span></button>${qRing(w[1], tone, w[1] + '%', Q_SHORT[w[0]] + ' used', tip, 'usage')}`;
  }
  const tip = `Left in the organization: ${['space', 'auto', 'ai'].map(left).filter(Boolean).join(', ')}`;
  return `<div class="qw" tabindex="0"><span class="qw-h"><b>Left in the organization</b>${tone === 'ok' ? '' : `<i class="dot ${tone}"></i>`}</span>
    <span class="small qw-l">${['space', 'auto', 'ai'].map((k) => `<span class="${list.find((z) => z[0] === k && z[1] >= 80) ? 'warn-t' : ''}">${left(k)}</span>`).join('')}</span></div>${qRing(w[1], tone, w[1] + '%', Q_SHORT[w[0]] + ' used', tip, null)}`;
}

/* ── Organization overview (manager) ──────────────────────────────────
   Decisions first (access requests, invitations, integrations down), counts after. */
function secSpace(S) {
  setSub(null);
  const tn = TENANT_SEL[0];
  const recent = LOG.filter((e) => e.ten === 'Example City').slice(0, 3);
  return detailPage(S, {
    title: 'Overview of the organization',
    actions:
      `<button type="button" class="btn" aria-label="Customize the overview" title="Customize the overview">${ic('more', 15)}</button>` +
      btn('Invite people', { kind: 'pri', icon: 'plus', act: 'invite' }),
    sub: `${tn.name} · 128 people · ${tenPlan(S, TENANTS[0])} plan`,
    body: `
    ${kpis([
      ['People', '128', '6 invitations pending'],
      ['Groups', '5', 'from the SSO of the organization', 'ok'],
      ['Apps', '4', '3 extensions on'],
      [
        'Storage',
        fmtN(tenUsage(S).space) + ' GB',
        'of ' + fmtN(tenQuota(S).space) + ' GB · ' + tenPlan(S, TENANTS[0]) + ' plan',
      ],
    ])}
    <div class="grid-home"><section class="panel span2"><div class="panel-h"><h2>Waiting for you</h2></div><ul class="rows">
      <li><span class="ri">${ic('lock', 15)}</span><div class="rt"><b>2 access requests</b><span>Site visit, north depot (Front office) · Estimate 2026-114 (Field team)</span></div>${btn('Decide', { act: 'memreq' })}</li>
      <li><span class="ri">${ic('users', 15)}</span><div class="rt"><b>6 invitations not accepted yet</b><span>The oldest is 9 days old</span></div>${btn('See', { act: 'meminv' })}</li>
      <li><span class="ri">${ic('alert', 15)}</span><div class="rt"><b>1 integration does not answer</b><span>Mail relay of the organization · for 14 minutes</span></div>${btn('Open', { act: 'toast', v: 'The integrations of the organization are set by the administrator of the platform, on the page of the organization.' })}</li>
      <li><span class="ri">${ic('globe', 15)}</span><div class="rt"><b>1 item shared publicly this week</b><span>Open day 2026 · by Davide Conti</span></div>${btn('Review', { act: 'toast', v: 'Public sharing is decided by the owner; a manager can take it back from the item.' })}</li></ul></section>
    <section class="panel"><div class="panel-h"><h2>Integrations</h2></div><ul class="health">${[
      ['Keycloak', 'ok', 'realm example-city'],
      ['Collaboration relay', 'ok', '3 sessions open'],
      ['Automation worker', 'warn', '1 job queued for 6 min'],
      ['Mail relay', 'bad', 'does not answer'],
    ]
      .map(
        (h) =>
          `<li><i class="dot ${h[1]}"></i><b>${h[0]}</b><span class="muted small">${h[2]}</span></li>`,
      )
      .join('')}</ul></section>
    <section class="panel span2"><div class="panel-h"><h2>Recent activity</h2><a data-go="activity">Activity log</a></div><ul class="rows">${recent.map((e) => `<li><span class="ri">${ic(e.ok ? 'history' : 'alert', 15)}</span><div class="rt"><b>${e.act}</b><span>${e.who} · ${e.target} · ${logDate(e)} ${e.t}</span></div></li>`).join('')}</ul></section>
    <section class="panel"><div class="panel-h"><h2>Usage this month</h2><a data-go="usage">Details</a></div>${qMeter(S, 'space', 'Storage')}${qMeter(S, 'auto', 'Automation')}${qMeter(S, 'ai', 'AI credits')}</section></div>`,
  });
}

/* ── People of the organization (manager) ────────────────────────────── */

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
  if (p.via === 'SSO') return 'SSO · realm example-city';
  if (p.via === 'Local')
    return p.home ? `Local account of ${p.home} · Keycloak` : 'Local account · Keycloak';
  return '—';
}
function secMembers(S) {
  const t = tabOf(S, 'mem', 'users');
  setSub({ users: 'people', groups: 'groups', inv: 'invitations', req: 'requests' }[t]);
  let body;
  if (t === 'groups') {
    body = `<div class="tbl-w"><table class="tbl"><thead><tr><th class="cbx"><span class="sr">Select</span></th><th>Group</th><th class="r">People</th><th class="r">Shared items</th><th>Comes from</th><th></th></tr></thead><tbody>
    ${GROUPS.map((g, i) => `<tr class="clk ${selOf(S, 'mem-groups').includes(String(i)) ? 'picked' : ''}" data-res="group:${i}" data-go="group">${selTd(S, 'mem-groups', i, g.n)}<td><div class="cell-t"><span class="ri">${ic('users', 15)}</span><div><b>${g.n}</b><span class="muted small">${g.d}</span></div></div></td><td class="r num">${g.m}</td><td class="r num">${g.res}</td><td>${g.kc ? pill('Identity provider', 'info', 'key') : pill('Mosaikit')}</td><td>${btn('', { icon: 'more' })}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted small mt">With single sign-on the groups arrive in the <span class="mono">groups</span> claim at every sign-in; for local accounts the manager assigns them.</p>`;
  } else if (t === 'req') {
    const reqs = [
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
    body = `<p class="muted small">Who asks, for what, and why. Approving creates the share; the owner gets a notification. If you prefer that the owner decides, forward the request.</p>
      <ul class="rows panel mt">${reqs
        .map((r) => {
          const done = S.reqDone && S.reqDone[r[0]];
          return `<li><span>${av(r[2], 5, 30)}</span><div class="rt grow"><b>${r[1]} · ${r[3]}</b><span>${r[5]} on <b>${r[4]}</b> · «${r[6]}» · owner ${r[7]}</span></div>${done ? pill(done === 'ok' ? 'Approved' : done === 'fw' ? 'Forwarded' : 'Refused', done === 'ok' ? 'ok' : done === 'fw' ? 'info' : 'bad') : `<div class="row">${btn('Refuse', { act: 'req', v: 'no:' + r[0] })}${btn('Forward to the owner', { act: 'req', v: 'fw:' + r[0] })}${btn('Approve', { kind: 'pri', act: 'req', v: 'ok:' + r[0] })}</div>`}</li>`;
        })
        .join('')}</ul>`;
  } else if (t === 'inv') {
    body = `<ul class="rows panel">${INVITES.map((x, i) => `<li class="${selOf(S, 'mem-inv').includes(String(i)) ? 'picked' : ''}">${selBox(S, 'mem-inv', i, x.split(' · ')[0])}<span class="ri">${ic('user', 15)}</span><div class="rt"><b>${x.split(' · ')[0]}</b><span>${x.split(' · ').slice(1).join(' · ')}</span></div>${btn('Send again', { act: 'toast', v: 'Invitation sent again: it expires in 14 days.' })}${btn('', { icon: 'trash', act: 'toast', v: 'Invitation cancelled.', al: 'Cancel the invitation' })}</li>`).join('')}</ul>`;
  } else {
    body = `<div class="tbl-w"><table class="tbl"><thead><tr><th class="cbx"><span class="sr">Select</span></th><th>Name</th><th>Role and profile</th><th>Groups</th><th>Status</th><th>Signs in with</th><th>Last sign-in</th><th></th></tr></thead><tbody>
    ${PEOPLE.map((p) => `<tr class="clk ${selOf(S, 'mem-users').includes(p.ini) ? 'picked' : ''}" data-res="person:${p.ini}" data-go="person">${selTd(S, 'mem-users', p.ini, p.n)}<td><div class="cell-t">${av(p.ini, p.c, 28)}<div><b>${p.n}${p.home ? ' ' + pill('Guest · ' + p.home, 'info') : ''}</b><span class="muted small">${p.mail}</span></div></div></td><td>${p.role === 'Manager' ? pill('Manager', 'info') : `<div class="rp">${pill('User')}<span class="muted small">${PROF(p.prof).n}</span></div>`}</td><td class="small">${p.groups.join(', ')}</td><td>${pill(p.st, p.st === 'Active' ? 'ok' : p.st === 'Suspended' ? 'bad' : 'warn')}</td><td class="small">${viaLabel(p)}</td><td class="num muted">${p.last}</td><td>${btn('', { icon: 'more' })}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted small mt">Every account is in Keycloak, local ones too. The platform trusts it, and every app checks the permissions of each person on every request.</p>`;
  }
  const groups =
    t === 'req'
      ? [
          [
            'Item',
            [
              ['Site visit, north depot', 1],
              ['Estimate 2026-114', 1],
            ],
          ],
        ]
      : t === 'groups'
        ? [
            [
              'Comes from',
              [
                ['Identity provider', 4],
                ['Mosaikit', 1],
              ],
            ],
          ]
        : t === 'inv'
          ? [
              [
                'Profile',
                [
                  ['Standard', 2],
                  ['View and edit', 2],
                  ['Field worker', 1],
                  ['Manager', 1],
                ],
              ],
              [
                'Sent',
                [
                  ['This week', 2],
                  ['More than 7 days ago', 4],
                ],
              ],
            ]
          : [
              [
                'Role',
                [
                  ['Manager', 2],
                  ['User', 126],
                ],
              ],
              ['Profile', PROFILES.map((pr) => [pr.n, pr.cnt])],
              ['Group', GROUPS.map((g) => [g.n, g.m])],
              [
                'Status',
                [
                  ['Active', 119],
                  ['Invited', 6],
                  ['Suspended', 3],
                ],
              ],
              [
                'Signs in with',
                [
                  ['SSO', 104],
                  ['Local account', 24],
                ],
              ],
              [
                'Belongs',
                [
                  ['To this organization', 127],
                  ['Guests', 1],
                ],
              ],
            ];
  return resPage(
    S,
    {
      title: 'People',
      total:
        t === 'groups'
          ? '5 groups'
          : t === 'inv'
            ? '6 invitations pending'
            : t === 'req'
              ? '2 requests to decide'
              : '128 people · 6 invitations pending',
      actions:
        t === 'users'
          ? `<button type="button" class="btn" data-act="toast" data-v="In the product you pick a CSV file with email, profile and groups: every row becomes an invitation.">${ic('upload', 15)}<span>Import from CSV</span></button>`
          : '',
      create:
        t === 'groups'
          ? { label: 'New group', act: 'groupnew' }
          : t === 'req'
            ? null
            : { label: 'Invite people', act: 'invite' },
      bulk:
        t === 'groups'
          ? { key: 'mem-groups', ids: GROUPS.map((g, i) => i), acts: [['trash', 'Delete', 1]] }
          : t === 'inv'
            ? {
                key: 'mem-inv',
                ids: INVITES.map((x, i) => i),
                acts: [
                  ['mail', 'Send again'],
                  ['trash', 'Delete', 1],
                ],
              }
            : t === 'req'
              ? null
              : {
                  key: 'mem-users',
                  ids: PEOPLE.map((p) => p.ini),
                  acts: [
                    ['key', 'Change role'],
                    ['user', 'Change profile'],
                    ['users', 'Add to a group'],
                    ['lock', 'Suspend'],
                    ['x', 'Remove from the organization', 1],
                    ['trash', 'Delete the account', 1],
                  ],
                },
    },
    filterCol(S, 'mem', groups, {
      search: t === 'groups' ? 'Search a group' : 'Search by name or email',
      sort: SORT_NAME,
      scopeKey: 'mem',
      scope: [
        ['People', 128, 'users'],
        ['Groups', 5, 'groups'],
        ['Invitations', 6, 'inv'],
        ['Access requests', 2, 'req'],
      ],
    }),
    body,
  );
}
/* The permissions in the modules, one row per module: the ones held, with where each comes from.
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
   reaches; for a User, profile, groups and exceptions say what they do in the modules, and shares
   say on which items. */
function rolesInfoHtml() {
  const roles = [
    ['Administrator', 'Platform'],
    ['Manager', 'Organization'],
    ['User', 'Organization'],
  ];
  const Y = 1,
    N = 0,
    P = 2;
  const rows = [
    [
      'How far it reaches',
      [
        'Configuration of the platform',
        'Their items and the management of the organization',
        'What profile and groups give them, on the items they see',
      ],
      'txt',
    ],
    ['Use the apps', [N, Y, P], '', 'Only the modules on in the organization'],
    ['Create items of their own', [N, Y, P]],
    ['Edit their own items', [N, Y, Y]],
    ['Edit items shared for editing', [N, Y, Y]],
    ['See items shared for viewing', [N, Y, Y]],
    ['Share for viewing or editing', [N, Y, Y], '', 'The owner of an item'],
    ['Outside links and public sharing', [N, Y, Y], '', 'Decided by the owner of the item'],
    ['Manage people, groups, profiles and invitations', [N, Y, N]],
    ['Turn modules on and give permissions', [N, Y, N]],
    ['Appearance, keys and usage of the organization', [N, Y, N]],
    ['Organizations, all people, extensions and system', [Y, N, N]],
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
    <section class="panel mt"><h2>What a User does: the profile</h2><p class="small">Every User has a <b>profile</b>, where their permissions in the modules start. <b>Groups</b> add permissions, and the manager can give <b>exceptions</b> to a single person. The profiles of the organization are in Settings › Profiles.</p>
      <ul class="rows">${PROFILES.map((pr) => `<li><span class="ri">${ic('user', 15)}</span><div class="rt grow"><b>${pr.n}${pr.def ? ' <span class="muted small">· for new invitations</span>' : ''}</b><span>${pr.d}</span></div><span class="num muted small">${pr.cnt} people</span></li>`).join('')}</ul></section>`;
}

/* ── Modules of the organization (manager) ───────────────────────────── */

/* The row of a module: the same for the administrator (organization page) and for the manager
   (Modules), who also gets «Access and permissions». */
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
          )}</span><button type="button" class="btn sm" data-act="modacc" data-v="${f.k}" ${on[f.k] ? '' : 'disabled'}>${ic('key', 14)}<span>Access and permissions</span></button></div>`
      : '';
  return `<li class="${ok ? '' : 'off'} ${on[f.k] ? 'is-on' : ''}"><span class="ri">${ic(f.ic, 16)}</span><div class="rt"><b>${f.n}</b><span>${f.d}</span><span class="muted small">${f.how}</span>
    ${req.length ? `<span class="needs">${ic('link', 12)} Requires ${req.join(', ')}</span>` : ''}${soft}${ok ? '' : `<span class="small">${pill('Not included in the ' + o.plan + ' plan', 'warn', 'lock')}</span>`}${acc}${conf}</div>
    <button type="button" class="tgl" role="switch" data-act="tenfeat" data-v="${f.k}" ${scope ? `data-scope="${scope}"` : ''} aria-label="${f.n}" aria-checked="${ok && !!on[f.k]}" ${ok ? '' : 'disabled'}><i></i></button></li>`;
}
function tenFeats(S, x) {
  const base = {
    notes: true,
    tasks: true,
    activities: true,
    estimates: true,
    collab: true,
    auto: x.plan !== 'Free',
    files: true,
    ai: x.plan === 'Enterprise',
  };
  MP.filter((m) => !m.sys).forEach((m) => {
    base['ext:' + m.id] = (m.tenants || []).includes(x.slug);
  });
  return Object.assign(base, S.tenFeat && S.tenFeat[x.slug]);
}
/* The manager turns on and off only among the modules the administrator enabled. */
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
  const mine = (f) => MGR_FEATS.includes(f.k) || f.g === 'ext';
  const list = FEATS.filter((f) => mine(f) && adm[f.k]);
  const n = list.filter((f) => on[f.k]).length;
  return resPage(
    S,
    {
      title: 'Modules',
      total: `${list.length} available · ${n} on`,
      create: {
        label: 'Ask for a module',
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
          [
            ['Apps', list.filter((f) => f.g === 'app').length],
            ['Services', list.filter((f) => f.g === 'int').length],
            ['Extensions', list.filter((f) => f.g === 'ext').length],
          ],
        ],
        [
          'State',
          [
            ['On', n],
            ['Off', list.length - n],
          ],
        ],
      ],
      { search: 'Search a module', sort: SORT_NAME },
    ),
    `${S.featNote && S.route === 'splugins' ? `<div class="banner info fnote">${ic('check', 18)}<div>${S.featNote}</div></div>` : ''}
    <ul class="ints">${list.map((f) => featRow(S, f, on, { scope: 'mgr', access: true })).join('')}</ul>`,
  );
}
/* Access and permissions of a module: the whole organization, groups, people. Profiles give the
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
    back: ['splugins', 'Back to Modules'],
    title: `Access and permissions · ${f.n}`,
    sub: `${nProf ? nProf + (nProf === 1 ? ' profile' : ' profiles') : 'no profile'} · ${g.length - nProf} groups and people`,
    actions:
      btn('Cancel', { icon: 'undo', go: 'splugins' }) + btn('Save', { kind: 'pri', icon: 'save' }),
    body: `<div class="banner info">${ic('key', 18)}<div>The columns are the <b>permissions ${f.n} declares</b> in its manifest${pl ? ` (<span class="mono">${pl.id} ${pl.ver}</span>)` : ''}. Every User starts from their <b>profile</b>; groups and people <b>add</b>. A new permission that arrives with an update starts off, and we tell you.</div></div>
    ${nProf ? '' : `<div class="banner warn mt">${ic('lock', 18)}<div><b>It is in no profile.</b> Only whoever is in the list sees it, by group or by name.</div></div>`}
    <section class="panel mt"><div class="panel-h"><h2>Who has access, and with which permissions</h2><a data-act="proftab">Edit the profiles</a></div>
      <div class="field">${ic('search', 15)}<input type="text" placeholder="Add a group or a person" aria-label="Add"></div>
      <div class="tbl-w mt"><table class="tbl perm macc"><thead><tr><th>Who</th>${perms.map((p) => `<th class="c">${p}</th>`).join('')}<th></th></tr></thead><tbody>
      ${g.map((s) => `<tr class="${s[4] === 'prof' ? 'prow' : ''}"><td><div class="cell-t"><span class="ri">${ic(s[4] === 'prof' ? 'user' : s[0], 15)}</span><div><b>${s[1]}</b><span class="muted small">${s[2]}${s[4] === 'prof' ? ' · changes in Settings › Profiles' : ''}</span></div></div></td>${s[3].map((v, i) => `<td class="c"><input type="checkbox" class="pchk" ${v ? 'checked' : ''} ${s[4] === 'prof' ? 'disabled' : ''} aria-label="${perms[i]} for ${s[1]}"></td>`).join('')}<td class="r">${s[4] === 'prof' ? '' : `<button type="button" class="btn" aria-label="Remove ${s[1]}" title="Remove">${ic('x', 15)}</button>`}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="panel mt"><h2>What each permission means</h2><dl class="kv">${perms.map((p) => `<dt>${p}</dt><dd>${PERM_DESC[p] || 'From the manifest of the module'}</dd>`).join('')}</dl></section>
    <p class="muted small mt">Changes apply from the next sign-in of each person and stay in the activity log. The backend checks the permissions on every request: hiding a button is not enough.</p>`,
  });
}

/* ── Usage (manager) ──────────────────────────────────────────────────
   The plan is chosen by the administrator of the platform: here the manager sees the quotas, how
   they are used, who uses the most, and decides whom to warn near a limit. */
function secUsage(S) {
  const tn = TENANTS[0],
    plan = tenPlan(S, tn),
    Q = PLANS[plan].q;
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
      `<section class="panel"><div class="panel-h"><div><h2>Quotas of the ${plan} plan</h2><p class="muted small">They reset on the first of every month, except storage and people.</p></div></div><ul class="quota">${PLAN_Q.map(row).join('')}</ul></section>`,
      'quotas',
    ],
    [
      'Trend',
      'activity',
      `<div class="stack-s">${trend('Automation minutes', [410, 520, 480, 690, 880, used.auto], 'a month · limit ' + fmtN(Q.auto), autoNote)}${trend('Storage', [5.1, 5.6, 6.0, 6.5, 7.1, used.space], 'GB at the end of the month · limit ' + fmtN(Q.space), spaceNote)}${trend('AI credits', [12, 25, 30, 44, 76, used.ai], 'a month · limit ' + fmtN(Q.ai), null)}</div>`,
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
      <section class="panel mt"><h2>Who gets them</h2><div class="gchips">${['The managers of the organization', 'Elena Ricci', 'Operations office'].map((g) => `<span class="gchip">${ic(g.startsWith('The ') ? 'key' : g === 'Operations office' ? 'users' : 'user', 13)}${g}<button type="button" aria-label="Remove ${g}">${ic('x', 12)}</button></span>`).join('')}<button type="button" class="gchip add">${ic('plus', 13)}Add</button></div>
        <div class="fgrid mt"><label class="lbl">How<select><option>Notification and email</option><option>Only notification</option><option>Only email</option></select></label></div></section>`,
      'alerts',
    ],
    [
      'Features of the plan',
      'check',
      `<section class="panel"><div class="panel-h"><div><h2>What ${plan} includes</h2><p class="muted small">To change the plan, write to the administrator of the platform.</p></div></div><ul class="feats">${PLAN_F.map(
        (f) => {
          const on = f[1].includes(plan);
          return `<li class="${on ? 'on' : ''}">${on ? ic('check', 15) : ic('x', 15)}<span>${f[0]}</span>${on ? '' : `<span class="muted small">from ${f[1][0]}</span>`}</li>`;
        },
      ).join('')}</ul></section>`,
      'plan',
    ],
  ];
  const nav = secNav(S, 'use', parts);
  return detailPage(S, {
    title: 'Usage',
    sub: `${plan} plan · renews on 1 Jan 2027 · managed by the administrator of the platform`,
    body: nav.body,
    side: nav.side,
    sideNav: true,
  });
}

/* ── Person page ──────────────────────────────────────────────────────
   Opens from People (manager) and from All people (administrator) and goes back where it came
   from. Profile, sign-in, effective permissions, activity; the administrator also sees the organizations. */
const P_ST = {
  Active: { tone: 'ok', d: 'Signs in and works as usual.' },
  Suspended: {
    tone: 'bad',
    d: 'Cannot sign in: sessions closed and tokens revoked. Their items stay, and whoever saw them still does.',
  },
  Invited: { tone: 'warn', d: 'Has not accepted the invitation yet.' },
};
const ROLE_LIST = ['Manager', 'User'];
/* The profile image: PNG, JPG or WebP up to 2 MB, cropped to a circle. */
function avatarEdit(S, ini, c, self) {
  const has = !!AV_IMG[ini];
  return `<div class="avedit"><span class="avedit-p">${av(ini, c, 72)}</span><div class="avedit-t"><b>Profile image</b>
    <span class="muted small">PNG, JPG or WebP, up to 2 MB. It shows as a circle, so a face in the centre works best.</span>
    ${S.avErr && S.avErr.ini === ini ? `<span class="small bad">${S.avErr.msg}</span>` : ''}
    <div class="row"><label class="btn"><input type="file" class="sr" accept="image/png,image/jpeg,image/webp" data-avatar="${ini}">${ic('upload', 15)}<span>${has ? 'Change image' : 'Upload image'}</span></label>${has ? btn('Remove', { act: 'avrm', v: ini }) : ''}</div>
    ${self ? '' : '<span class="muted small">Usually the person sets it from their profile; whoever manages the organization can change it here.</span>'}</div></div>`;
}
/* New person (administrator). The home organization is required, because it decides how the person
   will sign in; other organizations can be added now or later. */
function secNewUser(S) {
  setSub('new');
  const N = S.newUser || {};
  const home = TENANTS.find((x) => x.n === N.home);
  const ok = !!(home && N.first && N.last && N.email && /@/.test(N.email));
  const v = (k) => (N[k] || '').replace(/"/g, '&quot;');
  let how = `<p class="muted small">Pick the organization: how the person will sign in depends on it.</p>`;
  if (home) {
    const dom = (N.email || '').split('@')[1] || '',
      ssoDom = TEN_EXTRA[home.slug].mail;
    how = /^SSO/.test(home.auth)
      ? `<div class="banner info">${ic('key', 18)}<div><b>They will sign in with the single sign-on of ${home.n}</b>. The platform creates the account in the realm <span class="mono">${home.slug}</span> and sends the email to activate it.${dom && dom !== ssoDom ? `<br><b>Note:</b> the email is not of the domain of the organization (<span class="mono">${ssoDom}</span>): its identity provider may not recognize it.` : ''}</div></div>`
      : `<div class="banner info">${ic('mail', 18)}<div><b>They will sign in with a local account of ${home.n}</b>, in the Keycloak realm <span class="mono">${home.slug}</span>. They get a link to choose the password; the second factor follows the rules of ${home.n}.</div></div>`;
  }
  const assoc = N.assoc || [];
  return detailPage(S, {
    back: ['gusers', 'Back to All people'],
    title: 'New person',
    sub: 'The home organization decides how they will sign in',
    actions:
      btn('Cancel', { icon: 'undo', go: 'gusers' }) +
      `<button type="button" class="btn pri" data-act="nucreate" ${ok ? '' : 'disabled'} aria-label="Create" title="${ok ? 'Create the person' : 'First name, last name, email and home organization are needed'}">${ic('save', 15)}<span>Create</span></button>`,
    body: `<section class="panel"><h2>Details</h2><div class="fgrid">
      <label class="lbl">First name<input type="text" data-nu="first" value="${v('first')}"></label><label class="lbl">Last name<input type="text" data-nu="last" value="${v('last')}"></label>
      <label class="lbl span2">Email<input type="email" data-nu="email" value="${v('email')}" placeholder="name@organization.example"></label></div></section>
    <section class="panel mt"><h2>Home organization <span class="req">required</span></h2>
      <div class="fgrid"><label class="lbl">Organization<select data-nuhome><option value="">Choose…</option>${TENANTS.map(
        (x) => {
          const off = tenSt(S, x) === 'Suspended';
          return `<option ${x.n === N.home ? 'selected' : ''} ${off ? 'disabled' : ''}>${x.n}${off ? ' · suspended' : ''}</option>`;
        },
      ).join(
        '',
      )}</select><span class="hint">A suspended organization takes no new people</span></label>
        <label class="lbl"><span class="lbl-h">Role in this organization${roleHelp()}</span><select data-nu-sel="role">${ROLE_LIST.map((r) => `<option ${r === (N.role || 'User') ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
        <label class="lbl">Profile<select data-nu-sel="prof" ${(N.role || 'User') === 'Manager' ? 'disabled' : ''}>${PROFILES.map((pr) => `<option value="${pr.id}" ${pr.id === (N.prof || 'std') ? 'selected' : ''}>${pr.n}</option>`).join('')}</select><span class="hint">The profiles are those of the chosen organization</span></label></div>
      <div class="mt">${how}</div></section>
    <section class="panel mt"><h2>Other organizations <span class="muted small">optional</span></h2><p class="muted small">They enter them as a guest, with the same sign-in. The role is at most the one each organization grants to guests.</p>
      <ul class="rows">${TENANTS.filter((x) => x.n !== N.home && tenSt(S, x) !== 'Suspended')
        .map((x) => {
          const on = assoc.includes(x.n);
          return `<li><label class="assoc"><input type="checkbox" data-nuassoc="${x.n}" ${on ? 'checked' : ''} ${home ? '' : 'disabled'}><b>${x.n}</b></label><span class="grow"></span>${on ? `<select class="sm-sel" aria-label="Profile in ${x.n}"><option>View and edit</option><option>Standard</option><option>Analyst</option></select>` : `<span class="muted small">${home ? '' : 'pick the home organization first'}</span>`}</li>`;
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
      ? ['gusers', 'Back to All people']
      : ['members', 'Back to People'];
  const tabsL = [
    ['prof', 'Profile'],
    ['acc', 'Sign-in'],
    ['perm', 'Permissions'],
    ['act', 'Activity'],
  ].concat(S.role === 'admin' ? [['ten', 'Organizations']] : []);
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
    body = `${guest ? `<div class="banner info">${ic('building', 18)}<div><b>Guest from ${p.home}.</b> Signs in with the identity of their home organization; here they only have role and groups. Password, second factor and sessions are managed by ${p.home}.</div></div>` : ''}
    <div class="two ${guest ? 'mt' : ''}"><section class="panel"><h2>How they sign in</h2><dl class="kv"><dt>Home organization</dt><dd>${personHome(p)}</dd><dt>Sign-in</dt><dd>${sso ? 'SSO · Keycloak, realm example-city' : p.via === 'Local' ? viaLabel(p) + ', email and password' : 'Not yet: invitation pending'}</dd><dt>Second factor</dt><dd>${role === 'Manager' ? pill('On, required for the role', 'ok', 'check') : sso ? 'Managed by the identity provider of the organization' : pill('Off', 'warn')}</dd><dt>Last sign-in</dt><dd>${p.last}</dd></dl>
        <div class="row mt">${guest ? '' : sso ? btn('Open in Keycloak', { icon: 'key' }) : p.via === 'Local' ? btn('Send the password link', { icon: 'mail' }) + btn('Reset the second factor') : btn('Send the invitation again', { icon: 'mail' })}</div></section>
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
      ['calendar', 'Quarterly review with finance', 'View', 'Whole organization'],
      ['checklist', 'Prepare the budget draft', 'Edit', 'Group ' + g],
      ['calendar', 'Open day 2026', 'View', 'Public'],
    ];
    const eff = effPerms(role === 'Manager' ? null : prof, p.groups, p.n);
    const why = S.whyItem
      ? (() => {
          const x = ITEMS.find((y) => y.id === S.whyItem),
            shared =
              x.acc === 'public' ||
              x.acc === 'org' ||
              (x.acc === 'groups' && ['Planning', 'Finance'].includes(g)),
            mod = role === 'Manager' || !!(PROF(prof).p[x.app] || [])[0];
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
              'Module ' + APP(x.app).n,
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
        role === 'Manager' ? 'every permission in the organization' : PROF(prof).n + ' profile',
      ],
      ['Groups', p.groups.length, p.groups.join(', ')],
      ['Items they see', '86', 'of 214 in the apps'],
      ['Owner of', p.ini === 'DC' ? '7' : '3', 'notes, estimates and tasks'],
    ])}
      <section class="panel mt"><div class="panel-h"><div><h2>In the modules</h2><p class="muted small">${role === 'Manager' ? 'A Manager has every permission of every module on in the organization.' : `What they can do in every module, and where it comes from: the ${PROF(prof).n} profile, the groups, or a personal exception.`}</p></div>${role === 'Manager' ? '' : `<div class="row">${btn('Change profile', { icon: 'user', act: 'pproftab' })}${S.role === 'manager' ? btn('Exceptions in Modules', { icon: 'puzzle', go: 'splugins' }) : ''}</div>`}</div>${role === 'Manager' ? '' : permTable(eff, { off: true })}</section>
      <section class="panel mt"><div class="panel-h"><div><h2>Why can they not see an item?</h2><p class="muted small">Pick the item: the platform rebuilds the chain, from the share to the permission of the module.</p></div></div>
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
    body = `<section class="panel"><div class="panel-h"><div><h2>Organizations they belong to</h2><p class="muted small">One home organization, which decides how they sign in; the others as a guest, each with its role, reached with the same identity.</p></div>${btn('Add to an organization', { icon: 'plus' })}</div>
      <div class="tbl-w"><table class="tbl"><thead><tr><th>Organization</th><th>Link</th><th><span class="lbl-h">Role${roleHelp()}</span></th><th>Profile</th><th>Groups</th><th>Since</th><th></th></tr></thead><tbody>${personTenants(
        p,
      )
        .map(
          (m, i) =>
            `<tr><td><b>${m[0]}</b></td><td>${m[2] === 'home' ? pill('Home', 'info', 'key') : pill('Guest')}</td><td><select class="sm-sel" aria-label="Role in ${m[0]}">${ROLE_LIST.map((r) => `<option ${r === m[1] ? 'selected' : ''}>${r}</option>`).join('')}</select></td><td>${m[1] === 'Manager' ? '<span class="muted small">every permission</span>' : `<select class="sm-sel" aria-label="Profile in ${m[0]}">${PROFILES.map((pr) => `<option ${pr.id === (i ? 'view' : p.prof) ? 'selected' : ''}>${pr.n}</option>`).join('')}</select>`}</td><td class="small">${(i ? ['Field team'] : p.groups).join(', ')}</td><td class="num muted">${i ? '14 Mar 2026' : '9 Jan 2025'}</td><td class="r">${m[2] === 'home' ? (solo ? '' : btn('Move the home organization', { act: 'movehome' })) : btn('Remove')}</td></tr>`,
        )
        .join('')}</tbody></table></div>
      <p class="muted small mt">The role in every organization can be changed by the administrator, here, or by the manager of that organization; groups are given by the manager. Moving the home organization changes how one signs in: from the next day the person uses the sign-in of the new organization, and must know it first.</p></section>`;
  } else {
    const profSel = `<label class="lbl">Profile<select data-pprof ${role === 'Manager' ? 'disabled' : ''}>${PROFILES.map((pr) => `<option value="${pr.id}" ${pr.id === prof ? 'selected' : ''}>${pr.n}</option>`).join('')}</select><span class="hint">${role === 'Manager' ? 'A Manager already has every permission' : 'Where the permissions in the modules start; groups add. <a data-tab="per:perm">See the permissions</a>'}</span></label>`;
    const roleSel = `<label class="lbl"><span class="lbl-h">Role${roleHelp()}</span><select data-prole ${sso ? 'disabled' : ''}>${ROLE_LIST.map((r) => `<option ${r === role ? 'selected' : ''}>${r}</option>`).join('')}</select>${sso ? '<span class="hint">With single sign-on the role arrives from the identity provider at every sign-in: it changes in the table of roles of the organization, under Sign-in</span>' : '<span class="hint">What they can do in general; on what, shares say</span>'}</label>`;
    body = `<section class="panel"><h2>Details</h2>${guest ? `<p class="muted small">Name, email and image are managed by ${p.home}, their home organization.</p>` : avatarEdit(S, p.ini, p.c)}<div class="fgrid">${fld('First name', first, { ro: guest })}${fld('Last name', rest.join(' '), { ro: guest })}${fld('Email', p.mail, { type: 'email', ro: sso || guest, hint: sso ? 'Comes from the identity provider of the organization: it changes there' : '' })}${fld('Office', p.groups[0])}</div></section>
    ${
      S.role === 'admin'
        ? `<section class="panel mt"><h2>Role and groups</h2><p class="muted small">They change from organization to organization: they are chosen in the tab <a data-tab="per:ten">Organizations</a>.</p></section>`
        : `<section class="panel mt"><h2>Role, profile and groups</h2><div class="fgrid">${roleSel}${profSel}
      <div class="lbl">Groups<div class="gchips">${p.groups.map((g) => `<span class="gchip">${ic('users', 13)}${g}<button type="button" aria-label="Remove from ${g}">${ic('x', 12)}</button></span>`).join('')}<button type="button" class="gchip add">${ic('plus', 13)}Add</button></div><span class="hint">${sso ? 'The groups of the identity provider arrive by themselves; here one adds the groups that exist only in Mosaikit' : 'Groups receive shares and permissions in the modules'}</span></div></div></section>`
    }
    <section class="panel mt danger">${S.role === 'admin' ? '' : `<div class="panel-h"><div><h2>Remove from the organization</h2><p class="muted small">They own ${p.ini === 'DC' ? '7' : '3'} items here: first one picks who gets them. ${guest ? `The account stays: it belongs to ${p.home}.` : solo ? 'They are in no other organization: removing them here leaves the account without an organization, so deleting it is better.' : 'The account stays, because it is in other organizations too.'}</p></div>${btn('Remove from the organization', { icon: 'x', act: 'rmperson' })}</div>`}
      ${guest ? '' : `<div class="panel-h ${S.role === 'admin' ? '' : 'mt'}"><div><h2>Delete the account</h2><p class="muted small">Removes the person from Mosaikit and from every organization${solo ? '' : ' they are in'}; their items go to whoever is chosen, tokens are revoked.${sso ? ' With single sign-on, if the organization does not remove them from its identity provider, they would come back as new at the next sign-in: the platform blocks them until the identity provider confirms.' : ''}</p></div>${btn('Delete the account', { icon: 'trash', kind: 'danger', act: 'ask', v: 'delacc' })}</div>`}</section>`;
  }
  const stBanner =
    st === 'Suspended'
      ? `<div class="banner bad">${ic('lock', 18)}<div><b>Suspended.</b> ${P_ST.Suspended.d}</div>${btn('Reactivate', { kind: 'pri', act: 'pst', v: 'Active' })}</div>`
      : st === 'Invited'
        ? `<div class="banner warn">${ic('mail', 18)}<div><b>Invitation sent 9 days ago, not accepted yet.</b> It expires in 5 days.</div>${btn('Send again')}</div>`
        : '';
  const menu = S.pStMenu
    ? `<div class="sortmenu stmenu" role="menu" aria-label="State of the person">${['Active', 'Suspended'].map((k) => `<button type="button" role="menuitemradio" aria-checked="${k === st}" data-act="pst" data-v="${k}">${k === st ? ic('check', 14) : '<i></i>'}<span><b>${k}</b><span class="muted small">${P_ST[k].d}</span></span></button>`).join('')}</div>`
    : '';
  const stBtn =
    st === 'Invited'
      ? `<span class="pill warn">Invited</span>`
      : `<span class="st-w"><button type="button" class="btn st-btn" data-act="pstmenu" aria-haspopup="menu" aria-expanded="${!!S.pStMenu}" aria-label="State: ${st}"><i class="dot ${P_ST[st].tone}"></i><span>${st}</span>${ic('down', 13)}</button>${menu}</span>`;
  const saveA =
    t === 'prof'
      ? btn('Cancel', { icon: 'undo' }) + btn('Save', { kind: 'pri', icon: 'save' })
      : '';
  return detailPage(S, {
    back: from,
    title: p.n,
    sub: `${p.mail} · ${role === 'Manager' ? role : 'User, ' + PROF(prof).n} · ${p.groups.join(', ')}`,
    actions: stBtn + saveA,
    tabs: tabs(tabsL, t, 'per'),
    body: stBanner + body,
  });
}

/* ── Group page (manager) ─────────────────────────────────────────────
   A group belongs to the organization. One tab each for what it is for: who is in it, what is
   shared with it, which modules it adds. */
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
    body = `<div class="panel-h"><p class="muted small">What the group adds, module by module, to the permissions of the profile of each member. It changes in Modules › Access and permissions, the only place where it is edited.</p>${btn('Change in Modules', { icon: 'puzzle', go: 'splugins' })}</div>
      <ul class="rows panel mt">${mods.map((m) => `<li><span class="ri">${ic(FEAT(m[0]) ? FEAT(m[0]).ic : 'puzzle', 15)}</span><div class="rt"><b>${FEAT(m[0]) ? FEAT(m[0]).n : m[0]}</b><span>${MOD_PERMS[m[0]].filter((p, i) => m[1][3][i]).join(' · ')}</span></div>${btn('Open', { act: 'modacc', v: m[0] })}</li>`).join('') || '<li class="muted">The group adds no permission: members have the ones of their profile.</li>'}</ul>`;
  } else if (t === 'set') {
    body = `<section class="panel"><h2>Group</h2><div class="fgrid">${fld('Name', g.n)}${fld('Description', g.d)}</div></section>
      <section class="panel mt"><h2>Where members come from</h2>
        <div class="opts"><label class="opt ${g.kc ? 'sel' : ''}"><input type="radio" name="gorig" ${g.kc ? 'checked' : ''}><b>From the identity provider of the organization</b><span>Whoever has <span class="mono">${g.n.toLowerCase().replace(/ /g, '-')}</span> in the <span class="mono">groups</span> claim joins the group by themselves, at every sign-in; whoever loses it leaves.</span></label>
          <label class="opt ${g.kc ? '' : 'sel'}"><input type="radio" name="gorig" ${g.kc ? '' : 'checked'}><b>Only from Mosaikit</b><span>Members are added and removed by the manager. Useful for guests and for groups the identity provider does not know.</span></label></div></section>
      <section class="panel mt danger"><div class="panel-h"><div><h2>Delete the group</h2><p class="muted small">The ${g.res} shares of the group go away; people stay in the organization and lose what they received through the group.</p></div>${btn('Delete the group', { icon: 'trash', kind: 'danger', act: 'ask', v: 'delgroup' })}</div></section>`;
  } else {
    body = `${g.kc ? `<div class="banner info">${ic('key', 18)}<div><b>Members from the identity provider of the organization.</b> Whoever has the group in their account of the organization joins and leaves by themselves, at every sign-in. Here one adds only members the identity provider does not know, like guests.</div></div>` : ''}
      <div class="field mt">${ic('search', 15)}<input type="text" placeholder="Add people of the organization or guests" aria-label="Add people"></div>
      <div class="tbl-w mt"><table class="tbl"><thead><tr><th>Name</th><th>Role</th><th>Joined through</th><th></th></tr></thead><tbody>${members.map((p) => `<tr class="clk" data-res="person:${p.ini}" data-go="person"><td><div class="cell-t">${av(p.ini, p.c, 26)}<div><b>${p.n}</b><span class="muted small">${p.mail}</span></div></div></td><td>${pill(p.role)}</td><td class="small">${p.home ? pill('Guest · ' + p.home, 'info') : g.kc && p.via === 'SSO' ? 'Identity provider' : 'Added in Mosaikit'}</td><td class="r">${g.kc && p.via === 'SSO' && !p.home ? '<span class="muted small">removed from the identity provider</span>' : btn('Remove')}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted small mt">${members.length} of ${g.m} members shown.</p>`;
  }
  return detailPage(S, {
    back: ['members', 'Back to People'],
    title: g.n,
    sub: `${g.d} · ${g.m} people · ${g.kc ? 'from the identity provider' : 'only Mosaikit'}`,
    actions:
      t === 'set'
        ? btn('Cancel', { icon: 'undo' }) + btn('Save', { kind: 'pri', icon: 'save' })
        : '',
    tabs: tabs(
      [
        ['set', 'Settings'],
        ['mem', 'Members'],
        ['res', 'Shared items'],
        ['mod', 'Modules'],
      ],
      t,
      'grp',
    ),
    body,
  });
}

/* ── Activity log (manager) and audit log (administrator) ─────────────
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
          ? `<fieldset class="facet"><legend>Organization</legend>${['Mosaikit (Platform)']
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
  F.ten.forEach((v) => chips.push(['ten', v, `Organization: ${v}`]));
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
    <dl class="kv"><dt>Who</dt><dd>${e.who}${logGroupOf(e.who).length ? `<span class="muted small"> · ${logGroupOf(e.who).join(', ')}</span>` : ''}</dd><dt>On what</dt><dd>${LOG_TYPE[e.type]} · ${e.target}</dd>${adm ? `<dt>Organization</dt><dd>${e.ten}</dd>` : ''}
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
    ? `<div class="tbl-w"><table class="tbl"><thead><tr><th class="cbx"><span class="sr">Select</span></th><th>When</th><th>Who</th><th>What</th><th>On what</th>${adm ? '<th>Organization</th>' : ''}<th>Outcome</th></tr></thead><tbody>
    ${rows.map((e) => `<tr class="clk ${S.logSel === e.id ? 'picked' : ''}" data-act="logsel" data-v="${e.id}">${selTd(S, k, e.id, e.act)}<td class="num">${logDate(e)} ${e.t}</td><td>${e.who === 'Unknown' ? '<span class="muted">Unknown</span>' : link('who', e.who, e.who)}</td><td>${e.act}</td><td><span class="muted small">${LOG_TYPE[e.type]}</span> ${link('target', e.target, e.target)}</td>${adm ? `<td class="small">${link('ten', e.ten, e.ten)}</td>` : ''}<td>${pill(e.ok ? 'Succeeded' : 'Failed', e.ok ? 'ok' : 'bad')}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty"><b>No event with these filters.</b><span class="muted small">Try removing a filter or widening the period.</span></div>`;
  return resPage(
    S,
    {
      title: adm ? 'Audit log' : 'Activity log',
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

/* ── Dialogs of the organization ─────────────────────────────────────── */

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
      html: `<div class="banner info">${ic('building', 18)}<div><b>${a.who} already has an account: they belong to ${a.home}.</b> They will enter as a <b>guest</b>, with their own sign-in (${a.via === 'sso' ? 'single sign-on of ' + a.home : 'local account of ' + a.home}). Here they get role and groups; for guests the highest role is User.</div></div>`,
    };
  const dom = e.split('@')[1];
  if (SSO_DOMAINS[dom] === 'Example City')
    return {
      ok: true,
      html: `<div class="banner info">${ic('user', 18)}<div><b>New account of Example City.</b> This will be their home organization: they will sign in with the single sign-on of the realm example-city, and the account is created at the first sign-in.</div></div>`,
    };
  return {
    ok: false,
    html: `<div class="banner warn">${ic('alert', 18)}<div><b>They have no account and Example City accepts only single sign-on.</b> A person from outside can get in if they already have an account in another organization, or if «Both» is chosen under Sign-in and a local account is created for them.</div></div>`,
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
      <label class="lbl">Email<input type="email" id="inv-email" value="${S.invEmail || ''}" placeholder="name@organization.example" autocomplete="off"></label>
      <div class="lg-ex"><span class="muted small">Try with</span>${ex.map((x) => `<button type="button" class="chip" data-act="invex" data-v="${x}">${x}</button>`).join('')}</div>
      <div id="inv-info">${inf.html}</div>
      <div class="fgrid"><label class="lbl"><span class="lbl-h">Role${roleHelp()}</span><select data-invrole>${ROLE_LIST.map((r) => `<option ${r === I.role ? 'selected' : ''} ${inf.guest && r === 'Manager' ? 'disabled' : ''}>${r}${inf.guest && r === 'Manager' ? ' · not for guests' : ''}</option>`).join('')}</select></label></div>
      ${
        I.role === 'Manager'
          ? `<p class="muted small">A Manager has every permission of the modules on in the organization: profile and groups are not needed.</p>`
          : `<div><div class="lbl-h inv-l">Profile</div><div class="opts prof-o sm">${PROFILES.map((pr) => `<button type="button" class="opt ${pr.id === I.prof ? 'sel' : ''}" data-act="invprof" data-v="${pr.id}" aria-pressed="${pr.id === I.prof}"><b>${pr.n}</b><span>${pr.d}</span></button>`).join('')}</div></div>
      <div><div class="lbl-h inv-l">Groups</div><div class="gchips">${GROUPS.map((g) => {
        const on = I.groups.includes(g.n);
        return `<button type="button" class="gchip tg ${on ? 'on' : ''}" data-act="invgrp" data-v="${g.n}" aria-pressed="${on}">${on ? ic('check', 12) : ic('plus', 12)}${g.n}</button>`;
      }).join('')}</div></div>
      <section class="inv-prev"><div class="panel-h"><div><b>What they will be able to do</b><span class="muted small"> · from the profile, the groups${Object.keys(I.extra).length ? ' and the exceptions' : ''}</span></div><button type="button" class="btn sm" data-act="invadv" aria-expanded="${!!I.adv}">${ic(I.adv ? 'check' : 'sliders', 14)}<span>${I.adv ? 'Done' : 'Advanced'}</span></button></div>
        ${I.adv ? '<p class="muted small">Touch a permission that is off to give it as an exception: it applies to this person only.</p>' : ''}${permTable(effPerms(I.prof, I.groups, null, I.extra), { edit: I.adv })}</section>`
      }</div>
      <div class="dlg-f"><span class="muted small">The invitation expires in 14 days. Whoever accepts signs in with their own access, and finds this organization in the choice.</span>${btn('Cancel', { act: 'close' })}<button type="button" class="btn pri" id="inv-send" ${inf.ok ? '' : 'disabled'}>${ic('mail', 15)}<span>Send the invitation</span></button></div>`,
  };
};
DIALOGS.groupnew = () => ({
  html: `<div class="dlg-h"><h2>New group</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b stack">
      <div class="fgrid">${fld('Name', '', { wide: true })}${fld('Description', '', { wide: true })}</div>
      <div><div class="lbl-h inv-l">Where members come from</div><div class="opts"><label class="opt sel"><input type="radio" name="gn-o" checked><b>Only from Mosaikit</b><span>You add them: useful for guests and for groups the identity provider does not know.</span></label><label class="opt"><input type="radio" name="gn-o"><b>From the identity provider of the organization</b><span>Whoever has the group in their account of the organization joins by themselves, at every sign-in.</span></label></div></div>
      <div class="field">${ic('search', 15)}<input type="text" placeholder="Add people of the organization or guests" aria-label="Add people"></div>
      <p class="muted small">After creating it: share items with the group, and give it permissions in the modules from its page.</p></div>
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
    html: `<div class="dlg-h"><h2>Remove ${p.n} from the organization</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b stack">
      <p>They own ${res.length} items. Before removing them, pick who gets them: whoever uses them goes on using them.</p>
      <label class="lbl">They all go to<select><option>Elena Ricci (manager)</option>${PEOPLE.filter(
        (x) => x.ini !== p.ini && x.role !== 'Manager',
      )
        .map((x) => `<option>${x.n}</option>`)
        .join('')}</select><span class="hint">One can also choose item by item below</span></label>
      <ul class="rows">${res.map((r) => `<li><span class="ri">${ic(r[0], 15)}</span><div class="rt grow"><b>${r[1]}</b><span>${r[2]}</span></div><select class="sm-sel" aria-label="New owner of ${r[1]}"><option>Elena Ricci</option><option>Sara Greco</option></select></li>`).join('')}</ul>
      <ul class="sync"><li><i class="dot warn"></i><div><span>They leave their groups and lose the shares of this organization</span></div></li><li><i class="dot ok"></i><div><span>${p.home ? `Their account stays, in ${p.home}` : personTenants(p).length > 1 ? 'Their account stays: it is in other organizations too' : 'They are in no other organization: the account stays without one, and deleting it is better'}</span></div></li></ul></div>
      <div class="dlg-f"><span class="grow"></span>${btn('Cancel', { act: 'close' })}${btn('Remove from the organization', { kind: 'danger', act: 'okmodal', v: p.n + ' left the organization: their items went to Elena Ricci.' })}</div>`,
  };
};
DIALOGS.newten = (S) => {
  const st = S.nt || (S.nt = { step: 0, plan: 'Pro', auth: 'local' }),
    steps = ['Organization', 'Plan', 'Sign-in', 'Manager', 'Summary'];
  const body = [
    `<div class="fgrid">${fld('Name', 'Example Town', { wide: true })}${fld('Identifier', 'example-town', { mono: true, hint: 'Name of the realm, of the schema and of the address: it does not change later' })}${fld('Registration number', 'EX-0007', { mono: true })}</div>`,
    `<div class="opts row3">${Object.keys(PLANS)
      .map(
        (k) =>
          `<button type="button" class="opt ${st.plan === k ? 'sel' : ''}" data-act="ntset" data-k="plan" data-v="${k}" aria-pressed="${st.plan === k}"><b>${k}</b><span>${PLANS[k].price}</span></button>`,
      )
      .join(
        '',
      )}</div><ul class="rows mt"><li><div class="rt grow"><b>Starts on trial</b><span>30 days, then it is suspended unless confirmed</span></div>${toggle(1)}</li></ul>`,
    `<div class="opts">${[
      ['local', 'Local accounts', 'Email and password in the Keycloak realm of the organization'],
      [
        'sso',
        'Single sign-on of the organization',
        st.plan === 'Free'
          ? 'Not included in the Free plan'
          : 'Keycloak connects to the identity provider of the organization; it is set up later, on its page',
      ],
    ]
      .map(
        (o) =>
          `<button type="button" class="opt ${st.auth === o[0] ? 'sel' : ''}" data-act="ntset" data-k="auth" data-v="${o[0]}" aria-pressed="${st.auth === o[0]}" ${o[0] === 'sso' && st.plan === 'Free' ? 'disabled' : ''}><b>${o[1]}</b><span>${o[2]}</span></button>`,
      )
      .join('')}</div>`,
    `<div class="fgrid">${fld('Email of the manager', 'admin@town.example.org', { type: 'email', wide: true, hint: 'Gets the invitation; the manager then invites everybody else' })}</div>`,
    `<p>Creating the organization, the platform prepares by itself:</p><ul class="sync">${['The Keycloak realm <span class="mono">example-town</span>, with the client of the shell and the roles', 'The schema of the organization in the database, with row-level security on every table', 'Its space in the file storage', `The ${st.plan} plan${st.plan === 'Free' ? '' : ', on trial for 30 days'}, and the invitation to the manager`].map((s) => `<li><i class="dot ok"></i><div><span>${s}</span></div></li>`).join('')}</ul>`,
  ][st.step];
  return {
    wide: true,
    html: `<div class="dlg-h"><h2>New organization</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b stack"><ol class="wiz">${steps.map((s, i) => `<li class="${i < st.step ? 'done' : i === st.step ? 'on' : ''}"><i>${i < st.step ? ic('check', 12) : i + 1}</i><span>${s}</span></li>`).join('')}</ol>${body}</div>
      <div class="dlg-f"><span class="grow"></span>${st.step ? btn('Back', { act: 'ntstep', v: '-1' }) : btn('Cancel', { act: 'close' })}${st.step < 4 ? btn('Next', { kind: 'pri', act: 'ntstep', v: '1' }) : btn('Create the organization', { kind: 'pri', icon: 'plus', act: 'okmodal', v: 'Organization «Example Town» created, on trial for 30 days. Invitation sent to the manager.' })}</div>`,
  };
};
DIALOGS.newadmin = () => ({
  html: `<div class="dlg-h"><h2>New administrator of the platform</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b stack">
      <div class="fgrid">${fld('Full name', '')}${fld('Email', '', { type: 'email' })}</div>
      <ul class="sync"><li><i class="dot ok"></i><div><span>A Keycloak account in the realm of the platform, with the second factor required</span></div></li><li><i class="dot ok"></i><div><span>Configures the platform: does not see the content of organizations</span></div></li></ul></div>
      <div class="dlg-f"><span class="grow"></span>${btn('Cancel', { act: 'close' })}${btn('Create and send the invitation', { kind: 'pri', act: 'okmodal', v: 'Administrator created: they get the invitation and set the second factor at the first sign-in.' })}</div>`,
});
DIALOGS.movehome = (S) => {
  const p = PEOPLE.find((x) => x.ini === (S.resId && S.resId.person)) || PEOPLE[3];
  const others = personTenants(p).filter((m) => m[2] !== 'home');
  return {
    html: `<div class="dlg-h"><h2>Move the home organization of ${p.n}</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b stack">
      <p>Today they belong to <b>${personHome(p)}</b> and sign in with ${viaLabel(p)}. The new home organization must be one they are already in.</p>
      <div class="opts">${others.map((m, i) => `<label class="opt ${i === 0 ? 'sel' : ''}"><input type="radio" name="mh" ${i === 0 ? 'checked' : ''}><b>${m[0]}</b><span>Today: ${m[1]} · after the move they sign in with the access of ${m[0]}</span></label>`).join('')}</div>
      <ul class="sync">${[
        [
          'warn',
          'The way they sign in changes',
          'from the next day they use the access of the new organization: with single sign-on, they need an account in its identity provider',
        ],
        [
          'ok',
          'Roles and groups stay',
          'in every organization, including the one they leave as home, where they become a guest',
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
      <div class="dlg-f"><span class="muted small">Only the administrator of the platform can do it, and it stays in the audit log.</span>${btn('Cancel', { act: 'close' })}${btn('Move', { kind: 'pri', act: 'okmodal', v: 'Home organization moved. ' + p.n.split(' ')[0] + ' gets the instructions by email.' })}</div>`,
  };
};
DIALOGS.rolesinfo = () => ({
  wide: true,
  html: `<div class="dlg-h"><h2>What each role can do</h2>${btn('', { icon: 'x', act: 'close' })}</div><div class="dlg-b">${rolesInfoHtml()}</div>
      <div class="dlg-f"><span class="muted small">Three fixed roles. For a User, the profile says where the permissions in the modules start; shares say on which items.</span>${btn('Got it', { kind: 'pri', act: 'close' })}</div>`,
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
    d: 'It is removed from Mosaikit and from every organization it is in. It cannot be undone.',
    items: [
      'Their items go to whoever you choose: that comes first',
      'Sessions close and personal tokens are revoked',
      'The audit log keeps the name, for the record',
    ],
    ok: 'Delete the account',
    done: 'Account deleted. The items went to Elena Ricci.',
  },
  delgroup: {
    t: 'Delete the group?',
    d: 'People stay in the organization; they lose what they received through the group.',
    items: [
      'The shares made to the group go away',
      'The permissions the group added in the modules no longer apply to its members',
    ],
    ok: 'Delete the group',
    done: 'Group deleted. People stayed in the organization.',
  },
  mpoff: {
    t: 'Disable the module?',
    d: 'It turns off in every organization. It turns on again whenever you want, and nothing is lost.',
    items: [
      'Whoever uses it no longer sees it in the navigation',
      'The items made with the module stay, and come back when it is turned on',
    ],
    ok: 'Disable',
    done: 'Module disabled in every organization.',
  },
  mpdel: {
    t: 'Uninstall the module?',
    d: 'It is removed from the platform. To get it back, install it again from the catalog.',
    items: [
      'It turns off in every organization',
      'The settings of the module are deleted',
      'The items made with the module stay, but do not open until it is installed again',
    ],
    ok: 'Uninstall',
    done: 'Module uninstalled.',
  },
  leave: {
    t: 'Leave this organization?',
    d: 'You leave an organization you are a guest in. Your account stays, in your home organization.',
    items: [
      'You lose access to what was shared with you here',
      'The items you created here go to the manager of the organization',
      'To come back you need a new invitation',
    ],
    ok: 'Leave the organization',
    done: 'You left Green Region.',
  },
  tenarch: {
    t: 'Archive the organization?',
    d: 'Nobody signs in any more; the data stays and the organization reopens whenever you want.',
    items: ['Sessions close', 'Public links and embedded pages stop answering'],
    ok: 'Archive',
    done: 'Organization archived. It reopens from its page.',
  },
  tendel: {
    t: 'Delete the organization?',
    d: 'Everything is deleted in 30 days: until then it can be undone from the page of the organization.',
    items: [
      'People, groups and the items of every app of the organization',
      'Its Keycloak realm, its schema in the database and its space in the file storage',
      'Guests go back to their home organization only',
    ],
    ok: 'Delete the organization',
    done: 'The organization will be deleted on 8 Nov 2026. Until then it can be undone.',
  },
};

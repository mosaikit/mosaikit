// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/* eslint-disable -- plain browser scripts of a static mockup: they share globals across files */

/* Mosaikit mockup: the screens of the platform administrator, the settings of platform,
   tenant and person (with appearance and the theme editor), and the table of screens. */

/* ── Platform overview ───────────────────────────────────────────────── */

function stPillT(st) {
  return pill(TEN_ST[st].label || st, TEN_ST[st].tone);
}
function secPlatform(S) {
  setSub(null);
  const upd = MP.filter((m) => m.next && !(S.mpUpd || []).includes(m.id));
  const bad = MON_SVC.filter((s) => s[2] !== 'ok');
  const live = TENANTS.filter((x) => tenSt(S, x) !== 'Suspended');
  const trial = TENANTS.filter((x) => tenSt(S, x) === 'Trial').length,
    susp = TENANTS.filter((x) => tenSt(S, x) === 'Suspended').length;
  return detailPage(S, {
    title: 'Platform overview',
    sub: `Mosaikit (Platform) · ${TENANTS.length} tenants · 433 people · version 1.0`,
    actions: btn('New tenant', { kind: 'pri', icon: 'plus', act: 'newten' }),
    body: `
    ${kpis([
      [
        'Active tenants',
        String(live.length - trial),
        `${trial} on trial · ${susp} suspended`,
      ],
      ['People', '433', '437 memberships · 3 administrators', 'ok'],
      [
        'Services',
        `${MON_SVC.length - bad.length} of ${MON_SVC.length}`,
        bad.length ? `${bad.length} degraded: ${bad.map((s) => s[1]).join(', ')}` : 'healthy',
        bad.length ? 'warn' : 'ok',
      ],
      [
        'Updates',
        String(upd.length),
        upd.length ? 'to apply from Plugins' : 'none',
        upd.length ? 'warn' : 'ok',
      ],
    ])}
    <div class="grid-home"><section class="panel span2"><div class="panel-h"><h2>Services of the platform</h2><a data-go="monitoring">Monitoring</a></div><ul class="health cols">${MON_SVC.map((s) => `<li><i class="dot ${s[2]}"></i><b>${s[1]}</b><span class="muted small">${s[3]}</span></li>`).join('')}</ul></section>
    <section class="panel"><div class="panel-h"><h2>To do</h2></div><ul class="rows">${upd.length ? `<li><span class="ri">${ic('refresh', 15)}</span><div class="rt"><b>${upd.length} update${upd.length === 1 ? '' : 's'} to apply</b><span>${upd.map((m) => `${m.n} ${m.ver} → ${m.next}`).join(' · ')}</span></div>${btn('See', { go: 'marketplace' })}</li>` : ''}<li><span class="ri">${ic('building', 15)}</span><div class="rt"><b>Sandbox ends in 4 days</b><span>7 people · then it is suspended</span></div>${btn('Open', { go: 'tenant', res: 'ten:sandbox' })}</li><li><span class="ri">${ic('alert', 15)}</span><div class="rt"><b>The backup of 5 Oct failed</b><span>The last two succeeded</span></div>${btn('See', { act: 'sysgo', v: '2' })}</li></ul></section>
    <section class="panel span2"><div class="panel-h"><h2>Tenants by storage used</h2><a data-go="tenants">All</a></div><div class="tbl-w"><table class="tbl sm"><tbody>${TENANTS.slice()
      .sort((a, b) => b.data - a.data)
      .map((t) => {
        const u = tenUsage(S, t).space,
          q = tenQuota(S, t).space;
        return `<tr class="clk ${tenSt(S, t) === 'Suspended' ? 'dim' : ''}" data-res="ten:${t.slug}" data-go="tenant"><td><b>${t.n}</b>${tenSt(S, t) !== 'Active' ? ` ${stPillT(tenSt(S, t))}` : ''}</td><td class="sp-c">${meter(Math.min(u, q), q, `${fmtN(u)} of ${fmtN(q)} GB`)}</td><td class="num r">${t.users} people</td></tr>`;
      })
      .join('')}</tbody></table></div></section>
    <section class="panel"><div class="panel-h"><h2>Recent errors</h2><a data-go="monitoring">All</a></div><ul class="rows"><li><span class="ri">${ic('alert', 15)}</span><div class="rt"><b>Automation worker: time limit exceeded</b><span>Example City · Monthly report of open tasks · yesterday 16:12</span></div></li><li><span class="ri">${ic('alert', 15)}</span><div class="rt"><b>Identity provider: groups not synchronized</b><span>Example City · Field team · 6 Oct 08:02</span></div></li></ul></section></div>`,
  });
}

/* ── Tenants ─────────────────────────────────────────────────────────── */

function secTenants(S) {
  setSub(null);
  const f = tabOf(S, 'tenst', 'all');
  const n = (st) => TENANTS.filter((x) => tenSt(S, x) === st).length;
  const rows = TENANTS.filter((x) => f === 'all' || tenSt(S, x) === f);
  return resPage(
    S,
    {
      title: 'Tenants',
      total: `${TENANTS.length} tenants · 437 people`,
      create: { label: 'New tenant', act: 'newten' },
      bulk: {
        key: 'ten',
        ids: rows.map((x) => x.slug),
        acts: [
          ['lock', 'Suspend'],
          ['refresh', 'Reactivate'],
          ['download', 'Export'],
          ['trash', 'Delete', 1],
        ],
      },
    },
    filterCol(
      S,
      'ten',
      [
        [
          'Sign-in',
          [
            ['Identity provider (OIDC)', 2],
            ['Local accounts', 4],
          ],
        ],
      ],
      {
        search: 'Search a tenant',
        sort: SORT_NAME,
        scopeKey: 'tenst',
        scope: [
          ['All', TENANTS.length, 'all'],
          ['Active', n('Active'), 'Active'],
          ['On trial', n('Trial'), 'Trial'],
          ['Suspended', n('Suspended'), 'Suspended'],
        ],
      },
    ),
    `<div class="tbl-w"><table class="tbl"><thead><tr><th class="cbx"><span class="sr">Select</span></th><th>Tenant</th><th class="r">People</th><th class="r">Storage</th><th>Sign-in</th><th>Status</th></tr></thead><tbody>
    ${rows.map((x) => `<tr class="clk ${tenSt(S, x) === 'Suspended' ? 'dim' : ''} ${selOf(S, 'ten').includes(x.slug) ? 'picked' : ''}" data-res="ten:${x.slug}" data-go="tenant">${selTd(S, 'ten', x.slug, x.n)}<td><div><b>${x.n}</b><span class="muted small mono"> ${x.slug}</span></div></td><td class="r num">${x.users}</td><td class="r num">${fmtN(x.data)} GB</td><td class="small">${x.auth}</td><td>${stPillT(tenSt(S, x))}</td></tr>`).join('')}</tbody></table></div>`,
  );
}
/* The trial: start, end and what happens at the end. A tenant put «on trial» starts today for 30 days. */
const TODAY = '2026-10-08';
function dayDiff(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 864e5);
}
function tenTrial(S, x) {
  return Object.assign(
    { from: '2026-09-12', to: '2026-10-12', after: 'suspended' },
    x.slug === 'sandbox' ? {} : { from: TODAY, to: '2026-11-07' },
    S.tenTrial && S.tenTrial[x.slug],
  );
}
function trialPanel(S, x) {
  const tr = tenTrial(S, x);
  const left = dayDiff(TODAY, tr.to),
    len = dayDiff(tr.from, tr.to);
  const opt = (v, b) =>
    `<label class="chip-r"><input type="radio" name="after" data-act="trialafter" data-v="${v}" ${tr.after === v ? 'checked' : ''}><span>${b}</span></label>`;
  return `<section class="panel trial"><div class="panel-h"><div><h2>${ic('clock', 16)} Trial period</h2><p class="muted small">${len < 1 ? '<b class="bad">The end must come after the start.</b>' : `${len} days · ${left > 0 ? `<b>${left}</b> left` : left === 0 ? '<b>ends today</b>' : `<b class="bad">ended ${-left} days ago</b>`}`}</p></div>
      <div class="row">${btn('+15 days', { act: 'trialext', v: '15' })}${btn('+30 days', { act: 'trialext', v: '30' })}</div></div>
    <div class="fgrid"><label class="lbl">Start<input type="date" data-trial="from" value="${tr.from}" max="${tr.to}"></label><label class="lbl">End<input type="date" data-trial="to" value="${tr.to}" min="${tr.from}"></label></div>
    <div class="trial-a"><span class="small">At the end</span>${opt('suspended', 'Suspend the tenant')}${opt('active', 'Make it active')}</div>
    <p class="muted small">Seven days before, the platform warns the contact and the administrators.</p></section>`;
}
/* How the people of a tenant sign in: local accounts kept by Mosaikit, or the external identity
   provider of the tenant (OIDC). One or the other, never both. Roles come from one source only.
   Administrators never sign in through a tenant: they have their own access, always local. */
function tenSignIn(S, x, e) {
  const auth = (S.tenAuth && S.tenAuth[x.slug]) || e.auth;
  const roles = (S.tenRoles && S.tenRoles[x.slug]) || e.roles;
  const opt = (name, act, cur, v, b, d) =>
    `<label class="opt ${cur === v ? 'sel' : ''}"><input type="radio" name="${name}" data-act="${act}" data-v="${v}" ${cur === v ? 'checked' : ''}><b>${b}</b><span>${d}</span></label>`;
  const oidc = auth === 'oidc';
  const rules = (list) =>
    `<ul class="sync">${list.map((r) => `<li><i class="dot ${r[0]}"></i><div><b>${r[1]}</b><span class="muted small">${r[2]}</span></div></li>`).join('')}</ul>`;
  return `<section class="panel"><h2>How people sign in</h2><div class="opts">${opt('ta', 'tenauth', auth, 'local', 'Local accounts', 'Username and password kept by Mosaikit (argon2id). The Tenant Manager creates people and resets passwords.')}${opt('ta', 'tenauth', auth, 'oidc', 'External identity provider (OIDC)', 'The provider of the customer (Keycloak, Entra ID…). People sign in there; Mosaikit never sees their password.')}</div>
      <div class="banner info mt">${ic('shield', 18)}<div><b>Administrators are not affected.</b> They sign in from the Administrator access page, always with the local password of the platform and the second factor, whatever this tenant uses.</div></div></section>
    ${
      oidc
        ? `<section class="panel mt"><div class="panel-h"><div><h2>Identity provider</h2><p class="muted small">Authorization code with PKCE; the token is checked with the keys the provider publishes.</p></div>${btn('Check the configuration', { icon: 'refresh', act: 'toast', v: 'Discovery read, keys downloaded, client accepted: the configuration works.' })}</div>
      <div class="fgrid">${fld('Address of the provider (issuer)', e.issuer || 'https://login.' + e.mail + '/realms/staff', { mono: true, wide: true, hint: 'The rest (endpoints, keys) is read from its discovery document' })}${fld('Client id', 'mosaikit', { mono: true })}${fld('Client secret', '••••••••••••', { type: 'password', hint: 'Encrypted, never sent to the browser' })}${fld('Scopes', 'openid profile email', { mono: true })}${fld('Text of the button', 'Sign in with ' + (e.idpName || 'the identity provider'))}${fld('Return address (to register in the provider)', 'https://apps.example.org/api/auth/oidc/' + x.slug + '/callback', { mono: true, ro: true, wide: true })}</div>
      <ul class="rows mt"><li><div class="rt grow"><b>Go straight to the provider</b><span>The sign-in page skips the button and sends people to ${e.idpName || 'the provider'}</span></div>${toggle(0)}</li></ul></section>
    <section class="panel mt"><h2>Where roles come from</h2><p class="muted small">One source only, so that a role is never decided in two places.</p><div class="opts">${opt('tr', 'tenroles', roles, 'mosaikit', 'Managed in Mosaikit', 'The provider only says who the person is; the Tenant Manager gives roles and groups.')}${opt('tr', 'tenroles', roles, 'idp', 'Groups of the identity provider', 'Role and groups are read from the token at every sign-in; nobody changes them by hand in Mosaikit.')}</div>
      ${
        roles === 'idp'
          ? `<div class="fgrid mt">${fld('Claim with the groups', 'groups', { mono: true })}</div><div class="tbl-w mt"><table class="tbl sm"><thead><tr><th>Group in the identity provider</th><th>Role in Mosaikit</th></tr></thead><tbody>${[
              ['Operations-Managers', 'Tenant Manager'],
              ['Staff', 'User · Standard profile'],
              ['*', 'User · View and edit'],
            ]
              .map((r) => `<tr><td class="mono">${r[0]}</td><td>${pill(r[1])}</td></tr>`)
              .join('')}</tbody></table></div><p class="muted small mt">At least one Tenant Manager must come out of the rules: otherwise the configuration is refused.</p>`
          : ''
      }</section>
    <section class="panel mt"><h2>Accounts</h2>${rules([
      ['ok', 'Who is who', 'issuer plus the subject (sub) of the token. Never linked by email: a provider that changes an email does not take another account'],
      ['ok', 'First sign-in', 'creates the account, with this tenant as home; name and email update at every sign-in'],
      ['ok', 'Whoever is disabled in the provider', 'loses the sessions at once with back-channel logout, otherwise at the next check (15 minutes)'],
      ['warn', 'Local accounts already here', 'stay until the Tenant Manager links each one, once, to its identity in the provider: resources and permissions follow'],
      ['ok', 'Off in this tenant', 'creating people with a password and resetting passwords: the provider decides'],
    ])}</section>`
        : `<section class="panel mt"><h2>Local accounts</h2><p class="muted small">Kept by Mosaikit: the platform stores only the hash of the password.</p><dl class="kv"><dt>Password</dt><dd>At least 10 characters, the minimum of the platform</dd><dt>Failed attempts</dt><dd>8 in 15 minutes, then the sign-in of that account or address waits 15 minutes</dd><dt>Who resets a password</dt><dd>The Tenant Manager; the administrator too, from the page of the tenant</dd><dt>Who creates people</dt><dd>The Tenant Manager, with an initial password</dd></dl></section>`
    }
    <section class="panel mt"><div class="panel-h"><div><h2>Guests from other tenants</h2><p class="muted small">People who belong to another tenant and are invited here. They sign in with the method of their home tenant, then switch from the logo at the top; here they only get role and groups.</p></div>${toggle(1)}</div>
      <dl class="kv"><dt>Highest role for a guest</dt><dd>User</dd><dt>Guests now</dt><dd>${x.slug === 'example-city' ? '1 · from Green Region' : 'None'}</dd></dl></section>`;
}
/* Whether a quota of the tenant is its own or the one of the platform for new tenants. */
function qCust(S, x, k) {
  const c = S.tenQc && S.tenQc[x.slug] && S.tenQc[x.slug][k];
  return c != null ? c : x.q[k] !== QDEF[k];
}
/* The plugins available to a tenant, as the administrator sees them on its page: availability changes
   on the page of each plugin (tab Tenants); whether it is on is decided by the Tenant Manager. */
function tenPlugins(S, x) {
  const av = tenFeats(S, x),
    on = x === TENANTS[0] ? mgrFeats(S) : av;
  return `<p class="muted small">The administrator makes a plugin available on its page, tab <i>Tenants</i>; the Tenant Manager of ${x.n} turns it on and decides who gets which permission.</p>
    ${['App', 'Service', 'Extension']
      .map((k) => {
        const list = FEATS.filter((f) => featKind(f) === k);
        return `<h3 class="h3">${k === 'App' ? 'Apps' : k + 's'}</h3><ul class="rows panel">${list
          .map((f) => {
            const mp = MP.concat(MP_CATALOG).find((m) => m.sys === f.k || 'ext:' + m.id === f.k);
            return `<li class="${av[f.k] ? '' : 'off'}"><span class="ri">${ic(f.ic, 15)}</span><div class="rt grow"><b>${f.n}</b><span>${f.ext ? 'Extends ' + FEAT(f.ext).n + ' · ' : ''}${f.d}</span></div>${av[f.k] ? pill(on[f.k] ? 'On' : 'Off: the Tenant Manager turned it off', on[f.k] ? 'ok' : '') : pill('Not available')}${mp ? btn('Open', { go: 'mpmod', res: 'mp:' + mp.id }) : '<span class="muted small">Service of the platform</span>'}</li>`;
          })
          .join('')}</ul>`;
      })
      .join('')}`;
}
function secTenant(S) {
  const x = TENANTS.find((y) => y.slug === (S.resId && S.resId.ten)) || TENANTS[0];
  const e = TEN_EXTRA[x.slug];
  const st = tenSt(S, x);
  const t0 = tabOf(S, 'ten', 'data'),
    t = ['data', 'auth', 'feat'].includes(t0) ? t0 : 'data';
  setSub({ data: 'details', auth: 'sign-in', feat: 'modules' }[t]);
  const tsel = TENANT_SEL.find((y) => y.id === x.slug);
  let body;
  if (t === 'auth') {
    body = `<div data-dirty="tenant">${tenSignIn(S, x, e)}</div>${saveBar(S, 'tenant')}`;
  } else if (t === 'feat') {
    body = tenPlugins(S, x);
  } else {
    const used = tenUsage(S, x),
      q = tenQuota(S, x);
    const qrow = (k) => {
      const own = qCust(S, x, k[0]),
        v = own ? q[k[0]] : QDEF[k[0]];
      return `<li><div class="rt grow"><b>${k[1]}${k[2] ? ' (' + k[2] + ')' : ''}</b><span>Used: ${qText(k[0], used[k[0]], v)}${qPct(used[k[0]], v)}</span></div>
        <input type="number" class="q-in" min="0" value="${v == null ? '' : v}" placeholder="no limit" aria-label="${k[1]}" ${own ? '' : 'disabled'}>
        <span class="inh-w"><span class="inh ${own ? 'cust' : ''}">${ic(own ? 'pencil' : 'refresh', 12)}${own ? 'Of this tenant' : `Of the platform: ${QDEF[k[0]] == null ? 'no limit' : fmtN(QDEF[k[0]])}`}</span>${btn(own ? 'Restore' : 'Customize', { act: 'qcust', v: k[0] })}</span></li>`;
    };
    body = `<div data-dirty="tenant"><section class="panel"><h2>Tenant</h2><div class="fgrid">${fld('Name', x.n, { wide: true })}${fld('Identifier', x.slug, { mono: true, ro: true, hint: 'In the address and in the database: it does not change' })}${fld('Address', x.slug + '.apps.example.org', { mono: true })}${fld('Registration number', e.reg, { mono: true })}${fld('VAT number', e.vat, { mono: true })}${fld('Contact email', e.contact, { type: 'email', wide: true })}</div></section>
    <section class="panel mt"><div class="panel-h"><div><h2>Logo</h2><p class="muted small">Set by the Tenant Manager, in Tenant settings › Identity and appearance: here it is only shown.</p></div>${inhLock('the Tenant Manager')}</div>
      <div class="logos"><div class="logo-p lp-l">${tsel ? tenantLogo(tsel, 30) : `<span class="lgx">${ic('building', 22)}<b>${x.n}</b></span>`}<span class="muted small">on a light background</span></div><div class="logo-p lp-d">${tsel ? tenantLogo(tsel, 30) : `<span class="lgx">${ic('building', 22)}<b>${x.n}</b></span>`}<span class="small">on a dark background</span></div></div></section>
    <section class="panel mt"><h2>Contact person</h2><div class="fgrid">${fld('Full name', x.slug === 'example-city' ? 'Elena Ricci' : 'To be named')}${fld('Email', x.slug === 'example-city' ? 'e.ricci@city.example.org' : '', { type: 'email' })}</div></section>
    <section class="panel mt"><div class="panel-h"><div><h2>Quotas</h2><p class="muted small">A tenant takes the quotas of the platform (System › Quotas) unless it has its own. At the limit nothing is deleted: additions stop. The Tenant Manager reads them in Usage.</p></div></div>
      <ul class="rows qrows">${QUOTA_Q.map(qrow).join('')}</ul></section></div>${saveBar(S, 'tenant')}
    <section class="panel mt danger"><div class="panel-h"><div><h2>Archive the tenant</h2><p class="muted small">Nobody signs in any more; the data stays and the tenant reopens whenever you want.</p></div>${btn('Archive', { icon: 'box', act: 'ask', v: 'tenarch' })}</div>
      <div class="panel-h mt"><div><h2>Delete the tenant</h2><p class="muted small">Everything is deleted in 30 days: until then it can be undone from this page. Guests go back to their home tenant only.</p></div>${btn('Delete the tenant', { icon: 'trash', kind: 'danger', act: 'ask', v: 'tendel' })}</div></section>`;
  }
  const stBanner =
    st === 'Suspended'
      ? `<div class="banner bad">${ic('lock', 18)}<div><b>Tenant suspended.</b> ${TEN_ST.Suspended.d}</div>${btn('Reactivate', { kind: 'pri', act: 'tenst', v: 'Active' })}</div>`
      : st === 'Trial'
        ? trialPanel(S, x)
        : '';
  // The state is a badge next to the name; changing it is in «⋯».
  const more = moreMenu(
    S,
    'tenant',
    Object.keys(TEN_ST)
      .filter((k) => k !== st)
      .map((k) => [
        k === 'Suspended' ? 'lock' : k === 'Trial' ? 'clock' : 'refresh',
        k === 'Suspended' ? 'Suspend' : k === 'Trial' ? 'Put on trial' : 'Make active',
        `data-act="tenst" data-v="${k}"`,
        TEN_ST[k].d,
      ]),
  );
  return detailPage(S, {
    back: ['tenants', 'Back to Tenants'],
    title: x.n,
    badges: stPillT(st),
    sub: `${x.slug} · ${x.users} people · ${tenAuthOf(S, x.slug) === 'oidc' ? 'identity provider (OIDC)' : 'local accounts'}`,
    actions: more,
    tabs: tabs(
      [
        ['data', 'Details'],
        ['auth', 'Sign-in'],
        ['feat', 'Plugins'],
      ],
      t,
      'ten',
    ),
    body: stBanner + body,
  });
}

/* ── People (administrator) ──────────────────────────────────────── */

function secGusers(S) {
  const adm = tabOf(S, 'gus', 'all') === 'adm';
  setSub(adm ? 'administrators' : null);
  return resPage(
    S,
    {
      title: 'People',
      total: '433 people · 437 memberships',
      actions: `<button type="button" class="btn">${ic('download', 15)}<span>Export</span></button>`,
      create: { label: 'New person', act: 'newuser' },
      bulk: {
        key: 'gu',
        ids: PEOPLE.filter((p) => p.ini !== 'GM').map((p) => p.ini),
        acts: [
          ['lock', 'Suspend'],
          ['refresh', 'Reactivate'],
          ['building', 'Add to a tenant'],
          ['mail', 'Send the password link'],
          ['trash', 'Delete the account', 1],
        ],
      },
    },
    filterCol(
      S,
      'gu',
      [
        ['Tenant', TENANTS.map((x) => [x.n, x.users])],
        [
          'Role',
          [
            ['Administrator', 3],
            ['Tenant Manager', 9],
            ['User', 421],
          ],
        ],
        [
          'Signs in with',
          [
            ['Identity provider (OIDC)', 262],
            ['Local account', 171],
          ],
        ],
        [
          'Status',
          [
            ['Active', 417],
            ['Invited', 10],
            ['Suspended', 6],
          ],
        ],
      ],
      {
        search: 'Search by name or email',
        sort: SORT_NAME,
        scopeKey: 'gus',
        scope: [
          ['All', 433, 'all'],
          ['In several tenants', 7, 'multi'],
          ['Administrators', 3, 'adm'],
        ],
      },
    ),
    adm
      ? `<div class="panel-h"><p class="muted small">They configure the platform and do not see the content of tenants. They are accounts of the platform, separate from the accounts in tenants: they sign in from the Administrator access page, always with a local password and the second factor (TOTP). Without phone and recovery codes, another administrator resets the second factor, or the console of the server does.</p>${btn('New administrator', { kind: 'pri', icon: 'plus', act: 'newadmin' })}</div><div class="tbl-w mt"><table class="tbl"><thead><tr><th>Name</th><th>Second factor</th><th>Last sign-in</th><th></th></tr></thead><tbody>${[
          ['PF', 'Paola Ferri', 'p.ferri@platform.example.org', 'Today 08:02', 1],
          ['AM', 'Andrea Moretti', 'a.moretti@platform.example.org', 'Yesterday 18:40', 0],
          ['GB', 'Giorgio Bassi', 'g.bassi@platform.example.org', '28 Sep 2026', 0],
        ]
          .map(
            (a) =>
              `<tr><td><div class="cell-t">${av(a[0], 5, 26)}<div><b>${a[1]}</b><span class="muted small">${a[2]}</span></div></div></td><td>${pill('On', 'ok', 'check')}</td><td class="num muted">${a[3]}</td><td class="r">${a[4] ? '<span class="muted small">that is you</span>' : btn('Disable', { act: 'toast', v: a[1] + ' is disabled: the sessions are closed. At least one administrator always stays active.' })}</td></tr>`,
          )
          .join('')}</tbody></table></div>`
      : `<div class="tbl-w"><table class="tbl"><thead><tr><th class="cbx"><span class="sr">Select</span></th><th>Name</th><th>Home tenant</th><th>Also in</th><th>Role</th><th>Signs in with</th><th>Status</th><th>Last sign-in</th></tr></thead><tbody>
    ${PEOPLE.filter((p) => p.ini !== 'GM')
      .map(
        (p) =>
          `<tr class="clk ${selOf(S, 'gu').includes(p.ini) ? 'picked' : ''}" data-res="person:${p.ini}" data-go="person">${selTd(S, 'gu', p.ini, p.n)}<td><div class="cell-t">${av(p.ini, p.c, 26)}<div><b>${p.n}</b><span class="muted small">${p.mail}</span></div></div></td><td>${personHome(p)}</td><td class="small">${
            personTenants(p)
              .filter((m) => m[0] !== personHome(p))
              .map((m) => m[0])
              .join(', ') || '<span class="muted">—</span>'
          }</td><td>${pill(p.role)}</td><td class="small">${viaLabel(p)}</td><td>${pill(p.st, p.st === 'Active' ? 'ok' : p.st === 'Suspended' ? 'bad' : 'warn')}</td><td class="num muted">${p.last}</td></tr>`,
      )
      .join('')}</tbody></table></div>`,
  );
}

/* ── Plugins ─────────────────────────────────────────────────────────── */

function mpTenants(S, m) {
  const key = m.sys || 'ext:' + m.id;
  return TENANTS.filter((x) => tenFeats(S, x)[key]).length;
}
function mpInstalled(S) {
  return MP.concat(MP_CATALOG.filter((m) => (S.mpInst || []).includes(m.id)));
}
/* The plugin another one extends, by the key of the tenants («notes») or by its id. */
function mpExtends(m) {
  return m.ext ? MP.find((x) => x.id === m.ext || x.sys === m.ext) : null;
}
function mpKind(m) {
  return `<span class="kind-c">${kindPill(m.kind)}${m.sys ? `<span class="muted small">${ic('lock', 11)} Built-in</span>` : ''}</span>`;
}
function secMarketplace(S) {
  const inst = mpInstalled(S),
    cat = MP_CATALOG.filter((m) => !(S.mpInst || []).includes(m.id));
  const upd = inst.filter((m) => m.next && !(S.mpUpd || []).includes(m.id));
  const sc = tabOf(S, 'mpk', 'inst');
  setSub({ inst: 'installed', upd: 'updates', cat: 'catalog' }[sc]);
  const rows = sc === 'upd' ? upd : inst;
  const ext = (m) => (mpExtends(m) ? `<div class="small muted">${ic('puzzle', 11)} Extends ${mpExtends(m).n}</div>` : '');
  const content =
    sc === 'cat'
      ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>Plugin</th><th>Kind</th><th>Version</th><th>Trust</th><th>Publisher</th><th>Requires</th><th></th></tr></thead><tbody>${cat.map((m) => `<tr class="clk" data-res="mp:${m.id}" data-go="mpmod"><td><b>${m.n}</b><div class="small muted">${m.d}</div>${ext(m)}</td><td>${mpKind(m)}</td><td class="num">${m.ver}</td><td>${pill(m.trust, MP_TRUST[m.trust])}</td><td class="small">${m.ed}<div class="muted">${m.repo}</div></td><td class="small">${(m.needs || []).map((k) => FEAT(k).n).join(', ')}</td><td class="r"><button type="button" class="btn pri sm" data-act="mpinstall" data-v="${m.id}">${ic('download', 14)}<span>Install</span></button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">The whole catalog is installed already.</td></tr>'}</tbody></table></div>`
      : `${upd.length ? `<div class="banner warn">${ic('refresh', 18)}<div><b>${upd.length === 1 ? '1 update to apply' : upd.length + ' updates to apply'}.</b> ${upd.map((m) => `${m.n} from ${m.ver} to ${m.next}`).join(' · ')}. Open sessions do not stop: whoever has an app open gets the new version at the next load.</div>${btn('Apply', { kind: 'pri', act: 'mpupdate' })}</div>` : ''}
    <div class="tbl-w"><table class="tbl"><thead><tr><th class="cbx"><span class="sr">Select</span></th><th>Plugin</th><th>Kind</th><th>Version</th><th>Trust</th><th>Available to</th></tr></thead><tbody>${rows.map((m) => `<tr class="clk ${selOf(S, 'mp').includes(m.id) ? 'picked' : ''}" data-res="mp:${m.id}" data-go="mpmod">${selTd(S, 'mp', m.id, m.n)}<td><b>${m.n}</b><div class="mono small muted">${m.id}</div>${ext(m)}</td><td>${mpKind(m)}</td><td class="num">${m.ver}${m.next && !(S.mpUpd || []).includes(m.id) ? ` <span class="small warn-t">→ ${m.next}</span>` : ''}</td><td>${pill(m.trust, MP_TRUST[m.trust])}</td><td class="num">${mpTenants(S, m)} of ${TENANTS.length} tenants</td></tr>`).join('')}</tbody></table></div>`;
  const list = sc === 'cat' ? cat : inst;
  return resPage(
    S,
    {
      title: 'Plugins',
      total: `${inst.length} installed · ${upd.length} to update`,
      create: { label: 'Install from file', act: 'toast', v: 'In the product you pick a signed .mskp package: the platform checks the signature before installing.' },
      bulk:
        sc === 'cat'
          ? null
          : {
              key: 'mp',
              ids: rows.map((m) => m.id),
              acts: [
                ['refresh', 'Update'],
                ['x', 'Disable'],
                ['trash', 'Uninstall', 1],
              ],
            },
    },
    filterCol(
      S,
      'mp',
      [
        ['Kind', ['App', 'Service', 'Extension'].map((k) => [k === 'App' ? 'Apps' : k + 's', list.filter((m) => m.kind === k).length])],
        [
          'Origin',
          [
            ['Built-in', list.filter((m) => m.sys).length],
            ['From the catalog', list.filter((m) => !m.sys).length],
          ],
        ],
        [
          'Trust',
          ['Official', 'Verified', 'Experimental'].map((x) => [x, list.filter((m) => m.trust === x).length]),
        ],
        [
          'Repository',
          ['Mosaikit', 'Acme Labs', 'Green Software', 'Internal'].map((x) => [x, list.filter((m) => m.repo === x).length]),
        ],
      ],
      {
        search: 'Search by name, id or publisher',
        sort: SORT_NAME,
        scopeKey: 'mpk',
        scope: [
          ['Installed', inst.length, 'inst'],
          ['Updates', upd.length, 'upd'],
          ['Catalog', cat.length, 'cat'],
        ],
      },
    ),
    content,
  );
}
function secMpMod(S) {
  const id = S.resId && S.resId.mp;
  const m = MP.concat(MP_CATALOG).find((x) => x.id === id) || MP[0];
  const installed = MP.includes(m) || (S.mpInst || []).includes(m.id);
  const key = m.sys || 'ext:' + m.id;
  const tabsL = [
    ['over', 'Overview'],
    ['asks', 'What it asks'],
  ]
    .concat(m.kind === 'Extension' ? [] : [['ext', 'Extensions']])
    .concat([
      ['ten', 'Tenants'],
      ['conf', 'Configuration'],
    ]);
  const t0 = tabOf(S, 'mpm', 'over');
  const t = tabsL.some((x) => x[0] === t0) ? t0 : 'over';
  setSub({ over: 'overview', asks: 'requests', ext: 'extensions', ten: 'organizations', conf: 'configuration' }[t]);
  const base = mpExtends(m);
  let body;
  if (t === 'asks') {
    body = `<div class="two"><section class="panel"><h2>What it asks of the platform</h2><ul class="feats">${(m.asks.length ? m.asks : ['No access beyond the ones of its plugin']).map((a) => `<li class="on">${ic('key', 15)}<span>${a}</span></li>`).join('')}</ul></section>
      <section class="panel"><h2>What it needs</h2>${(m.needs || []).length ? `<ul class="feats">${m.needs.map((k) => `<li class="on">${ic('check', 15)}<span>${FEAT(k).n}</span><span class="muted small">${featKind(FEAT(k))}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing beyond the platform.</p>'}</section>
      <section class="panel span2"><h2>Permissions it brings to Tenant Managers</h2><p class="muted small">They show in <i>Plugins → Permissions</i> of each tenant, where the Tenant Manager gives them to the whole tenant, to groups or to people.</p>${(m.perms || []).length ? `<div class="gchips">${m.perms.map((p) => `<span class="gchip">${ic('key', 13)}${p}</span>`).join('')}</div>` : '<p class="muted">It uses the permissions it declares in its manifest.</p>'}</section></div>`;
  } else if (t === 'ext') {
    // The extensions of a plugin: the installed ones, and the ones of the catalog to install.
    const mine = (x) => x.ext === m.id || (m.sys && x.ext === m.sys);
    const ins = mpInstalled(S).filter(mine),
      av = MP_CATALOG.filter((x) => mine(x) && !(S.mpInst || []).includes(x.id));
    const row = (x, inst) =>
      `<li><span class="ri">${ic('puzzle', 15)}</span><div class="rt grow"><b>${x.n}</b><span>${x.d} · ${x.ed} · ${x.ver}</span></div>${pill(x.trust, MP_TRUST[x.trust])}${inst ? btn('Open', { go: 'mpmod', res: 'mp:' + x.id }) : `<button type="button" class="btn pri sm" data-act="mpinstall" data-v="${x.id}">${ic('download', 14)}<span>Install</span></button>`}</li>`;
    body = `<p class="muted small">An extension adds fields, actions or tabs to the pages of ${m.n}: it has no pages of its own and needs ${m.n} on in the tenant.</p>
      <section class="panel mt"><h2>Installed <span class="num muted">${ins.length}</span></h2>${ins.length ? `<ul class="rows">${ins.map((x) => row(x, 1)).join('')}</ul>` : `<p class="muted small">No installed extension extends ${m.n}.</p>`}</section>
      <section class="panel mt"><h2>In the catalog <span class="num muted">${av.length}</span></h2>${av.length ? `<ul class="rows">${av.map((x) => row(x, 0)).join('')}</ul>` : '<p class="muted small">Nothing else in the repositories, for now.</p>'}</section>`;
  } else if (t === 'ten') {
    body = `<div class="banner info">${ic('building', 18)}<div><b>Available</b> is decided here, by the administrator. <b>On</b> is decided in each tenant by its Tenant Manager, who also gives the permissions.${m.sys ? ' A built-in plugin is available to new tenants by default.' : ''}</div></div>
        <div class="tbl-w mt"><table class="tbl"><thead><tr><th>Tenant</th><th>Available</th><th>On in the tenant</th></tr></thead><tbody>${TENANTS.map(
          (x) => {
            const av = tenFeats(S, x)[key],
              on = av && (x === TENANTS[0] ? mgrFeats(S)[key] : true);
            return `<tr><td><b>${x.n}</b><div class="small muted">${TEN_ST[tenSt(S, x)].label || tenSt(S, x)}</div></td><td><button type="button" class="tgl" role="switch" data-act="mpten" data-v="${x.slug}" aria-label="${m.n} available to ${x.n}" aria-checked="${!!av}" ${installed ? '' : 'disabled'}><i></i></button></td><td>${av ? pill(on ? 'On' : 'Off', on ? 'ok' : '') : '<span class="muted small">—</span>'}</td></tr>`;
          },
        ).join('')}</tbody></table></div>`;
  } else if (t === 'conf') {
    body =
      m.id === 'time-tracking'
        ? `<section class="panel"><h2>Configuration</h2><div class="fgrid">${fld('Payroll service', 'https://payroll.example.org/api', { mono: true, wide: true })}${fld('Key', '••••••••••', { type: 'password', hint: 'Encrypted, never sent to the browser' })}${fld('Synchronization', 'every hour')}</div></section>`
        : `<section class="panel"><h2>Configuration</h2><p class="muted">This plugin has no platform settings${m.sys ? '' : ': it is configured in each tenant'}.</p></section>`;
  } else {
    body = `<div class="two"><section class="panel"><h2>The plugin</h2><p>${m.d}</p><dl class="kv"><dt>Identifier</dt><dd class="mono">${m.id}</dd><dt>Kind</dt><dd>${mpKind(m)}</dd>${base ? `<dt>Extends</dt><dd><a data-res="mp:${base.id}" data-go="mpmod">${base.n}</a>: it adds to its pages</dd>` : ''}<dt>Publisher</dt><dd>${m.ed}</dd><dt>Repository</dt><dd>${m.repo}</dd><dt>Trust</dt><dd>${pill(m.trust, MP_TRUST[m.trust])}</dd><dt>Origin</dt><dd>${m.sys ? 'Built-in: it updates, it is neither disabled nor uninstalled' : 'From the catalog'}</dd></dl></section>
      <section class="panel"><h2>Versions</h2><dl class="kv"><dt>${installed ? 'Installed' : 'Available'}</dt><dd class="num">${m.ver}</dd>${m.next ? `<dt>New</dt><dd class="num">${m.next}</dd>` : ''}</dl>${m.notes.length ? `<ul class="rows mt">${m.notes.map((n) => `<li><b class="num">${n[0]}</b><span class="muted small">${n[1]}</span></li>`).join('')}</ul>` : '<p class="muted small mt">No release notes.</p>'}</section></div>`;
  }
  // One primary action (install or update); disabling and uninstalling are in «⋯».
  const pri = !installed
    ? btn('Install', { kind: 'pri', icon: 'download', act: 'mpinstall', v: m.id })
    : m.next && !(S.mpUpd || []).includes(m.id)
      ? btn('Update to ' + m.next, { kind: 'pri', icon: 'refresh', act: 'mpupdate', v: m.id })
      : '';
  const more =
    installed && !m.sys
      ? moreMenu(S, 'mp', [
          ['x', 'Disable', 'data-act="ask" data-v="mpoff"', 'It turns off in every tenant; nothing is lost'],
          ['trash', 'Uninstall', 'data-act="ask" data-v="mpdel"', 'It is removed from the platform'],
        ])
      : '';
  return detailPage(S, {
    back: ['marketplace', 'Back to Plugins'],
    title: m.n,
    badges: kindPill(m.kind),
    sub: `${m.sys ? 'Built-in' : 'From the catalog'} · ${m.ed} · version ${m.ver}${installed ? '' : ' · not installed'}${base ? ' · extends ' + base.n : ''}`,
    actions: more + pri,
    tabs: tabs(tabsL, t, 'mpm'),
    body,
  });
}

/* ── Monitoring ───────────────────────────────────────────────────────
   First «is something wrong?» (Status), then why (Performance, Errors), for whom (Tenants),
   how far one can grow (Capacity), and whom to warn (Alerts). */
function monSeries(S, base) {
  const p = S.monPer || '12h',
    n = p === '1h' ? 12 : p === '7d' ? 7 : 12,
    f = p === '7d' ? 1.4 : p === '1h' ? 0.9 : 1;
  return Array.from({ length: n }, (_, i) =>
    Math.round(base * f * (0.6 + 0.4 * Math.sin(i * 0.9 + base) ** 2 + i / (n * 2))),
  );
}
function monLabels(S) {
  const p = S.monPer || '12h';
  return p === '1h'
    ? Array.from({ length: 12 }, (_, i) => i * 5 + '′')
    : p === '7d'
      ? ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']
      : Array.from({ length: 12 }, (_, i) => String((i * 2) % 24).padStart(2, '0'));
}
function secMonitoring(S) {
  const per = S.monPer || '12h',
    perTxt = { '1h': 'last hour', '12h': 'last 12 hours', '7d': 'last 7 days' }[per];
  const sel = MON_SVC.find((s) => s[0] === S.monSel);
  const bad = MON_SVC.filter((s) => s[2] !== 'ok');
  const short = (s) => s[1].replace('Mosaikit ', '').split(' ')[0];
  const parts = [
    [
      'Status',
      'gauge',
      `${bad.length ? `<div class="banner warn">${ic('alert', 18)}<div><b>${bad.length === 1 ? '1 service degraded' : bad.length + ' services degraded'}:</b> ${bad.map((s) => `${s[1]} (${s[3]})`).join(', ')}.</div></div>` : `<div class="banner info">${ic('check', 18)}<div><b>Every service is healthy.</b></div></div>`}
      <div class="tbl-w mt"><table class="tbl"><thead><tr><th>Service</th><th>Status</th><th>Version</th><th class="r">Response p95</th><th class="r">Errors</th><th>Last check</th></tr></thead><tbody>${MON_SVC.map((s) => `<tr class="clk ${S.monSel === s[0] ? 'picked' : ''}" data-act="monsel" data-v="${s[0]}"><td><b>${s[1]}</b><div class="small muted">${s[6]}</div></td><td>${pill(MON_ST[s[2]][0], MON_ST[s[2]][1])}</td><td class="small">${s[3]}</td><td class="r num ${s[4] > 1000 ? 'warn-t' : ''}">${fmtN(s[4])} ms</td><td class="r num ${s[5] > 2 ? 'warn-t' : ''}">${s[5]}%</td><td class="small muted">30 s ago</td></tr>`).join('')}</tbody></table></div>`,
      'status',
    ],
    [
      'Performance',
      'activity',
      `<div class="srcs">${[
        ['Requests per second', 47, ''],
        ['Jobs queued on the worker', 6, 'warn'],
        ['Shared sessions', 11, ''],
      ]
        .map(
          (s) =>
            `<article class="src"><span class="muted small">${s[0]}</span><b class="num big">${s[1]}</b>${spark(monSeries(S, s[1]), s[2])}</article>`,
        )
        .join('')}</div>
      <section class="panel mt"><div class="panel-h"><h2>Response time by service (p95)</h2><span class="muted small">${perTxt}</span></div>${bars(
        MON_SVC.map((s) => s[4]),
        MON_SVC.map(short),
      )}</section>
      <section class="panel mt"><div class="panel-h"><h2>Requests per second</h2><span class="muted small">${perTxt}</span></div>${bars(monSeries(S, 40), monLabels(S))}</section>`,
      'performance',
    ],
    [
      'Errors',
      'alert',
      `<section class="panel"><div class="panel-h"><h2>Error rate by service</h2><span class="muted small">${perTxt}</span></div>${bars(
        MON_SVC.map((s) => Math.max(0.05, s[5])),
        MON_SVC.map(short),
      )}</section>
      <section class="panel mt"><div class="panel-h"><h2>Latest errors</h2>${btn('See in the log', { icon: 'history', act: 'monlog' })}</div><ul class="rows">${[
        [
          'Worker',
          'Time limit exceeded · Monthly report of open tasks',
          'Example City',
          'Yesterday 16:12',
        ],
        ['Keycloak', 'Groups not synchronized · Field team', 'Example City', '6 Oct 08:02'],
        ['Relay', 'Entry refused: identity expired', 'Example City', 'Today 09:40'],
        [
          'Keycloak',
          '5 wrong passwords · account locked 15 minutes',
          'Example City',
          'Today 08:31',
        ],
      ]
        .map(
          (r) =>
            `<li><span class="ri">${ic('alert', 15)}</span><div class="rt"><b>${r[0]}</b><span>${r[1]} · ${r[2]}</span></div><span class="muted small num">${r[3]}</span></li>`,
        )
        .join('')}</ul></section>`,
      'errors',
    ],
    [
      'Tenants',
      'building',
      `<div class="tbl-w"><table class="tbl"><thead><tr><th>Tenant</th><th class="r">Requests/min</th><th class="r">Jobs today</th><th class="r">Errors</th><th>Nearest quota</th></tr></thead><tbody>${TENANTS.map(
        (x) => {
          const w = tenWorst(S, x)[0],
            f = tenSt(S, x) === 'Suspended' ? 0 : x.users / 128;
          return `<tr class="clk" data-res="ten:${x.slug}" data-go="tenant"><td><b>${x.n}</b><div class="small muted">${TEN_ST[tenSt(S, x)].label || tenSt(S, x)}</div></td><td class="r num">${fmtN(Math.round(1400 * f))}</td><td class="r num">${Math.round(42 * f)}</td><td class="r num ${x.slug === 'example-city' ? 'warn-t' : ''}">${x.slug === 'example-city' ? '0.8%' : '0.1%'}</td><td>${pill(`${Q_SHORT[w[0]]} ${w[1] > 900 ? 'used up' : w[1] + '%'}`, qTone(w[1]) === 'ok' ? '' : qTone(w[1]))}</td></tr>`;
        },
      ).join('')}</tbody></table></div>`,
      'organizations',
    ],
    [
      'Capacity',
      'server',
      `<section class="panel"><h2>How much is left</h2><ul class="quota">${[
        ['Database disk', 210, 500, 'GB'],
        ['File storage', 31, 200, 'GB'],
        ['Memory of the instances', 58, 100, '%'],
        ['CPU of the instances', 34, 100, '%'],
        ['Queue of the worker', 6, 20, 'jobs'],
      ]
        .map((c) => {
          const p = Math.round((c[1] / c[2]) * 100),
            tone = qTone(p);
          return `<li><div class="q-l"><b>${c[0]}</b><span class="num ${tone === 'ok' ? 'muted' : tone + '-t'}">${c[3] === '%' ? p + '%' : `${fmtN(c[1])} of ${fmtN(c[2])} ${c[3]} · ${p}%`}</span></div><div class="meter-b q-${tone}"><i style="width:${p}%"></i></div></li>`;
        })
        .join('')}</ul></section>`,
      'capacity',
    ],
    [
      'Alerts',
      'bell',
      `<section class="panel"><div class="panel-h"><div><h2>When to warn</h2><p class="muted small">An alert when the condition lasts longer than the time given; a second one when it is back to normal.</p></div></div>
      <ul class="rows">${[
        ['A service is down', 'for more than 1 minute', 1],
        ['A service answers slowly', 'p95 over 2 seconds for 5 minutes', 1],
        ['Too many errors', 'over 2% for 10 minutes', 1],
        ['Disk or storage almost full', 'over 80%', 1],
        ['Long queue on the worker', 'over 10 jobs for 15 minutes', 0],
        ['A tenant over a quota', 'once per tenant and quota', 1],
      ]
        .map(
          (a) =>
            `<li><div class="rt grow"><b>${a[0]}</b><span>${a[1]}</span></div>${toggle(a[2])}</li>`,
        )
        .join('')}</ul></section>
      <section class="panel mt"><h2>Who gets them</h2><div class="gchips">${['The administrators of the platform', 'Paola Ferri', 'on-call@platform.example.org'].map((g) => `<span class="gchip">${ic(g.includes('@') ? 'mail' : g.startsWith('The') ? 'key' : 'user', 13)}${g}<button type="button" aria-label="Remove ${g}">${ic('x', 12)}</button></span>`).join('')}<button type="button" class="gchip add">${ic('plus', 13)}Add</button></div>
        <div class="fgrid mt"><label class="lbl">How<select><option>Notification and email</option><option>Only email</option><option>Webhook (for example a chat channel)</option></select></label></div></section>`,
      'alerts',
    ],
  ];
  const nav = secNav(S, 'mon', parts);
  const detail =
    sel && nav.cur === 0
      ? `<aside class="preview" aria-label="Detail of ${sel[1]}"><button type="button" class="btn pv-close" data-act="monsel" data-v="${sel[0]}" aria-label="Close the detail" title="Close the detail">${ic('x', 15)}</button>
      <h2>${sel[1]}</h2><p>${pill(MON_ST[sel[2]][0], MON_ST[sel[2]][1])} <span class="muted small">${sel[6]}</span></p>
      <dl class="kv"><dt>Version</dt><dd>${sel[3]}</dd><dt>Response p95</dt><dd>${fmtN(sel[4])} ms</dd><dt>Errors</dt><dd>${sel[5]}%</dd><dt>Up for</dt><dd>12 days</dd></dl>
      <section class="mt"><b class="small">Response time · ${perTxt}</b>${spark(monSeries(S, sel[4]), sel[2] === 'ok' ? '' : 'warn')}</section>
      <ul class="rows mt">${['30 s ago · answers', '1 min ago · answers', '1 min 30 s ago · answers'].map((c) => `<li><i class="dot ${sel[2]}"></i><span class="small">${c}</span></li>`).join('')}</ul>
      <div class="pv-a">${btn('See the errors', { icon: 'alert', act: 'monlog' })}</div></aside>`
      : '';
  return detailPage(S, {
    title: 'Monitoring',
    sub: `${bad.length ? bad.length + ' service degraded' : 'Everything healthy'} · data of 30 seconds ago · ${perTxt}`,
    actions: `<div class="seg" role="group" aria-label="Period">${[
      ['1h', '1 h'],
      ['12h', '12 h'],
      ['7d', '7 d'],
    ]
      .map(
        (p) =>
          `<button type="button" class="btn ${per === p[0] ? 'on' : ''}" data-act="monper" data-v="${p[0]}" aria-pressed="${per === p[0]}"><span>${p[1]}</span></button>`,
      )
      .join('')}</div>`,
    body: nav.body,
    side: nav.side,
    sideNav: true,
    aside: detail,
  });
}

/* ── Keys of outside services, at three levels ────────────────────────
   Whoever has a key of their own uses it; otherwise the one of the tenant, if the Tenant Manager
   shares it; otherwise the one of the platform, if shared. */
function keyUse(S, lvl, id) {
  const K = S.keys,
    sy = K.sys[id],
    tn = K.tnt[id],
    me = K.me[id];
  if (lvl === 'sys')
    return sy
      ? sy.share
        ? ['ok', 'Used by every tenant without a key of its own']
        : ['warn', 'Only for the platform: tenants must add a key of their own']
      : ['off', 'The service is off for whoever has no key of their own'];
  if (lvl === 'tnt')
    return tn
      ? tn.share
        ? ['ok', 'Used by every person of the tenant']
        : [
            'warn',
            `Used only by Tenant Managers; people use ${sy && sy.share ? 'the key of the platform' : 'a key of their own'}`,
          ]
      : sy && sy.share
        ? ['ok', 'In use: the key of the platform']
        : ['off', 'No key: the service is off for the tenant'];
  return me
    ? ['ok', 'In use: your key']
    : tn && tn.share
      ? ['ok', 'In use: the key of the tenant']
      : sy && sy.share
        ? ['ok', 'In use: the key of the platform']
        : ['off', 'No key available: to use it, add your own'];
}
function keyRows(S, lvl) {
  const shareLbl =
    lvl === 'sys'
      ? 'Shared with every tenant'
      : lvl === 'tnt'
        ? 'Shared with the people of the tenant'
        : '';
  return KEY_GROUPS.map(
    (g) =>
      `<h3 class="key-g">${g[1]}</h3><ul class="rows keys">${KEY_SVC.filter((s) => s[2] === g[0])
        .map((s) => {
          const k = S.keys[lvl][s[0]],
            u = keyUse(S, lvl, s[0]),
            ed = S.keyEdit === lvl + ':' + s[0];
          const val = k
            ? s[5]
              ? `<span class="mono small">${s[5]}</span>`
              : `<span class="mono small">••••••••${k.tail}</span>`
            : '';
          return `<li class="key-r"><span class="ri">${ic(s[3], 15)}</span><div class="rt grow"><b>${s[1]}</b><span>${s[4]}</span><span class="key-u ku-${u[0]}">${ic(u[0] === 'ok' ? 'check' : u[0] === 'warn' ? 'alert' : 'x', 12)}${u[1]}</span>
        ${ed ? `<div class="key-ed"><input type="${s[5] ? 'text' : 'password'}" class="mono" aria-label="${s[5] ? 'Address' : 'Key'} for ${s[1]}" placeholder="${s[5] ? 'http://server:11434' : 'Paste the key'}" value="${s[5] && k ? s[5] : ''}">${btn('Cancel', { icon: 'undo', act: 'keyedit', v: lvl + ':' + s[0] })}${btn('Save', { kind: 'pri', icon: 'save', act: 'keysave', v: lvl + ':' + s[0] })}</div>` : ''}</div>
      <div class="key-v">${val}${k && shareLbl ? `<label class="key-sh"><span>${shareLbl}</span><button type="button" class="tgl" role="switch" aria-label="${shareLbl}" aria-checked="${!!k.share}" data-act="keyshare" data-v="${lvl}:${s[0]}"><i></i></button></label>` : ''}</div>
      <div class="key-a">${ed ? '' : k ? btn('', { icon: 'pencil', act: 'keyedit', v: lvl + ':' + s[0] }).replace('<button', `<button aria-label="Change the key of ${s[1]}" title="Change"`) + btn('', { icon: 'trash', act: 'keydel', v: lvl + ':' + s[0] }).replace('<button', `<button aria-label="Remove the key of ${s[1]}" title="Remove"`) : btn(s[5] ? 'Set' : 'Add', { icon: 'plus', act: 'keyedit', v: lvl + ':' + s[0] })}</div></li>`;
        })
        .join('')}</ul>`,
  ).join('');
}
function keysSection(S, lvl) {
  const intro =
    lvl === 'sys'
      ? 'The keys of the services the platform pays for. A shared key is used by every tenant without one of its own; a key not shared stays with the platform.'
      : lvl === 'tnt'
        ? 'The keys the tenant pays for. A shared key is used by every person of the tenant; one not shared only by Tenant Managers. Where the tenant has no key, the one of the platform applies, if the administrator shares it.'
        : 'Your keys apply only to you and nobody else sees them. Where you have none, you use the one of the tenant or of the platform, if shared.';
  return `<section class="panel"><h2>Keys of outside services</h2><p class="muted small">${intro}</p>${keyRows(S, lvl)}
    <p class="muted small mt">${ic('lock', 12)} Keys are kept encrypted and never go back to the browser: after saving, only the last four characters show.</p></section>
    ${
      lvl === 'sys'
        ? `<section class="panel mt"><h2>AI assistant</h2><div class="fgrid">${fld('Default model', 'default-large', { mono: true })}</div><p class="muted small mt">AI credits come from the quotas of each tenant and are counted in its Usage: with the key of the platform credits are consumed, with a key of the tenant or of the person they are not.</p></section>`
        : lvl === 'tnt'
          ? `<p class="muted small mt">${ic('gauge', 12)} The AI credits of the tenant show in <a data-go="usage">Usage</a>: with a key of the tenant they are not consumed.</p>`
          : ''
    }`;
}

/* ── Appearance, at three levels ──────────────────────────────────────
   Platform (administrator): the defaults of everybody and the themes available. Tenant
   (Tenant Manager): the defaults of the tenant, among the ones the platform offers. Person
   (Appearance menu at the top): mode, language and sidebar for oneself. */
function sidePrefs(S, lvl) {
  const me = !lvl || lvl === 'me';
  const side = me ? S.side : S.app[lvl].side,
    labels = me ? S.sideLabels : S.app[lvl].labels;
  const open = side === 'open';
  const attrs = (v) =>
    me
      ? `data-act="sidemode" data-v="${v}"`
      : `data-act="appset" data-lvl="${lvl}" data-k="side" data-v="${v}"`;
  const opt = (v, tt, s) =>
    `<label class="th sp-o ${side === v ? 'sel' : ''}"><input type="radio" name="side-${lvl || 'me'}" ${attrs(v)} ${side === v ? 'checked' : ''}><span class="sp-p sp-${v}${v === 'mini' && labels ? ' lab' : ''}" aria-hidden="true"><i></i><i></i><i></i></span><b>${tt}</b><span class="muted small">${s}</span></label>`;
  return `<section class="panel"><h2>Sidebar</h2>
    <div class="themes sp">${opt('mini', 'Icons', 'Compact, 65 px')}${opt('open', 'Open', 'Icons and labels, 240 px')}</div>
    <ul class="rows"><li><div class="rt grow"><b>Labels under the icons</b><span>${open ? 'Only with the icon sidebar' : 'Instead of the tips on mouse over'}</span></div>
      <button type="button" class="tgl" role="switch" ${me ? 'data-act="sidelabels"' : `data-act="appset" data-lvl="${lvl}" data-k="labels"`} aria-label="Labels under the icons" aria-checked="${!!labels}" ${open ? 'disabled' : ''}><i></i></button></li></ul></section>`;
}
function themeSwatch(p, dark) {
  const v = dark ? p.dark : p.light;
  return `<span class="sw-prev"><i style="background:${v.navGrad || v.nav[0]}"></i><i style="background:${v.side[0]}"></i><i style="background:${v.content}"><b style="background:${v.accent[0]}"></b></i></span>`;
}
function themeCards(S, lvl) {
  const sys = lvl === 'sys',
    L = S.app[lvl];
  const own = (c) => S.customThemes.find((x) => x.id === c.id);
  const list = PRESETS.filter((p) =>
    sys
      ? !own(p) || own(p).scope === 'sys'
      : S.app.sys.themes.includes(p.id) || (own(p) && own(p).scope === 'tnt'),
  );
  return `<div class="tgrid">${list
    .map((p) => {
      const c = own(p),
        avail = S.app.sys.themes.includes(p.id) || (c && c.scope === 'tnt'),
        on = L.theme === p.id;
      return `<div class="tgc ${on ? 'sel' : ''} ${sys && !avail ? 'off' : ''}">
      <button type="button" class="tgc-main" data-act="appset" data-lvl="${lvl}" data-k="theme" data-v="${p.id}" aria-pressed="${on}" ${sys && !avail ? 'disabled' : ''}>
        <span class="tgc-th"><span class="tr-m">${themeSwatch(p, false)}<em>light</em></span><span class="tr-m">${themeSwatch(p, true)}<em>dark</em></span></span>
        <span class="tgc-t"><b>${p.name}</b>${on ? ic('check', 16) : ''}</span><span class="muted small">${on ? 'Default' : c ? (c.scope === 'sys' ? 'Of the platform' : 'Of the tenant') : 'Of Mosaikit'}</span></button>
      <div class="tr-a">${sys ? `<label class="tc-av"><input type="checkbox" class="pchk" data-act="appthemeav" data-v="${p.id}" ${avail ? 'checked' : ''} ${on ? 'disabled' : ''}> Available to tenants</label>` : ''}${c ? `<button type="button" class="btn sm" data-act="teedit" data-v="${p.id}">${ic('sliders', 14)}<span>Edit</span></button>` : ''}</div></div>`;
    })
    .join('')}</div>`;
}
function modeOpts(S, lvl) {
  const cur = lvl === 'me' ? S.mode : S.app[lvl].mode;
  return `<div class="tm-modes" role="radiogroup" aria-label="Mode">${MODES.map((m) => `<button type="button" role="radio" aria-checked="${cur === m[0]}" ${lvl === 'me' ? `data-mode="${m[0]}"` : `data-lvlmode="${lvl}" data-v="${m[0]}"`}>${ic(m[2], 16)}<span>${m[1]}</span></button>`).join('')}</div>`;
}
function langList(S, lvl) {
  const L = S.app[lvl],
    allowed = lvl === 'tnt' ? S.app.sys.langs : LANGS.map((l) => l[0]);
  return `<div class="fgrid"><label class="lbl">Default language<select data-applangdef="${lvl}">${LANGS.filter(
    (l) => L.langs.includes(l[0]),
  )
    .map((l) => `<option value="${l[0]}" ${L.lang === l[0] ? 'selected' : ''}>${l[1]}</option>`)
    .join('')}</select></label></div>
    <div class="langs">${LANGS.map((l) => {
      const ok = allowed.includes(l[0]),
        on = L.langs.includes(l[0]);
      return `<label class="lang-c ${ok ? '' : 'off'}"><input type="checkbox" class="pchk" data-act="applang" data-lvl="${lvl}" data-v="${l[0]}" ${on && ok ? 'checked' : ''} ${!ok || L.lang === l[0] ? 'disabled' : ''}><span class="mono">${l[0].toUpperCase()}</span><span>${l[1]}</span>${ok ? '' : '<em class="muted small">not in the platform</em>'}</label>`;
    }).join('')}</div>`;
}
const FORMATS =
  '<div class="fgrid"><label class="lbl">Dates<select><option>8 Oct 2026</option><option>2026-10-08</option><option>10/08/2026</option></select></label><label class="lbl">Numbers<select><option>1,234.5</option><option>1.234,5</option></select></label><label class="lbl">Time zone<select><option>Europe/Rome</option><option>UTC</option></select></label><label class="lbl">Units<select><option>Metric</option><option>Imperial</option></select></label></div>';
function appearancePage(S, lvl) {
  const sys = lvl === 'sys',
    tn = TENANT_SEL[0];
  const L = S.app[lvl];
  const f = (k, label, o) => {
    const x = o || {};
    return `<label class="lbl ${x.wide ? 'span2' : ''}">${label}<input type="text" data-appf="${lvl}:${k}" value="${(L[k] || '').replace(/"/g, '&quot;')}" ${x.mono ? 'class="mono"' : ''}>${x.hint ? `<span class="hint">${x.hint}</span>` : ''}</label>`;
  };
  const showName = `<ul class="rows"><li><div class="rt grow"><b>The name next to the logo, in the top band</b><span>If the logo already contains the name, it can be turned off</span></div><button type="button" class="tgl" role="switch" data-act="appset" data-lvl="${lvl}" data-k="showName" data-toggle="1" aria-label="Name next to the logo" aria-checked="${!!L.showName}"><i></i></button></li></ul>`;
  const id = sys
    ? `<section class="panel"><h2>Identity of the platform</h2><div class="fgrid">${f('name', 'Name of the platform', { wide: true, hint: 'In the title of the browser tab, on the sign-in page and in emails' })}</div>
       <div class="logos mt"><div class="logo-p lp-l"><span class="lgx">${brandMark(30)}${L.showName ? `<b>${L.name}</b>` : ''}</span><span class="muted small">on a light background</span></div><div class="logo-p lp-d"><span class="lgx">${brandMark(30)}${L.showName ? `<b>${L.name}</b>` : ''}</span><span class="small">on a dark background</span></div></div>
       <div class="row mt">${btn('Logo for light backgrounds', { icon: 'upload' })}${btn('Logo for dark backgrounds', { icon: 'upload' })}</div>${showName}
       <div class="favi mt"><div><b>Browser icon</b><span class="muted small">The small icon in the browser tab and on the phone, when the platform is added to the home screen.</span></div>
         <div class="favi-p"><span class="favi-tab">${brandMark(14)}${L.name} · Home<span class="muted">×</span></span></div>${btn('Upload the icon', { icon: 'upload' })}</div>
       <p class="muted small mt">The address of the platform shows in <a data-act="sysgo" data-v="1">System › Addresses</a>: it is not a matter of appearance.</p></section>`
    : `<section class="panel"><h2>Identity of the tenant</h2><div class="fgrid">${f('name', 'Name of the tenant', { wide: true, hint: 'On the sign-in page of the tenant, in the title of the tab and in the emails sent for the tenant' })}</div>
       <div class="logos mt"><div class="logo-p lp-l">${L.showName ? tenantLogo(tn, 30) : crest(tn, 30)}<span class="muted small">on a light background</span></div><div class="logo-p lp-d">${L.showName ? tenantLogo(tn, 30) : crest(tn, 30)}<span class="small">on a dark background</span></div></div>
       <div class="row mt">${btn('Logo for light backgrounds', { icon: 'upload' })}${btn('Logo for dark backgrounds', { icon: 'upload' })}</div>${showName}
       <p class="muted small mt">The address (<span class="mono">${tn.id}.apps.example.org</span>) is changed by the administrator of the platform.</p></section>`;
  const loginPrev = (who, logo) =>
    `<div class="lgp"><div class="lgp-card">${logo}<b class="lgp-h">Sign in to ${who}</b><span class="lgp-w">${L.welcome}</span><span class="lgp-in"></span><span class="lgp-btn">Continue</span><span class="lgp-l">Privacy · Legal notes</span></div></div>`;
  let extra;
  if (sys) {
    extra = `<section class="panel"><h2>Sign-in page</h2><p class="muted small">It is the first page one sees: the list of the tenants (hidden when there is only one) and the link to the Administrator access. An address that names a tenant (<span class="mono">#/login/&lt;tenant&gt;</span>) opens it with the tenant already chosen.</p>
        <div class="lg-split mt"><div class="fgrid one">${f('welcome', 'Welcome text')}${f('privacy', 'Privacy notice', { mono: true })}${f('legal', 'Legal notes', { mono: true })}<div>${btn('Background image', { icon: 'upload' })}</div></div>
          ${loginPrev(L.name, `<span class="lgx">${brandMark(26)}<b>${L.name}</b></span>`)}</div></section>
      <section class="panel"><h2>Formats</h2>${FORMATS}</section>`;
  } else {
    const kinds = [
      ['home', 'Home'],
      ['app', 'An app'],
    ];
    const app = APPS.find((a) => a.id === L.landId) || APPS[0];
    extra = `<section class="panel"><h2>Landing page</h2><p class="muted small">Where whoever enters the tenant arrives. Whoever cannot open the chosen app arrives at Home.</p>
        <div class="lg-split mt"><div class="fgrid one"><label class="lbl">After sign-in one arrives at<select data-appf="tnt:land">${kinds.map((k) => `<option value="${k[0]}" ${L.land === k[0] ? 'selected' : ''}>${k[1]}</option>`).join('')}</select></label>
          ${L.land === 'app' ? `<label class="lbl">Which app<select data-appf="tnt:landId">${APPS.map((x) => `<option value="${x.id}" ${app.id === x.id ? 'selected' : ''}>${x.n}</option>`).join('')}</select></label>` : ''}</div>
          <div class="land-p"><div class="land-ic">${ic(L.land === 'app' ? app.ic : 'home', 30)}</div><span class="small">${L.land === 'app' ? app.n : 'Home'}</span></div></div></section>
      <section class="panel"><h2>Welcome and legal notes</h2><p class="muted small">The welcome shows on top of everybody's Home; privacy and legal notes on the sign-in page of the tenant and at the foot of Account › Profile.</p>
        <div class="lg-split mt"><div class="fgrid one">${f('welcome', 'Welcome text')}${f('privacy', 'Privacy notice', { mono: true })}${f('legal', 'Legal notes', { mono: true })}</div>${loginPrev(L.name, crest(tn, 28))}</div></section>
      <section class="panel"><div class="panel-h"><div><h2>Formats</h2><p class="muted small">Dates, numbers, time zone and units</p></div><label class="tc-av"><input type="checkbox" class="pchk" data-act="appset" data-lvl="tnt" data-k="fmtSame" data-toggle="1" ${L.fmtSame ? 'checked' : ''}> Like the platform</label></div>
        ${L.fmtSame ? '<p class="muted small">The tenant uses the formats of the platform: 8 Oct 2026, 1,234.5, Europe/Rome, metric.</p>' : FORMATS + '<p class="muted small mt">They apply only to this tenant, instead of the ones of the platform.</p>'}</section>`;
  }
  // The platform says, setting by setting, whether tenants may customize it; the tenant sees the mark.
  const C = S.app.sys.cust;
  const mark = (key) =>
    sys
      ? `<label class="tc-av"><input type="checkbox" class="pchk" data-act="syscust" data-v="${key}" ${C[key] ? 'checked' : ''}> Tenants may customize it</label>`
      : inhCust(S, key, !C[key]);
  const lock = (key, html) => (sys || C[key] ? html : `<div class="is-locked" inert>${html}</div>`);
  const theme = `<section class="panel th-sec"><div class="panel-h th-h"><div><h2>Default theme</h2><p class="muted small">${sys ? 'Choose the theme of everybody, and which themes tenants may use.' : 'Among the themes the platform offers, plus the ones of the tenant.'} It shows at once, as a preview.</p></div><div class="row">${mark('theme')}${sys || C.theme ? btn('New theme', { kind: 'pri', icon: 'plus', act: 'tenew' }) : ''}</div></div>${lock('theme', themeCards(S, lvl))}</section>`;
  const mode = `<section class="panel"><div class="panel-h"><h2>Default mode</h2>${mark('mode')}</div>${lock('mode', modeOpts(S, lvl))}<p class="muted small mt">Everybody can change it for themselves, in Account › Appearance and language${bar().mode ? ' or from the palette at the top' : ''}.</p></section>`;
  const side = sidePrefs(S, lvl).replace('<h2>Sidebar</h2>', `<div class="panel-h"><h2>Sidebar</h2>${mark('side')}</div>`);
  const langs = `<section class="panel"><div class="panel-h"><div><h2>Languages</h2><p class="muted small">${sys ? 'The languages the platform offers: tenants pick a subset.' : 'A subset of the ones of the platform. Everybody picks theirs among these.'}</p></div>${sys ? '' : inhLimit('A subset of the languages of the platform')}</div>${langList(S, lvl)}</section>`;
  const fmts = sys
    ? `<section class="panel"><div class="panel-h"><div><h2>Formats</h2><p class="muted small">Dates, numbers, time zone and units</p></div>${mark('fmt')}</div>${FORMATS}</section>`
    : `<section class="panel"><div class="panel-h"><div><h2>Formats</h2><p class="muted small">Dates, numbers, time zone and units</p></div>${mark('fmt')}</div>
        ${S.cust && S.cust.fmt ? FORMATS + '<p class="muted small mt">They apply only to this tenant, instead of the ones of the platform.</p>' : '<p class="muted small">The tenant uses the formats of the platform: 8 Oct 2026, 1,234.5, Europe/Rome, metric.</p>'}</section>`;
  const B = bar();
  const p = PRESETS.find((x) => x.id === S.preset) || PRESETS[0],
    v = isDark() ? p.dark : p.light;
  const topbar = `<section class="panel"><div class="panel-h"><div><h2>Top bar</h2><p class="muted small">What the band at the top shows, for everybody in every tenant. Decided here only: tenants do not change it.</p></div></div>
      <div class="barprev" style="background:${v.navGrad || v.nav[0]};color:${v.nav[1]}" role="img" aria-label="Preview of the top bar"><span class="bp-c">${B.logo ? brandMark(18) + '<b>' + S.app.sys.name + '</b>' : ic('sidebar', 16)}</span><span class="bp-l">${B.logo ? ic('sidebar', 16) : ''}<b>Example City</b>${ic('down', 12)}</span>${B.search ? `<span class="bp-s" style="background:${(v.navInput || [v.nav[4]])[0]};color:${(v.navInput || [0, v.nav[3]])[1]}">${ic('search', 12)}Search everything</span>` : '<span class="grow"></span>'}<span class="bp-r">${B.lang ? '<b>EN</b>' : ''}${B.mode ? ic('contrast', 15) : ''}${B.help ? ic('help', 15) : ''}${ic('bell', 15)}<span class="av av2" style="--s:22px">ER</span></span></div>
      <ul class="rows mt">${[
        ['logo', 'Logo and name of the application', 'Off: the button of the sidebar takes the corner, on the phone too'],
        ['search', 'Search', 'Off: the field and Ctrl K go away; the search inside the pages stays'],
        ['lang', 'Language', 'Off: each person picks it in Account › Appearance and language. With one language it never shows'],
        ['help', 'Help', 'Off: the guided tour, the guide and what is new go to the menu of the person'],
        ['mode', 'Mode: light, dark, automatic', 'Off: the default mode applies; each person changes it in Account'],
      ]
        .map((r) => `<li><div class="rt grow"><b>${r[1]}</b><span>${r[2]}</span></div><button type="button" class="tgl" role="switch" data-act="barset" data-v="${r[0]}" aria-label="${r[1]}" aria-checked="${!!B[r[0]]}"><i></i></button></li>`)
        .join('')}</ul>
      <p class="muted small mt">Always there: the bell, the menu of the person and, for whoever works in more than one tenant, the switcher of the tenant.</p></section>`;
  const blocks = {
    identity: [id].concat(extra.split(/(?=<section class="panel)/).filter((x) => x.trim() && !/<h2>Formats<\/h2>/.test(x))),
    theme: [theme, mode, side],
    languages: [langs, fmts],
    topbar: [topbar],
  };
  const tl = [
    ['identity', 'Identity and texts'],
    ['theme', 'Theme and mode'],
    ['languages', 'Languages and formats'],
  ].concat(sys ? [['topbar', 'Top bar']] : []);
  const cur = tl.some((x) => x[0] === tabOf(S, 'idt', 'identity')) ? tabOf(S, 'idt', 'identity') : 'identity';
  return [
    'Identity and appearance',
    'palette',
    `<div class="idt">${tabs(tl, cur, 'idt')}</div><div class="stack-s mt">${blocks[cur].join('')}</div>`,
    cur,
  ];
}
/* Where the Theme section is, to go back to it from the editor: section, then the tab Theme. */
const THEME_TAB = { admin: ['system', 'sys', '8'], manager: ['config', 'cfg', '4'] };
/* The permission profiles are a section of Manage. */
const PROF_TAB = ['members', 'mem', 'prof'];
function myAppearance(S) {
  const avl = S.role === 'admin' ? S.app.sys.langs : S.app.tnt.langs;
  return `<div class="app-cols"><div class="app-col"><section class="panel"><h2>Mode</h2>${modeOpts(S, 'me')}
      <ul class="rows mt"><li><div class="rt grow"><b>High contrast</b><span>Sharper colours, for whoever reads with effort</span></div><button type="button" class="tgl" role="switch" data-act="hc" aria-label="High contrast" aria-checked="${!!S.hc}"><i></i></button></li></ul></section>
    <section class="panel"><h2>Language</h2><div class="fgrid"><label class="lbl">Language of the interface<select data-melang>${LANGS.filter(
      (l) => avl.includes(l[0]),
    )
      .map((l) => `<option value="${l[0]}" ${S.lang === l[0] ? 'selected' : ''}>${l[1]}</option>`)
      .join(
        '',
      )}</select><span class="hint">${S.role === 'admin' ? 'Among the languages of the platform' : 'Among the languages your tenant chose'}</span></label></div></section></div>
    <div class="app-col">${sidePrefs(S, 'me')}${bar().mode ? '<p class="muted small">Mode and contrast are also at hand in the palette of the top band.</p>' : ''}</div></div>`;
}

/* ── Theme editor ─────────────────────────────────────────────────────
   Whoever is not technical picks three things: the main colour, the style of the top band, the
   greys. The generator computes the rest, light and dark; the contrast check (WCAG) says whether it
   reads, and if not it does not let one save. */
function teLogo(S) {
  return S.te && S.te.scope === 'tnt' ? TENANT_SEL[0].fill : '#ffffff';
}
function teProposals(S) {
  return S.te.scope === 'tnt'
    ? [
        { accent: '#1f4e79', bar: 'color', grays: 'cool' },
        { accent: '#1f4e79', bar: 'light', grays: 'neutral' },
        { accent: '#9a6a00', bar: 'dark', grays: 'warm' },
      ]
    : [
        { accent: '#5b5fc7', bar: 'color', grays: 'neutral' },
        { accent: '#0b7285', bar: 'gradient', grays: 'cool' },
        { accent: '#5b5fc7', bar: 'light', grays: 'cool' },
      ];
}
function themePreview(p, dark, logoTxt) {
  const v = dark ? p.dark : p.light;
  return `<div class="tp" aria-label="Preview in ${dark ? 'dark' : 'light'}">
    <div class="tp-band" style="background:${v.navGrad || v.nav[0]};color:${v.nav[1]}"><b>${logoTxt}</b><span class="tp-search" style="background:${(v.navInput || [v.nav[4]])[0]};color:${(v.navInput || [0, v.nav[3]])[1]}">Search everything</span></div>
    <div class="tp-body"><div class="tp-side" style="background:${v.side[0]}"><i style="background:${v.side[3]}"></i><i class="on" style="background:${v.side[7]}"></i><i style="background:${v.side[3]}"></i></div>
      <div class="tp-main" style="background:${v.content};color:${v.side[1]}"><b>Notes</b><span style="color:${v.accent[0]}">Weekly team sync</span><div class="tp-card" style="background:${v.pane || v.side[0]}"></div><span class="tp-btn" style="background:${v.accent[0]};color:${v.accent[2]}">New note</span></div></div></div>`;
}
function secThemeEdit(S) {
  setSub(null);
  if (!S.te)
    S.te = {
      name: '',
      accent: '#5b5fc7',
      bar: 'color',
      grays: 'neutral',
      adv: {},
      scope: S.role === 'admin' ? 'sys' : 'tnt',
    };
  const T = S.te,
    p = makePreset(T),
    checks = themeChecks(p, T.scope === 'tnt' ? teLogo(S) : null),
    bad = checks.filter((c) => c[1] < c[2]);
  const back = S.role === 'admin' ? ['system', 'Back to System'] : ['config', 'Back to Settings'];
  const sw = [
    '#5b5fc7',
    '#0066cc',
    '#0b7285',
    '#15803d',
    '#1f4e79',
    '#c2410c',
    '#9a6a00',
    '#7c3aed',
    '#be185d',
    '#334155',
  ];
  const radio = (k, v, label) =>
    `<label class="opt ${T[k] === v ? 'sel' : ''}"><input type="radio" name="te-${k}" data-act="teset" data-k="${k}" data-v="${v}" ${T[k] === v ? 'checked' : ''}><b>${label}</b></label>`;
  const logoTxt = T.scope === 'tnt' ? 'Example City' : 'Mosaikit';
  return detailPage(S, {
    back,
    title: T.id ? 'Edit the theme' : 'New theme',
    sub: `${T.scope === 'sys' ? 'For the whole platform' : 'For Example City'} · you pick the colour, the platform computes the rest`,
    actions:
      btn('Cancel', { icon: 'undo', go: back[0] }) +
      `<button type="button" class="btn pri" data-act="tesave" ${bad.length ? 'disabled' : ''} aria-label="Save" title="${bad.length ? 'Fix the contrast first' : 'Save the theme'}">${ic('save', 15)}<span>Save</span></button>`,
    body: `<div class="te"><div class="te-c">
      <section class="panel"><label class="lbl">Name of the theme<input type="text" data-te-name value="${(T.name || '').replace(/"/g, '&quot;')}" placeholder="${T.scope === 'tnt' ? 'Example City' : 'Theme of the platform'}"></label></section>
      <section class="panel"><div class="panel-h"><h2>From the logo</h2>${btn('Propose from the logo', { icon: 'spark', act: 'telogo' })}</div>
        ${
          T.props
            ? `<div class="te-props">${teProposals(S)
                .map(
                  (o, i) =>
                    `<button type="button" class="te-prop" data-act="tepick" data-v="${i}">${themeSwatch(makePreset(o), false)}<span class="small">${{ color: 'Coloured band', light: 'Light band', dark: 'Dark band', gradient: 'Gradient band' }[o.bar]}</span></button>`,
                )
                .join('')}</div>`
            : `<p class="muted small">The platform reads the colours of the logo and proposes three themes.</p>`
        }</section>
      <section class="panel"><h2>Main colour</h2><div class="te-sw">${sw.map((c) => `<button type="button" class="te-dot ${T.accent === c ? 'on' : ''}" style="background:${c}" data-act="teset" data-k="accent" data-v="${c}" aria-label="Colour ${c}" title="${c}"></button>`).join('')}<label class="te-pick" title="Another colour"><input type="color" data-te="accent" value="${T.accent}" aria-label="Another colour"></label></div></section>
      <section class="panel"><h2>Top band</h2><div class="opts te-opts">${radio('bar', 'color', 'Coloured')}${radio('bar', 'dark', 'Dark')}${radio('bar', 'light', 'Light')}${radio('bar', 'gradient', 'Gradient')}</div></section>
      <section class="panel"><h2>Greys</h2><div class="opts te-opts">${radio('grays', 'neutral', 'Neutral')}${radio('grays', 'warm', 'Warm')}${radio('grays', 'cool', 'Cool')}</div></section>
      <details class="panel te-adv"><summary><b>Advanced</b> <span class="muted small">the single colours, for whoever knows what changes</span></summary>
        <div class="te-advg">${[
          ['accL', 'Main, light', p.light.accent[0]],
          ['accD', 'Main, dark', p.dark.accent[0]],
          ['barL', 'Top band, light', p.light.nav[0]],
          ['barD', 'Top band, dark', p.dark.nav[0]],
          ['side', 'Sidebar, light', p.light.side[0]],
          ['content', 'Content, light', p.light.content],
        ]
          .map(
            (x) =>
              `<label class="lbl te-ai"><input type="color" data-te="${x[0]}" value="${x[2]}"><span>${x[1]}</span><span class="mono small muted">${x[2]}</span></label>`,
          )
          .join('')}</div></details>
    </div>
    <div class="te-p"><div class="te-pv">${themePreview(p, false, logoTxt)}${themePreview(p, true, logoTxt)}</div>
      <section class="panel"><div class="panel-h"><div><h2>Does it read?</h2><p class="muted small">WCAG AA contrast: 4.5 for texts, 3 for icons and logos.</p></div>${bad.length ? btn('Fix it for me', { icon: 'check', kind: 'pri', act: 'tefix' }) : pill('Everything reads', 'ok', 'check')}</div>
        <ul class="feats">${checks.map((c) => `<li class="${c[1] >= c[2] ? 'on' : 'ko'}">${c[1] >= c[2] ? ic('check', 15) : ic('x', 15)}<span>${c[0]}</span><span class="num small">${c[1].toFixed(1)} : 1</span></li>`).join('')}</ul></section></div></div>`,
  });
}

/* ── System (administrator) ───────────────────────────────────────────
   The global parameters that change from the interface, one section at a time. Changes apply at
   once; where a mistake costs a lot (mail, restore) there is a test or a confirmation. */
function secSystem(S) {
  const lvl = 'sys',
    L = S.app.sys;
  const f = (k, label, o) => {
    const x = o || {};
    return `<label class="lbl ${x.wide ? 'span2' : ''}">${label}<input type="text" data-appf="${lvl}:${k}" value="${(L[k] || '').replace(/"/g, '&quot;').replace(/</g, '&lt;')}" ${x.mono ? 'class="mono"' : ''}>${x.hint ? `<span class="hint">${x.hint}</span>` : ''}</label>`;
  };
  const sw = (on, lbl, sub) =>
    `<li><div class="rt grow"><b>${lbl}</b>${sub ? `<span>${sub}</span>` : ''}</div>${toggle(on)}</li>`;
  const sel = (label, opts, cur, hint) =>
    `<label class="lbl">${label}<select>${opts.map((o) => `<option ${o === cur ? 'selected' : ''}>${o}</option>`).join('')}</select>${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
  const rb = BACKUPS.find((b) => b[0] === S.restoreSel);
  const parts = [
    'Operation',
    [
      'Email',
      'mail',
      `<section class="panel"><h2>Mail server</h2><div class="fgrid">${fld('SMTP server', 'smtp.example.org', { mono: true })}${fld('Port', '587', { type: 'number' })}${sel('Security', ['STARTTLS', 'TLS', 'None'], 'STARTTLS')}${fld('User', 'noreply@apps.example.org', { mono: true })}${fld('Password', '••••••••••', { type: 'password', hint: 'Encrypted, never sent to the browser' })}</div>
        <div class="row mt">${btn('Send a test', { icon: 'mail', act: 'systest' })}${S.sysTest ? `<span class="small ok-t">${ic('check', 13)} Sent to p.ferri@platform.example.org at 10:52</span>` : ''}</div></section>
      <section class="panel mt"><h2>Messages</h2><p class="muted small">Used in the messages the platform sends: invitations, links to choose a password, notifications and mentions.</p>
        <div class="lg-split mt"><div class="fgrid one">${f('from', 'Sender', { mono: true })}${f('footer', 'Footer')}</div>
          <div class="mailp"><div class="mailp-h"><span class="muted small">From</span> ${L.from.replace(/</g, '&lt;')}<br><span class="muted small">Subject</span> You have been invited to Example City</div><div class="mailp-b">Elena Ricci invited you to work in Example City on ${L.name}.<span class="mailp-btn">Accept the invitation</span></div><div class="mailp-f">${L.footer}</div></div></div></section>`,
      'email',
    ],
    [
      'Addresses',
      'link',
      `<section class="panel"><h2>Addresses</h2><dl class="kv"><dt>Platform</dt><dd class="mono">https://apps.example.org</dd><dt>Tenant</dt><dd class="mono">https://&lt;tenant&gt;.apps.example.org</dd></dl><p class="muted small">Fixed at installation: changing them means new certificates and new return addresses for single sign-on.</p></section>
      <section class="panel mt"><h2>Sites that may embed pages</h2><p class="muted small">Only these sites can show a page of the platform inside one of theirs: for every other the browser refuses to open it. A direct link always works, and whoever opens it sees only what their permissions allow.</p><div class="gchips mt">${['*.apps.example.org', 'intranet.example.org'].map((g) => `<span class="gchip mono">${g}<button type="button" aria-label="Remove ${g}">${ic('x', 12)}</button></span>`).join('')}<button type="button" class="gchip add">${ic('plus', 13)}Add</button></div><p class="muted small mt">Every tenant can add the sites of its own from its Settings.</p></section>`,
      'addresses',
    ],
    [
      'Backup and restore',
      'box',
      `<section class="panel"><div class="panel-h"><div><h2>Backup</h2><p class="muted small">PostgreSQL, the file storage and the configuration of the platform.</p></div>${btn('Run now', { icon: 'play', act: 'sysbackup' })}</div>
        <div class="fgrid">${sel('When', ['Every night at 02:00', 'Every 6 hours', 'Every week'], 'Every night at 02:00')}${sel('Keep', ['30 daily and 12 monthly', '14 daily and 6 monthly', '7 daily'], '30 daily and 12 monthly')}${fld('Destination', 's3://platform-backup', { mono: true })}${sel('Second copy elsewhere', ['Yes, in another data centre', 'No, only here'], 'Yes, in another data centre', 'If the main data centre is lost, backups stay')}</div>
        <ul class="rows mt">${sw(1, 'Encrypted', 'With a key different from the one of the data')}${sw(1, 'Check after every backup', 'A test restore in a separate environment, every Sunday')}</ul></section>
      <section class="panel mt"><h2>Latest backups</h2>${S.sysBackupRun ? `<div class="banner info">${ic('refresh', 18)}<div><b>Backup running.</b> It takes about 25 minutes; you can go on working.</div></div>` : ''}<div class="tbl-w"><table class="tbl"><thead><tr><th>When</th><th>Kind</th><th class="r">Size</th><th>Outcome</th><th></th></tr></thead><tbody>${BACKUPS.map((b) => `<tr class="${S.restoreSel === b[0] ? 'picked' : ''}"><td class="num">${b[1]}</td><td>${b[2]}</td><td class="r num">${b[3]}</td><td>${pill(b[4] === 'ok' ? 'Succeeded' : 'Failed', b[4])}${b[4] === 'ok' ? '' : '<div class="small muted">No space left on the destination</div>'}</td><td class="r">${b[4] === 'ok' ? btn('Restore', { act: 'sysrestore', v: b[0] }) : btn('Retry', { icon: 'refresh', act: 'toast', v: 'Backup started again: about 25 minutes.' })}</td></tr>`).join('')}</tbody></table></div>
        ${
          rb
            ? `<div class="banner warn mt restore">${ic('alert', 18)}<div><b>Restore from the backup of ${rb[1]}.</b> Choose what to bring back: the rest is not touched.
          <div class="opts mt">${[
            [
              'all',
              'The whole platform',
              'It stops for about 40 minutes; everything goes back to that day',
            ],
            ['org', 'One tenant', 'The other tenants go on working'],
            ['item', 'One item', "A note, an estimate or a task, next to today's version"],
          ]
            .map(
              (o, i) =>
                `<label class="opt ${i === 1 ? 'sel' : ''}"><input type="radio" name="rs" ${i === 1 ? 'checked' : ''}><b>${o[1]}</b><span>${o[2]}</span></label>`,
            )
            .join('')}</div></div>
          <div class="row">${btn('Cancel', { act: 'sysrestore', v: rb[0] })}${btn('Restore', { kind: 'pri', icon: 'history' })}</div></div>`
            : ''
        }</section>`,
      'backup',
    ],
    [
      'Security',
      'shield',
      `<section class="panel"><div class="panel-h"><div><h2>Minimum rules</h2><p class="muted small">They apply to every local account, of every tenant, and Mosaikit enforces them; a tenant can only be stricter. Whoever signs in with the identity provider (OIDC) of a tenant follows the rules of that provider.</p></div></div>
        <div class="fgrid">${fld('Minimum length of the password', '10', { type: 'number' })}${fld('Password expiry, in days', '180', { type: 'number', hint: '0 = never expires' })}${fld('Attempts before the lock', '8', { type: 'number' })}${fld('Length of the lock, in minutes', '15', { type: 'number' })}${sel('Length of the session', ['8 hours', '12 hours', '24 hours'], '8 hours')}${sel('«Remember me»', ['30 days', '7 days', 'Never'], '30 days')}</div>
        <ul class="rows mt">${sw(1, 'Second factor for Tenant Managers and administrators', 'Required')}${sw(0, 'Second factor for everybody', 'Users too')}</ul></section>
      <section class="panel mt"><div class="panel-h"><div><h2>Administrator access</h2><p class="muted small">Administrators are accounts of the platform: they sign in from <span class="mono">#/admin</span>, always with the local password and the second factor (TOTP), whatever the tenants use. It works even when the identity provider of a tenant does not answer.</p></div>${pill('Second factor required', 'ok', 'check')}</div>
        <dl class="kv"><dt>Address</dt><dd class="mono">https://apps.example.org/#/admin</dd><dt>Second factor</dt><dd>An authenticator app, registered at the first sign-in, and 10 recovery codes</dd><dt>Lost phone and codes</dt><dd>Another administrator removes the second factor, or the console of the server: <span class="mono">reset-totp --user &lt;name&gt;</span></dd></dl>
        <p class="muted small">Every sign-in of an administrator goes to the log. Administrators do not enter tenants and do not see their content.</p></section>`,
      'security',
    ],
    ['Keys of outside services', 'key', keysSection(S, 'sys'), 'keys'],
    [
      'Retention',
      'clock',
      `<section class="panel"><h2>How long things are kept</h2><div class="fgrid">${sel('Log', ['30 days', '6 months', '1 year'], '1 year')}${sel('Technical logs of the services', ['30 days', '90 days'], '30 days')}${sel('Read notifications', ['90 days', '1 year'], '90 days')}${sel('Runs of automations', ['6 months', '1 year'], '6 months')}</div></section>`,
      'retention',
    ],
    [
      'Maintenance',
      'zap',
      `<section class="panel"><h2>Maintenance mode</h2><ul class="rows">${sw(0, 'On', 'Only administrators sign in; the others see the message')}</ul><div class="fgrid mt">${fld('Message', 'The platform is under maintenance until 22:00.', { wide: true })}</div></section>
      <section class="panel mt"><h2>Notice for everybody</h2><p class="muted small">A strip on top of every page, for example before an update.</p><div class="fgrid">${fld('Text', 'On Saturday 11 October from 20 to 22 the platform is not available.', { wide: true })}${sel('Until', ['Saturday 11 Oct at 22:00', 'Tomorrow', 'Until I remove it'], 'Saturday 11 Oct at 22:00')}</div><ul class="rows mt">${sw(1, 'Show the notice', '')}</ul></section>`,
      'maintenance',
    ],
    ['Quotas', 'gauge', sysQuotas(S), 'quotas'],
  ];
  parts.push('Appearance', appearancePage(S, 'sys'));
  const nav = secNav(S, 'sys', parts);
  return detailPage(S, {
    title: 'System',
    sub: 'Parameters and appearance of the whole platform, applied at once',
    body:
      (S.bulkDone
        ? `<div class="banner info bdone">${ic('check', 18)}<div>${S.bulkDone}</div></div>`
        : '') + nav.body,
    side: nav.side,
    sideNav: true,
  });
}
/* The profiles of the tenant: where the permissions in the plugins start, chosen when
   inviting. Edited here, plugin by plugin; they apply to every person who has them. */
function profilesSection(S) {
  const cur = PROF(S.profSel || 'std');
  const mods = MGR_FEATS.filter((k) => MOD_PERMS[k]);
  return `<section class="panel"><div class="panel-h"><div><h2>Permission profiles</h2><p class="muted small">Where the permissions of a User in the plugins start. Groups and personal exceptions add; a profile never takes away.</p></div></div>
      <div class="opts prof-o">${PROFILES.map((pr) => `<button type="button" class="opt ${pr.id === cur.id ? 'sel' : ''}" data-act="profsel" data-v="${pr.id}" aria-pressed="${pr.id === cur.id}"><b>${pr.n}</b><span>${pr.d}</span><span class="small num">${pr.cnt} people${pr.def ? ' · for new invitations' : ''}</span></button>`).join('')}</div></section>
    <section class="panel mt"><div class="panel-h"><div><h2>${cur.n}</h2><p class="muted small">${cur.cnt} people have this profile: a change applies to all of them, from their next sign-in.</p></div><div class="row">${btn('Duplicate', { icon: 'copy', act: 'profnew' })}${cur.def ? '' : btn('Use for new invitations', { act: 'profdef', v: cur.id })}</div></div>
      <div class="ptab">${mods
        .map(
          (k) =>
            `<div class="ptab-r"><div class="ptab-m">${ic(FEAT(k).ic || 'puzzle', 15)}<b>${FEAT(k).n}</b></div><div class="ptab-p">${MOD_PERMS[
              k
            ]
              .map((p, i) => {
                const on = cur.p[k] && cur.p[k][i];
                return `<label class="pchip tg ${on ? 'on' : ''}" title="${PERM_DESC[p] || ''}"><input type="checkbox" class="sr" data-act="profperm" data-v="${cur.id}:${k}:${i}" ${on ? 'checked' : ''}>${on ? ic('check', 11) : ''}${p}</label>`;
              })
              .join('')}</div></div>`,
        )
        .join('')}</div>
      <p class="muted small mt">Plugins installed by the administrator are not in profiles: they are given by group or by person, from Plugins › Permissions.</p></section>`;
}
/* The quotas of the platform: what a new tenant takes, how much the platform has, and how much is
   given to the tenants already (it can be more than the capacity: not everybody uses everything). */
function sysQuotas(S) {
  const sum = (k) =>
    TENANTS.filter((x) => tenSt(S, x) !== 'Suspended').reduce((s, x) => s + (tenQuota(S, x)[k] || 0), 0);
  const caps = QUOTA_Q.filter((k) => QCAP[k[0]] != null);
  const over = caps.filter((k) => sum(k[0]) > QCAP[k[0]]);
  return `<section class="panel"><div class="panel-h"><div><h2>Quotas of new tenants</h2><p class="muted small">Every tenant takes these, unless it has its own on its page (Tenants › the tenant › Details). Tenant Managers read them in Usage, people in Account › Usage: nobody else changes them.</p></div></div>
      <div class="fgrid">${QUOTA_Q.map((k) => `<label class="lbl">${k[1]}${k[2] ? ' (' + k[2] + ')' : ''}<input type="number" min="0" value="${QDEF[k[0]] == null ? '' : QDEF[k[0]]}" placeholder="no limit"></label>`).join('')}</div></section>
    <section class="panel mt"><div class="panel-h"><div><h2>Capacity of the platform</h2><p class="muted small">How much the platform has in all, and how much is given to the tenants that are not suspended.</p></div></div>
      ${over.length ? `<div class="banner warn">${ic('alert', 18)}<div><b>More is given than the platform has: ${over.map((k) => k[1].toLowerCase()).join(', ')}.</b> It works while the tenants do not all use their whole quota; Monitoring › Capacity says when the real use gets near.</div></div>` : ''}
      <div class="tbl-w mt"><table class="tbl"><thead><tr><th>Quota</th><th class="r">Capacity</th><th class="r">Given to the tenants</th><th></th></tr></thead><tbody>${caps
        .map((k) => {
          const s = sum(k[0]),
            c = QCAP[k[0]];
          return `<tr><td><b>${k[1]}</b></td><td class="r"><input type="number" class="q-in" value="${c}" aria-label="Capacity: ${k[1]}"></td><td class="r num ${s > c ? 'warn-t' : ''}">${fmtN(s)} · ${Math.round((s / c) * 100)}%</td><td>${s > c ? pill('Over the capacity', 'warn') : pill('Within', 'ok')}</td></tr>`;
        })
        .join('')}</tbody></table></div></section>`;
}
/* Settings of the tenant: the Tenant Manager only; what is personal is in Account. Every setting
   carries its mark: with a limit, customizable, or managed by the administrator (gathered in the last
   section, to read). */
function secConfig(S) {
  const tn = TENANT_SEL[0],
    x = TENANTS[0],
    e = TEN_EXTRA[x.slug];
  const rule = (label, plat, val, max) =>
    `<label class="lbl">${label}<input type="number" value="${val}"><span class="hint">${max ? 'Maximum' : 'Minimum'} of the platform: ${plat}</span></label>`;
  const managed = [
    ['key', 'Sign-in', `${tenAuthOf(S, x.slug) === 'oidc' ? `Identity provider (OIDC): ${e.idpName}` : 'Local accounts, kept by Mosaikit'} · roles from ${e.roles === 'idp' ? 'the groups of the identity provider' : 'Mosaikit'} · guests allowed, at most User`, null],
    ['gauge', 'Quotas', `${QUOTA_Q.map((k) => `${Q_SHORT[k[0]]} ${tenQuota(S, x)[k[0]] == null ? 'no limit' : fmtN(tenQuota(S, x)[k[0]]) + (k[2] ? ' ' + k[2] : '')}`).join(' · ')}`, ['Usage', 'usage']],
    ['puzzle', 'Plugins available', `${FEATS.filter((f) => tenFeats(S, x)[f.k]).length} of ${FEATS.length}: you turn them on and give the permissions`, ['Plugins', 'splugins']],
    ['menu', 'Top bar', `${['logo', 'search', 'lang', 'help', 'mode'].filter((k) => bar()[k]).length} of 5 controls shown, the same in every tenant`, null],
  ];
  const parts = [
    'Tenant',
    [
      'Security',
      'shield',
      `<section class="panel"><div class="panel-h"><div><h2>Rules of the tenant</h2><p class="muted small">They start from the rules of the platform and can only be stricter. They apply to whoever signs in with a local account, and Mosaikit enforces them; whoever signs in with an identity provider (OIDC) follows the rules of that provider.</p></div>${inhLimit()}</div>
        <div class="fgrid mt">${rule('Minimum length of the password', 10, 12)}${rule('Password expiry, in days', 180, 90, 1)}${rule('Attempts before the lock', 8, 5, 1)}<label class="lbl">Length of the session<select><option>8 hours</option><option selected>4 hours</option></select><span class="hint">Maximum of the platform: 8 hours</span></label></div>
        <ul class="rows mt"><li><div class="rt grow"><b>Second factor for Tenant Managers</b><span>Required by the platform</span></div>${toggle(1).replace('<button', '<button disabled')}</li><li><div class="rt grow"><b>Second factor for everybody</b><span>Users too</span></div>${toggle(1)}</li></ul></section>`,
      'security',
    ],
    [
      'Keys of outside services',
      'key',
      keysSection(S, 'tnt'),
      'keys',
    ],
    [
      'Embedding',
      'link',
      `<section class="panel"><div class="panel-h"><div><h2>Sites that may embed the pages of the tenant</h2><p class="muted small">The pages of ${tn.name} can show inside the pages of these sites; for every other the browser refuses to open them. The tenant adds its own to the ones of the platform.</p></div></div>
        <div class="eyebrow mt">Of the platform ${inhLock()}</div><div class="gchips">${['*.apps.example.org', 'intranet.example.org'].map((g) => `<span class="gchip mono off">${ic('lock', 11)}${g}</span>`).join('')}</div>
        <div class="eyebrow mt">Of the tenant</div><div class="gchips">${['www.city.example.org', 'intranet.city.example.org'].map((g) => `<span class="gchip mono">${g}<button type="button" aria-label="Remove ${g}">${ic('x', 12)}</button></span>`).join('')}<button type="button" class="gchip add">${ic('plus', 13)}Add</button></div></section>`,
      'embedding',
    ],
    [
      'Managed by the platform',
      'lock',
      `<section class="panel"><div class="panel-h"><div><h2>Managed by the platform</h2><p class="muted small">Decided by the administrator of the platform for ${tn.name}: here they are read, not changed. To change one, ask the administrators.</p></div>${inhLock()}</div>
        <ul class="rows">${managed.map((m) => `<li><span class="ri">${ic(m[0], 15)}</span><div class="rt grow"><b>${m[1]}</b><span>${m[2]}</span></div>${m[3] ? btn(m[3][0], { icon: 'right', go: m[3][1] }) : ''}</li>`).join('')}</ul></section>`,
      'platform',
    ],
  ];
  parts.push('Appearance', appearancePage(S, 'tnt'));
  const nav = secNav(S, 'cfg', parts);
  return detailPage(S, {
    title: 'Tenant settings',
    sub: `Settings and appearance of ${tn.name}, applied at once`,
    body:
      `<p class="inh-legend small">${inhLimit('With a limit')}${`<span class="inh">${ic('refresh', 12)}Inherited or customized</span>`}${inhLock()}<span class="muted">: what each mark means for a setting of the tenant</span></p>` +
      (S.bulkDone
        ? `<div class="banner info bdone">${ic('check', 18)}<div>${S.bulkDone}</div></div>`
        : '') +
      nav.body,
    side: nav.side,
    sideNav: true,
  });
}

/* ── The table of screens ────────────────────────────────────────────── */

const SECTIONS = {
  login: secLogin,
  home: secHome,
  inbox: secInbox,
  account: secAccount,
  trash: secTrash,
  space: secSpace,
  shares: secShares,
  members: secMembers,
  person: secPerson,
  group: secGroup,
  splugins: secSplugins,
  module: secModule,
  usage: secUsage,
  activity: secActivity,
  platform: secPlatform,
  tenants: secTenants,
  tenant: secTenant,
  gusers: secGusers,
  marketplace: secMarketplace,
  mpmod: secMpMod,
  monitoring: secMonitoring,
  audit: secAudit,
  system: secSystem,
  config: secConfig,
  themeedit: secThemeEdit,
};

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/* eslint-disable -- plain browser scripts of a static mockup: they share globals across files */

/* Mosaikit mockup: sample data. Tenants, people and apps are invented; the four apps
   (Notes, Activities, Estimates, Tasks) stand for whatever extensions an installation has. */

/* ── People and roles ────────────────────────────────────────────────── */

const ROLES = {
  admin: {
    label: 'Administrator',
    long: 'Platform administrator',
    who: 'Paola Ferri',
    ini: 'PF',
    mail: 'p.ferri@platform.example.org',
    unit: 'Platform operations',
  },
  manager: {
    label: 'Tenant Manager',
    long: 'Tenant Manager',
    who: 'Elena Ricci',
    ini: 'ER',
    mail: 'e.ricci@city.example.org',
    unit: 'Operations office',
  },

  user: {
    label: 'User',
    long: 'User of the tenant',
    who: 'Davide Conti',
    ini: 'DC',
    mail: 'd.conti@city.example.org',
    unit: 'Planning department · Analyst',
  },
};

const PEOPLE = [
  {
    n: 'Elena Ricci',
    ini: 'ER',
    mail: 'e.ricci@city.example.org',
    role: 'Tenant Manager',
    prof: '',
    assoc: ['Example County', 'Green Region'],
    groups: ['Operations office'],
    st: 'Active',
    via: 'SSO',
    last: 'Today 09:12',
    c: 2,
  },
  {
    n: 'Davide Conti',
    ini: 'DC',
    mail: 'd.conti@city.example.org',
    role: 'User',
    prof: 'ana',
    assoc: ['Example County', 'Green Region'],
    groups: ['Planning'],
    st: 'Active',
    via: 'SSO',
    last: 'Today 08:55',
    c: 3,
  },
  {
    n: 'Sara Greco',
    ini: 'SG',
    mail: 's.greco@city.example.org',
    role: 'User',
    prof: 'std',
    groups: ['Planning', 'Finance'],
    st: 'Active',
    via: 'SSO',
    last: 'Today 08:30',
    c: 4,
  },
  {
    n: 'Luca Bianchi',
    ini: 'LB',
    mail: 'l.bianchi@city.example.org',
    role: 'User',
    prof: 'fld',
    groups: ['Field team'],
    st: 'Active',
    via: 'Local',
    last: 'Yesterday 17:40',
    c: 1,
  },
  {
    n: 'Giulia Marini',
    ini: 'GM',
    mail: 'g.marini@city.example.org',
    role: 'User',
    prof: 'view',
    groups: ['Front office'],
    st: 'Invited',
    via: '—',
    last: 'Never',
    c: 5,
  },
  {
    n: 'Paolo Fontana',
    ini: 'PO',
    mail: 'p.fontana@city.example.org',
    role: 'User',
    prof: 'view',
    groups: ['Field team'],
    st: 'Active',
    via: 'SSO',
    last: '22 Sep 2026',
    c: 2,
  },
  {
    n: 'Chiara Rinaldi',
    ini: 'CR',
    mail: 'c.rinaldi@city.example.org',
    role: 'User',
    prof: 'std',
    groups: ['Field team'],
    st: 'Suspended',
    via: 'SSO',
    last: '2 Aug 2026',
    c: 4,
  },
  {
    n: 'Marco Esposito',
    ini: 'ME',
    mail: 'm.esposito@city.example.org',
    role: 'User',
    prof: 'std',
    groups: ['Finance'],
    st: 'Active',
    via: 'Local',
    last: '18 Sep 2026',
    c: 3,
  },
  {
    n: 'Roberta Leone',
    ini: 'RL',
    mail: 'r.leone@region.example.org',
    role: 'User',
    prof: 'view',
    groups: ['Field team'],
    st: 'Active',
    via: 'Local',
    last: 'Yesterday 11:20',
    c: 1,
    home: 'Green Region',
  },
];

const GROUPS = [
  { n: 'Planning', d: 'Planning department', m: 23, res: 41, kc: true },
  { n: 'Finance', d: 'Budget, purchases and estimates', m: 17, res: 28, kc: true },
  { n: 'Field team', d: 'Inspections and site visits', m: 12, res: 19, kc: true },
  { n: 'Front office', d: 'Requests from the public', m: 31, res: 9, kc: false },
  { n: 'Operations office', d: 'The Tenant Managers', m: 6, res: 64, kc: true },
];

/* ── Tenants and quotas ──────────────────────────────────────────────── */
/* Quotas are set by the administrator, tenant by tenant (Details of the tenant). */

const TENANTS = [
  {
    n: 'Example City',
    slug: 'example-city',
    q: { space: 25, people: null, auto: 375, collab: 20, ai: 100 },
    users: 128,
    data: 7.4,
    auth: 'OIDC · Keycloak of the city',
    st: 'Active',
  },
  {
    n: 'Example County',
    slug: 'example-county',
    q: { space: 25, people: null, auto: 1000, collab: 20, ai: 100 },
    users: 214,
    data: 18.1,
    auth: 'OIDC · Entra ID of the county',
    st: 'Active',
  },
  {
    n: 'Green Region',
    slug: 'green-region',
    q: { space: 10, people: 100, auto: 500, collab: 10, ai: 50 },
    users: 46,
    data: 3.9,
    auth: 'Local accounts',
    st: 'Active',
  },
  {
    n: 'Acme Water Board',
    slug: 'acme-water',
    q: { space: 10, people: 100, auto: 500, collab: 10, ai: 50 },
    users: 19,
    data: 1.2,
    auth: 'Local accounts',
    st: 'Active',
  },
  {
    n: 'Sandbox',
    slug: 'sandbox',
    q: { space: 1, people: 10, auto: 60, collab: 2, ai: 0 },
    users: 7,
    data: 0.3,
    auth: 'Local accounts',
    st: 'Trial',
  },
  {
    n: 'Green Valley Union',
    slug: 'green-valley',
    q: { space: 10, people: 100, auto: 500, collab: 10, ai: 50 },
    users: 23,
    data: 2.1,
    auth: 'Local accounts',
    st: 'Suspended',
  },
];
/* The state of a tenant: active, on trial (with an end date), suspended (nobody enters, the data stays). */
const TEN_ST = {
  Active: { tone: 'ok', d: 'People sign in and work as usual.' },
  Trial: {
    tone: 'warn',
    label: 'On trial',
    d: 'Like active, with an end date: at the end it becomes suspended.',
  },
  Suspended: {
    tone: 'bad',
    d: 'Nobody can sign in, open invitations close, scheduled automations stop. Data and permissions stay.',
  },
};
/* The quotas of the platform: the ones a new tenant takes, and how much the platform has in all.
   The administrator changes them in System › Quotas; a tenant can have its own, on its page. */
const QDEF = { space: 10, people: 100, auto: 500, collab: 10, ai: 50 };
const QCAP = { space: 200, people: null, auto: 2500, collab: 60, ai: 400 };
/* The quotas a tenant has: [key, label, unit]. */
const QUOTA_Q = [
  ['space', 'Storage', 'GB'],
  ['people', 'People', ''],
  ['auto', 'Automation minutes per month', 'min'],
  ['collab', 'Shared sessions open together', ''],
  ['ai', 'AI credits per month', ''],
];
const TEN_EXTRA = {
  'example-city': {
    reg: 'EX-0001',
    vat: 'EX00000000001',
    mail: 'city.example.org',
    idpName: 'Keycloak of Example City',
    issuer: 'https://login.city.example.org/realms/staff',
    auth: 'oidc',
    roles: 'idp',
    contact: 'contact@city.example.org',
  },
  'example-county': {
    reg: 'EX-0002',
    vat: 'EX00000000002',
    mail: 'county.example.org',
    idpName: 'Entra ID of Example County',
    issuer: 'https://login.microsoftonline.com/county-example/v2.0',
    auth: 'oidc',
    roles: 'mosaikit',
    contact: 'contact@county.example.org',
  },
  'green-region': {
    reg: 'EX-0003',
    vat: 'EX00000000003',
    mail: 'region.example.org',
    auth: 'local',
    roles: 'mosaikit',
    contact: 'contact@region.example.org',
  },
  'acme-water': {
    reg: 'EX-0004',
    vat: 'EX00000000004',
    mail: 'acme.example.org',
    auth: 'local',
    roles: 'mosaikit',
    contact: 'office@acme.example.org',
  },
  sandbox: {
    reg: '—',
    vat: '—',
    mail: 'sandbox.example.org',
    auth: 'local',
    roles: 'mosaikit',
    contact: '—',
  },
  'green-valley': {
    reg: 'EX-0006',
    vat: 'EX00000000006',
    mail: 'valley.example.org',
    auth: 'local',
    roles: 'mosaikit',
    contact: 'office@valley.example.org',
  },
};

/* The tenants of whoever is signed in, as the switcher draws them: crest, colours, initial. */
const TENANT_SEL = [
  {
    id: 'example-city',
    name: 'Example City',
    pre: 'CITY OF',
    city: 'Example',
    ini: 'E',
    fill: '#1f4e79',
    mark: '#f2b632',
    ink: '#f2b632',
    pat: 'band',
    roles: { user: 'User', collab: 'User', manager: 'Tenant Manager' },
  },
  {
    id: 'example-county',
    name: 'Example County',
    pre: 'COUNTY OF',
    city: 'Example',
    ini: 'C',
    fill: '#ffffff',
    mark: '#c8102e',
    ink: '#c8102e',
    pat: 'cross',
    roles: { user: 'User', collab: 'User', manager: 'User' },
  },
  {
    id: 'green-region',
    name: 'Green Region',
    pre: 'REGION',
    city: 'Green',
    ini: 'G',
    fill: '#0b6e4f',
    mark: '#ffffff',
    ink: '#ffffff',
    pat: 'chevron',
    roles: { user: 'User', collab: 'User', manager: 'User' },
  },
];
const PLATFORM = { id: 'platform', name: 'Mosaikit (Platform)' };
/* Home tenant first, then the ones a person is a guest in. */
const MY_TENANTS = {
  user: [
    ['example-city', 'User', 'home'],
    ['example-county', 'User', 'assoc'],
    ['green-region', 'User', 'assoc'],
  ],
  manager: [
    ['example-city', 'Tenant Manager', 'home'],
    ['example-county', 'User', 'assoc'],
    ['green-region', 'User', 'assoc'],
  ],
};

/* ── The sample apps and their items ─────────────────────────────────── */

const APPS = [
  {
    id: 'notes',
    n: 'Notes',
    ic: 'note',
    tone: 'c1',
    d: 'Notes and checklists, alone or together',
    cnt: '38 notes',
  },
  {
    id: 'activities',
    n: 'Activities',
    ic: 'calendar',
    tone: 'c2',
    d: 'Meetings, visits and deadlines',
    cnt: '12 this week',
  },
  {
    id: 'estimates',
    n: 'Estimates',
    ic: 'receipt',
    tone: 'c3',
    d: 'Quotes with items, prices and approval',
    cnt: '5 to approve',
  },
  {
    id: 'tasks',
    n: 'Tasks',
    ic: 'checklist',
    tone: 'c4',
    d: 'To-dos with owners and due dates',
    cnt: '9 due soon',
  },
];
const APP = (id) => APPS.find((a) => a.id === id);
const ITEMS = [
  {
    id: 'n1',
    app: 'notes',
    t: 'Site visit, north depot',
    d: 'Findings and photos of the inspection',
    own: 'Elena Ricci',
    acc: 'org',
    upd: '12 min ago',
  },
  {
    id: 'e1',
    app: 'estimates',
    t: 'Estimate 2026-114 · roof repairs',
    d: '12 items · 48,200 EUR · to approve',
    own: 'Davide Conti',
    acc: 'groups',
    upd: 'Yesterday',
  },
  {
    id: 'a1',
    app: 'activities',
    t: 'Quarterly review with finance',
    d: 'Thursday 10:00 · meeting room 2',
    own: 'Sara Greco',
    acc: 'groups',
    upd: '2 hours ago',
  },
  {
    id: 't1',
    app: 'tasks',
    t: 'Prepare the budget draft',
    d: 'Due 24 Oct · 3 of 7 steps done',
    own: 'Davide Conti',
    acc: 'private',
    upd: 'Today',
  },
  {
    id: 'n2',
    app: 'notes',
    t: 'Weekly team sync',
    d: 'Decisions and open points',
    own: 'Davide Conti',
    acc: 'groups',
    upd: 'Yesterday',
  },
  {
    id: 'e2',
    app: 'estimates',
    t: 'Estimate 2026-109 · office furniture',
    d: '7 items · 12,900 EUR · approved',
    own: 'Sara Greco',
    acc: 'org',
    upd: '3 days ago',
  },
  {
    id: 'a2',
    app: 'activities',
    t: 'Open day 2026',
    d: 'Saturday 18 Oct · town hall',
    own: 'Davide Conti',
    acc: 'public',
    upd: '5 days ago',
  },
  {
    id: 't2',
    app: 'tasks',
    t: 'Renew the office lease',
    d: 'Due 31 Oct · assigned to Marco Esposito',
    own: 'Marco Esposito',
    acc: 'org',
    upd: '1 week ago',
  },
];
/* Who sees an item: the four levels of general access. */
const ACCESS = {
  private: { label: 'Private', icon: 'lock' },
  groups: { label: 'Groups', icon: 'users' },
  org: { label: 'Whole tenant', icon: 'building' },
  public: { label: 'Public', icon: 'globe' },
};
function accPill(a) {
  const x = ACCESS[a];
  return pill(x.label, 'acc-' + a, x.icon);
}

/* ── Plugins ─────────────────────────────────────────────────────────
   «app»: the apps of the installation. «int»: services of the platform. «ext»: plugins installed by
   the administrator. «needs»: all required; «needsAny»: one is enough; «soft»: without it the plugin stays
   but loses a part. */
const FEATS = [
  {
    k: 'notes',
    g: 'app',
    ic: 'note',
    n: 'Notes',
    d: 'Notes and checklists, alone or in a shared session.',
    how: 'An app of this installation: its pages and its data come from its extension.',
  },
  {
    k: 'tasks',
    g: 'app',
    ic: 'checklist',
    n: 'Tasks',
    d: 'To-dos with owners, due dates and reminders.',
    how: 'An app of this installation. Activities and Estimates build on its tasks.',
  },
  {
    k: 'activities',
    g: 'app',
    ic: 'calendar',
    n: 'Activities',
    d: 'Meetings, visits and deadlines, with the tasks they need.',
    how: 'Every activity is made of tasks, so it needs Tasks.',
    needs: ['tasks'],
  },
  {
    k: 'estimates',
    g: 'app',
    ic: 'receipt',
    n: 'Estimates',
    d: 'Quotes with items and prices, approved by whoever may.',
    how: 'An estimate prices the activities it covers.',
    needs: ['activities'],
    soft: [['files', 'Without File storage, attachments to estimates are not available.']],
  },
  {
    k: 'collab',
    g: 'int',
    ic: 'users',
    n: 'Real-time collaboration',
    d: 'Several people on the same item, with the cursors of the others.',
    how: 'Uses the relay of the platform, which trusts the identity the platform signs. The quotas of the tenant set how many sessions can be open together.',
    needsAny: ['notes', 'activities', 'estimates', 'tasks'],
  },
  {
    k: 'auto',
    g: 'int',
    ic: 'zap',
    n: 'Automations',
    d: 'Jobs that run on a schedule or on an event, on the worker of the platform.',
    how: 'Shared among tenants; each one has its own queue and its own monthly minutes, from the quotas of the tenant.',
  },
  {
    k: 'files',
    g: 'int',
    ic: 'box',
    n: 'File storage',
    d: 'Where attachments and documents are kept.',
    how: 'One bucket per tenant. Links to files are signed by the platform after checking the permissions.',
  },
  {
    k: 'ai',
    g: 'int',
    ic: 'spark',
    n: 'AI assistant',
    d: 'Questions in plain language on the items of the apps, and AI steps in automations.',
    how: 'Uses the key of the platform with the AI credits of the tenant, or a key of the tenant.',
  },
];
const FEAT = (k) => FEATS.find((f) => f.k === k);
const MGR_FEATS = ['notes', 'tasks', 'activities', 'estimates', 'collab', 'auto', 'ai'];
/* The permissions every plugin declares in its manifest. A User starts from their profile;
   groups and personal exceptions add. */
const MOD_PERMS = {
  notes: ['Open notes', 'Create notes', 'Export'],
  tasks: ['See tasks', 'Create tasks', 'Assign to others'],
  activities: ['See activities', 'Plan activities', 'Invite outside people'],
  estimates: ['See estimates', 'Create estimates', 'Approve', 'Export'],
  collab: ['Join sessions', 'Start a session'],
  auto: ['Run automations', 'Schedule automations'],
  ai: ['Use the assistant', 'Use it in automations'],
};
const PERM_DESC = {
  'Open notes': 'Opens the notes shared with them',
  'Create notes': 'Creates notes of their own',
  Export: 'PDF and documents of what they can see',
  'See tasks': 'Opens the tasks shared with them',
  'Create tasks': 'Creates tasks of their own',
  'Assign to others': 'Gives a task to another person',
  'See activities': 'Opens the activities shared with them',
  'Plan activities': 'Creates and moves activities',
  'Invite outside people': 'Sends invitations to people outside the tenant',
  'See estimates': 'Opens the estimates shared with them',
  'Create estimates': 'Creates estimates of their own',
  Approve: 'Approves estimates up to the amount of their role',
  'Join sessions': 'Joins the shared sessions opened by others',
  'Start a session': 'Opens a shared session on an item of their own',
  'Run automations': 'Runs the automations they can see',
  'Schedule automations': 'Starts an automation on a schedule or on an event',
  'Use the assistant': 'Asks questions on the items of the apps',
  'Use it in automations': 'Puts steps of the assistant in automations',
};
/* Who has access, and with which permissions: the whole tenant, groups, people. */
const MOD_GRANTS = {
  notes: [
    ['building', 'Whole tenant', '128 people', [1, 1, 1]],
    ['users', 'Group Operations office', '6 people', [1, 1, 1]],
  ],
  tasks: [
    ['building', 'Whole tenant', '128 people', [1, 1, 0]],
    ['users', 'Group Planning', '23 people', [1, 1, 1]],
  ],
  activities: [
    ['building', 'Whole tenant', '128 people', [1, 0, 0]],
    ['users', 'Group Planning', '23 people', [1, 1, 1]],
    ['user', 'Sara Greco', 'User', [1, 1, 1]],
  ],
  estimates: [
    ['building', 'Whole tenant', '128 people', [1, 0, 0, 0]],
    ['users', 'Group Finance', '17 people', [1, 1, 1, 1]],
    ['user', 'Davide Conti', 'User', [1, 1, 0, 1]],
  ],
  collab: [['building', 'Whole tenant', '128 people', [1, 1]]],
  auto: [['users', 'Group Planning', '23 people', [1, 1]]],
  ai: [['users', 'Group Operations office', '6 people', [1, 1]]],
};

/* Profiles: where the permissions of a User start. Not roles: groups and personal exceptions add
   to them. p: plugin -> permissions of MOD_PERMS. */
const PROFILES = [
  {
    id: 'std',
    n: 'Standard',
    d: 'Creates and shares notes, activities, estimates and tasks of their own.',
    def: true,
    cnt: 96,
    p: {
      notes: [1, 1, 1],
      tasks: [1, 1, 1],
      activities: [1, 1, 0],
      estimates: [1, 1, 0, 1],
      collab: [1, 1],
      auto: [1, 0],
      ai: [1, 0],
    },
  },
  {
    id: 'ana',
    n: 'Analyst',
    d: 'Like Standard, plus scheduled automations, the AI assistant and approvals.',
    cnt: 14,
    p: {
      notes: [1, 1, 1],
      tasks: [1, 1, 1],
      activities: [1, 1, 1],
      estimates: [1, 1, 1, 1],
      collab: [1, 1],
      auto: [1, 1],
      ai: [1, 1],
    },
  },
  {
    id: 'view',
    n: 'View and edit',
    d: 'Opens what is shared with them and edits where they may write. Creates nothing.',
    cnt: 12,
    p: {
      notes: [1, 0, 1],
      tasks: [1, 0, 0],
      activities: [1, 0, 0],
      estimates: [1, 0, 0, 0],
      collab: [1, 0],
      auto: [0, 0],
      ai: [0, 0],
    },
  },
  {
    id: 'fld',
    n: 'Field worker',
    d: 'Writes notes on site and works on the tasks given to them.',
    cnt: 4,
    p: {
      notes: [1, 1, 0],
      tasks: [1, 0, 0],
      activities: [1, 0, 0],
      estimates: [0, 0, 0, 0],
      collab: [1, 0],
      auto: [0, 0],
      ai: [0, 0],
    },
  },
];
const PROF = (id) => PROFILES.find((x) => x.id === id) || PROFILES[0];

/* ── Plugins ──────────────────────────────────────────────────────────
   One name for everything an installation adds. Each plugin has a kind: an App has pages of its own,
   a Service works behind the scenes, an Extension extends another plugin («ext»: fields, actions,
   tabs). Built-in plugins («sys») come with the installation: they update, they are neither disabled
   nor uninstalled. The others install from the catalog of the repositories. The administrator makes a
   plugin available to a tenant; its Tenant Manager turns it on and decides who gets it. */
const MP = [
  {
    id: 'notes',
    n: 'Notes',
    sys: 'notes',
    kind: 'App',
    ver: '1.4.0',
    next: '1.5.0',
    trust: 'Official',
    repo: 'Mosaikit',
    ed: 'Mosaikit',
    d: 'The Notes app: notes, checklists and shared editing.',
    notes: [['1.5.0', 'Checklists inside notes, faster search']],
    asks: ['Reads the people of the tenant to mention them'],
  },
  {
    id: 'tasks',
    n: 'Tasks',
    sys: 'tasks',
    kind: 'App',
    ver: '1.4.0',
    trust: 'Official',
    repo: 'Mosaikit',
    ed: 'Mosaikit',
    d: 'The Tasks app: to-dos with owners and due dates.',
    notes: [],
    asks: [],
  },
  {
    id: 'activities',
    n: 'Activities',
    sys: 'activities',
    kind: 'App',
    ver: '1.4.0',
    trust: 'Official',
    repo: 'Mosaikit',
    ed: 'Mosaikit',
    d: 'The Activities app: meetings, visits and deadlines.',
    notes: [],
    asks: ['Sends invitations by email'],
  },
  {
    id: 'estimates',
    n: 'Estimates',
    sys: 'estimates',
    kind: 'App',
    ver: '1.4.0',
    trust: 'Official',
    repo: 'Mosaikit',
    ed: 'Mosaikit',
    d: 'The Estimates app: quotes with items, prices and approval.',
    notes: [],
    asks: ['Writes documents in the file storage'],
  },
  {
    id: 'collab',
    n: 'Collaboration',
    sys: 'collab',
    kind: 'Service',
    ver: '1.0.0',
    trust: 'Official',
    repo: 'Mosaikit',
    ed: 'Mosaikit',
    d: 'Shared sessions on items, through the relay of the platform.',
    notes: [],
    asks: [],
  },
  {
    id: 'timeline',
    kind: 'Extension',
    ext: 'activities',
    n: 'Timeline view',
    ver: '0.9.0',
    trust: 'Experimental',
    repo: 'Mosaikit',
    ed: 'Mosaikit Labs',
    d: 'Activities and tasks on a timeline, with dependencies.',
    needs: ['activities'],
    perms: ['See the timeline', 'Move dependencies'],
    tenants: ['example-city'],
    notes: [['0.9.0', 'First public version']],
    asks: ['Reads the activities and tasks the person can see', 'No outside service'],
  },
  {
    id: 'time-tracking',
    kind: 'Extension',
    ext: 'tasks',
    n: 'Time tracking',
    ver: '1.2.0',
    next: '1.3.0',
    trust: 'Verified',
    repo: 'Acme Labs',
    ed: 'Acme Labs',
    d: 'Hours on tasks and activities, timesheets and reports.',
    needs: ['tasks', 'activities'],
    perms: ['Track time', 'Approve timesheets', 'Export reports'],
    tenants: ['example-city', 'example-county'],
    notes: [
      ['1.3.0', 'Weekly timesheets'],
      ['1.2.0', 'Timer on the phone'],
    ],
    asks: [
      'Reads the tasks the person can see',
      'Calls the payroll service of the tenant (payroll.example.org)',
    ],
  },
  {
    id: 'invoicing',
    kind: 'App',
    n: 'Invoicing',
    ver: '2.0.1',
    trust: 'Verified',
    repo: 'Green Software',
    ed: 'Green Software',
    d: 'Invoices from approved estimates, with payment tracking.',
    needs: ['estimates', 'tasks'],
    perms: ['See invoices', 'Issue invoices', 'Record payments'],
    tenants: ['example-city'],
    notes: [],
    asks: ['Reads approved estimates', 'Sends invoices by email'],
  },
];
const MP_CATALOG = [
  {
    id: 'field-forms',
    kind: 'App',
    n: 'Forms on the phone',
    ver: '1.1.0',
    trust: 'Verified',
    repo: 'Green Software',
    ed: 'Green Software',
    d: 'Forms filled on the phone, also offline, that become notes and tasks.',
    needs: ['notes', 'tasks'],
    perms: ['Fill in forms', 'Design forms'],
    asks: ['Writes notes and tasks for the person who fills in'],
  },
  {
    id: 'e-signature',
    kind: 'Extension',
    ext: 'estimates',
    n: 'Electronic signature',
    ver: '0.7.0',
    trust: 'Experimental',
    repo: 'Mosaikit',
    ed: 'Mosaikit Labs',
    d: 'Signs estimates and documents with a qualified signature.',
    needs: ['estimates'],
    perms: ['Sign', 'Ask for a signature'],
    asks: ['Calls the signature service of the tenant'],
  },
  {
    id: 'doc-templates',
    kind: 'Extension',
    ext: 'notes',
    n: 'Document templates',
    ver: '1.0.2',
    trust: 'Official',
    repo: 'Mosaikit',
    ed: 'Mosaikit',
    d: 'Letters and reports filled from notes, activities and estimates.',
    needs: ['notes'],
    perms: ['Use templates', 'Manage templates'],
    asks: ['Writes documents in the file storage'],
  },
  {
    id: 'boards',
    kind: 'Extension',
    ext: 'tasks',
    n: 'Boards',
    ver: '1.0.0',
    trust: 'Verified',
    repo: 'Internal',
    ed: 'Operations office',
    d: 'Tasks on columns, dragged from one state to the next.',
    needs: ['tasks'],
    perms: ['See boards'],
    asks: [],
  },
];
MP_CATALOG.forEach((m) => {
  m.notes = m.notes || [];
  m.asks = m.asks || [];
});
const MP_TRUST = { Official: 'info', Verified: 'ok', Experimental: 'warn' };
/* An installed plugin from the catalog becomes a plugin of tenants, with the key «ext:id». */
function extFeat(m) {
  return {
    k: 'ext:' + m.id,
    g: 'ext',
    kind: m.kind,
    ext: m.ext,
    ic: m.kind === 'App' ? 'grid' : 'puzzle',
    n: m.n,
    d: m.d,
    how: `${m.ed} · version ${m.ver}.`,
    needs: m.needs || [],
  };
}
/* The kind of a plugin of tenants: the built-in apps and services, or what the catalog says. */
function featKind(f) {
  return f.kind || { app: 'App', int: 'Service', ext: 'Extension' }[f.g];
}
const KIND_IC = { App: 'grid', Service: 'cpu', Extension: 'puzzle' };
function kindPill(kind) {
  return pill(kind, kind === 'App' ? 'info' : '', KIND_IC[kind]);
}
MP.filter((m) => !m.sys).forEach((m) => {
  FEATS.push(extFeat(m));
});
const EXT_GROUP = {
  'time-tracking': ['Group Planning', '23 people'],
  invoicing: ['Group Finance', '17 people'],
  timeline: ['Group Planning', '23 people'],
};
MP.filter((m) => !m.sys).forEach((m) => {
  const g = EXT_GROUP[m.id] || ['Group Operations office', '6 people'];
  MOD_PERMS['ext:' + m.id] = m.perms;
  MOD_GRANTS['ext:' + m.id] = [['users', g[0], g[1], m.perms.map(() => 1)]];
});

/* What stops working if k is turned off, given the state «on». */
function featDependents(k, on) {
  const out = [];
  const walk = (key) =>
    FEATS.forEach((f) => {
      if (!on[f.k] || out.includes(f.k) || f.k === k) return;
      const hard = f.needs && f.needs.includes(key);
      const any =
        f.needsAny &&
        f.needsAny.includes(key) &&
        f.needsAny.every((a) => a === key || out.includes(a) || !on[a]);
      if (hard || any) {
        out.push(f.k);
        walk(f.k);
      }
    });
  walk(k);
  return out;
}
/* What must be turned on together with k. */
function featRequired(k, on) {
  const out = [];
  const walk = (key) => {
    const f = FEAT(key);
    (f.needs || []).forEach((n) => {
      if (!on[n] && !out.includes(n)) {
        out.push(n);
        walk(n);
      }
    });
    if (f.needsAny && !f.needsAny.some((n) => on[n])) {
      out.push(f.needsAny[0]);
      walk(f.needsAny[0]);
    }
  };
  walk(k);
  return out;
}
/* Who has access to a plugin: the profiles that give at least one of its permissions, then groups and people. */
function modRows(k) {
  const prof = PROFILES.filter((pr) => pr.p[k] && pr.p[k].some((v) => v)).map((pr) => [
    'id',
    'Profile ' + pr.n,
    pr.cnt + ' people',
    pr.p[k],
    'prof',
    pr.id,
  ]);
  return prof.concat((MOD_GRANTS[k] || []).filter((r) => r[1] !== 'Whole tenant'));
}
/* Effective permissions: by plugin, by permission, and where each comes from. */
function effPerms(prof, groups, person, extra) {
  const out = {};
  Object.keys(MOD_PERMS).forEach((k) => {
    out[k] = MOD_PERMS[k].map((perm, i) => {
      const src = [];
      if (prof && PROF(prof).p[k] && PROF(prof).p[k][i]) src.push('profile');
      (groups || []).forEach((g) => {
        const r = (MOD_GRANTS[k] || []).find((x) => x[1] === 'Group ' + g);
        if (r && r[3][i]) src.push(g);
      });
      if (person) {
        const r = (MOD_GRANTS[k] || []).find((x) => x[0] === 'user' && x[1] === person);
        if (r && r[3][i]) src.push('personal');
      }
      if (extra && extra[k + ':' + i]) src.push('exception');
      return { perm, src };
    });
  });
  return out;
}

/* ── Activity log ─────────────────────────────────────────────────────
   d = days ago (0 today). fam = the family of the action. Without «ten», the event is of Example City. */
const LOG_FAM = {
  access: 'Sign-in',
  permissions: 'Sharing and permissions',
  create: 'Creation',
  modify: 'Change',
  delete: 'Deletion',
  run: 'Run',
  export: 'Download and export',
  settings: 'Settings',
};
const LOG_TYPE = {
  note: 'Note',
  activity: 'Activity',
  estimate: 'Estimate',
  task: 'Task',
  person: 'Person',
  group: 'Group',
  settings: 'Settings',
  organization: 'Tenant',
};
const LOG = [
  {
    id: 1,
    d: 0,
    t: '10:45',
    who: 'Sara Greco',
    fam: 'modify',
    act: 'Replaced the attachment',
    type: 'estimate',
    target: 'Estimate 2026-109 · office furniture',
    ok: 1,
    before: 'Version of 2 Oct 2026',
    after: 'Version of today · 7 items',
    ip: '10.12.4.21',
    dev: 'Chrome · Windows',
  },
  {
    id: 2,
    d: 0,
    t: '10:44',
    who: 'Mosaikit',
    fam: 'permissions',
    act: 'Groups synchronized from the identity provider',
    type: 'group',
    target: 'Planning',
    ok: 1,
    after: '23 members, 2 added',
    ip: 'internal service',
    dev: '—',
  },
  {
    id: 3,
    d: 0,
    t: '10:31',
    who: 'Elena Ricci',
    fam: 'permissions',
    act: 'Access granted',
    type: 'note',
    target: 'Site visit, north depot',
    ok: 1,
    before: 'No access for Front office',
    after: 'Front office: view',
    ip: '10.12.4.8',
    dev: 'Edge · Windows',
  },
  {
    id: 4,
    d: 0,
    t: '09:58',
    who: 'Davide Conti',
    fam: 'permissions',
    act: 'Shared with a group',
    type: 'estimate',
    target: 'Estimate 2026-114 · roof repairs',
    ok: 1,
    before: 'Private',
    after: 'Group Finance · view',
    ip: '10.12.7.33',
    dev: 'Firefox · Windows',
  },
  {
    id: 5,
    d: 0,
    t: '09:12',
    who: 'Luca Bianchi',
    fam: 'access',
    act: 'Signed in with a local account',
    type: 'person',
    target: 'Luca Bianchi',
    ok: 1,
    ip: '198.51.100.7',
    dev: 'Firefox · Android',
  },
  {
    id: 6,
    d: 0,
    t: '08:31',
    who: 'Unknown',
    fam: 'access',
    act: 'Failed sign-in · 5 wrong passwords',
    type: 'person',
    target: 'Luca Bianchi',
    ok: 0,
    after: 'Account locked for 15 minutes',
    ip: '203.0.113.9',
    dev: 'curl',
  },
  {
    id: 7,
    d: 1,
    t: '17:02',
    who: 'Davide Conti',
    fam: 'permissions',
    act: 'Shared publicly',
    type: 'activity',
    target: 'Open day 2026',
    ok: 1,
    before: 'Whole tenant',
    after: 'Public',
    ip: '10.12.7.33',
    dev: 'Firefox · Windows',
  },
  {
    id: 8,
    d: 1,
    t: '16:12',
    who: 'Davide Conti',
    fam: 'run',
    act: 'Ran the automation',
    type: 'task',
    target: 'Monthly report of open tasks',
    ok: 0,
    after: 'Time limit exceeded (30 min)',
    ip: '10.12.7.33',
    dev: 'Firefox · Windows',
  },
  {
    id: 9,
    d: 1,
    t: '11:03',
    who: 'Elena Ricci',
    fam: 'settings',
    act: 'Added to the group',
    type: 'group',
    target: 'Planning',
    ok: 1,
    after: '+ Davide Conti',
    ip: '10.12.4.8',
    dev: 'Edge · Windows',
  },
  {
    id: 10,
    d: 2,
    t: '15:40',
    who: 'Sara Greco',
    fam: 'delete',
    act: 'Deleted',
    type: 'estimate',
    target: 'Test estimate (draft)',
    ok: 1,
    after: 'In the trash for 30 days',
    ip: '10.12.4.21',
    dev: 'Chrome · Windows',
  },
  {
    id: 11,
    d: 3,
    t: '09:20',
    who: 'Paolo Fontana',
    fam: 'export',
    act: 'Downloaded',
    type: 'note',
    target: 'Site visit, north depot',
    ok: 1,
    after: 'PDF · 4 pages',
    ip: '198.51.100.80',
    dev: 'Safari · iPhone',
  },
  {
    id: 12,
    d: 4,
    t: '12:00',
    who: 'Elena Ricci',
    fam: 'create',
    act: 'Connected an integration',
    type: 'settings',
    target: 'Mail relay of the tenant',
    ok: 1,
    ip: '10.12.4.8',
    dev: 'Edge · Windows',
  },
  {
    id: 13,
    d: 6,
    t: '18:30',
    who: 'Elena Ricci',
    fam: 'settings',
    act: 'Changed the default theme',
    type: 'settings',
    target: 'Appearance of the tenant',
    ok: 1,
    before: 'Slate',
    after: 'Mosaikit',
    ip: '10.12.4.8',
    dev: 'Edge · Windows',
  },
  {
    id: 14,
    d: 12,
    t: '10:10',
    who: 'Marco Esposito',
    fam: 'create',
    act: 'Created',
    type: 'task',
    target: 'Renew the office lease',
    ok: 1,
    ip: '10.12.9.4',
    dev: 'Chrome · macOS',
  },
  {
    id: 15,
    d: 0,
    t: '10:20',
    who: 'Paola Ferri',
    fam: 'settings',
    act: 'Update prepared',
    type: 'settings',
    target: 'Notes 1.5.0',
    ten: 'Mosaikit (Platform)',
    ok: 1,
    before: '1.4.0',
    after: '1.5.0, to apply',
    ip: '10.0.0.5',
    dev: 'Firefox · Linux',
  },
  {
    id: 16,
    d: 0,
    t: '09:40',
    who: 'Mosaikit',
    fam: 'access',
    act: 'Entry refused: identity expired',
    type: 'note',
    target: 'Weekly team sync',
    ok: 0,
    ip: 'relay',
    dev: '—',
  },
  {
    id: 17,
    d: 1,
    t: '14:05',
    who: 'Anna Verdi',
    fam: 'modify',
    act: 'Edited',
    type: 'note',
    target: 'Road works plan',
    ten: 'Example County',
    ok: 1,
    ip: '10.40.2.11',
    dev: 'Chrome · Windows',
  },
  {
    id: 18,
    d: 2,
    t: '08:02',
    who: 'Mosaikit',
    fam: 'permissions',
    act: 'Groups synchronized from the identity provider',
    type: 'group',
    target: 'Field team',
    ok: 0,
    after: 'The identity provider does not answer: retry in 10 minutes',
    ip: 'internal service',
    dev: '—',
  },
  {
    id: 19,
    d: 5,
    t: '16:00',
    who: 'Matteo Ferri',
    fam: 'export',
    act: 'Exported',
    type: 'estimate',
    target: 'Estimate 2026-087 · park maintenance',
    ten: 'Green Region',
    ok: 1,
    after: 'PDF',
    ip: '10.70.1.3',
    dev: 'Chrome · Windows',
  },
  {
    id: 20,
    d: 9,
    t: '11:11',
    who: 'Paola Ferri',
    fam: 'settings',
    act: 'Tenant suspended',
    type: 'organization',
    target: 'Green Valley Union',
    ten: 'Mosaikit (Platform)',
    ok: 1,
    before: 'Active',
    after: 'Suspended',
    ip: '10.0.0.5',
    dev: 'Firefox · Linux',
  },
];
LOG.forEach((e) => {
  if (!e.ten) e.ten = 'Example City';
});

/* ── Sign-in and invitations ─────────────────────────────────────────
   The accounts behind the samples of the sign-in page: home tenant, role in each tenant. */
const ACCOUNTS = {
  'd.conti@city.example.org': {
    who: 'Davide Conti',
    home: 'Example City',
    via: 'sso',
    last: 'Example City',
    tenants: [
      ['Example City', 'User', 'home'],
      ['Example County', 'User', 'assoc'],
      ['Green Region', 'User', 'assoc'],
    ],
  },
  'e.ricci@city.example.org': {
    who: 'Elena Ricci',
    home: 'Example City',
    via: 'sso',
    tenants: [
      ['Example City', 'Tenant Manager', 'home'],
      ['Example County', 'User', 'assoc'],
      ['Green Region', 'User', 'assoc'],
    ],
  },
  'p.fontana@city.example.org': {
    who: 'Paolo Fontana',
    home: 'Example City',
    via: 'sso',
    prof: 'view',
    tenants: [['Example City', 'User', 'home']],
  },
  'a.verdi@county.example.org': {
    who: 'Anna Verdi',
    home: 'Example County',
    via: 'sso',
    tenants: [
      ['Example County', 'User', 'home'],
      ['Example City', 'User', 'assoc'],
    ],
  },
  'r.leone@region.example.org': {
    who: 'Roberta Leone',
    home: 'Green Region',
    via: 'local',
    mfa: true,
    tenants: [
      ['Green Region', 'User', 'home'],
      ['Example City', 'User', 'assoc'],
    ],
  },
  'p.ferri@platform.example.org': {
    who: 'Paola Ferri',
    home: 'Mosaikit (Platform)',
    via: 'local',
    mfa: true,
    admin: true,
    tenants: [['Mosaikit (Platform)', 'Administrator', 'home']],
  },
  'l.bianchi@city.example.org': {
    who: 'Luca Bianchi',
    home: 'Example City',
    via: 'local',
    tenants: [
      ['Example City', 'User', 'home'],
      ['Green Region', 'User', 'assoc'],
    ],
  },
  'm.ferri@region.example.org': {
    who: 'Matteo Ferri',
    home: 'Green Region',
    via: 'local',
    tenants: [['Green Region', 'User', 'home']],
  },
};
const SSO_DOMAINS = { 'city.example.org': 'Example City' };
const INVITES = [
  'g.marini@city.example.org · User · profile View and edit · Front office · 9 days ago',
  'a.galli@city.example.org · User · profile Standard · Field team · 3 days ago',
  'p.serra@city.example.org · User · profile Standard · Planning · 4 days ago',
  'm.ferri@region.example.org · User · profile View and edit · guest from Green Region · Field team · yesterday',
  'f.costa@city.example.org · User · profile Field worker · Field team · 6 days ago',
  'l.neri@city.example.org · Tenant Manager · Operations office · 2 days ago',
];

/* ── Settings ────────────────────────────────────────────────────────── */

/* Languages: the platform decides which exist, the tenant picks a subset, each person picks theirs. */
const LANGS = [
  ['en', 'English'],
  ['it', 'Italiano'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['de', 'Deutsch'],
  ['pt', 'Português'],
  ['nl', 'Nederlands'],
  ['ar', 'العربية'],
  ['ja', '日本語'],
  ['zh', '中文'],
];
/* The greys of a theme: neutral, warm or cool, light and dark. */
const GRAYS = {
  neutral: {
    l: {
      side: '#ebebeb',
      pane: '#f5f5f5',
      content: '#ffffff',
      text: '#242424',
      text2: '#424242',
      text3: '#616161',
      hover: '#e0e0e0',
      line: '#e0e0e0',
    },
    d: {
      side: '#141414',
      pane: '#242424',
      content: '#1f1f1f',
      text: '#f0f0f0',
      text2: '#d1d1d1',
      text3: '#adadad',
      hover: '#2b2b2b',
      line: '#2b2b2b',
    },
  },
  warm: {
    l: {
      side: '#efebe6',
      pane: '#f7f4f0',
      content: '#fffdfa',
      text: '#2a2420',
      text2: '#4a413a',
      text3: '#6b6058',
      hover: '#e5dfd8',
      line: '#e5dfd8',
    },
    d: {
      side: '#17130f',
      pane: '#26211c',
      content: '#1f1a16',
      text: '#f2ece6',
      text2: '#d6cdc4',
      text3: '#ada39a',
      hover: '#2e2822',
      line: '#2e2822',
    },
  },
  cool: {
    l: {
      side: '#e8edf2',
      pane: '#f3f6f9',
      content: '#ffffff',
      text: '#1d2733',
      text2: '#3a4756',
      text3: '#5c6b7c',
      hover: '#dbe3eb',
      line: '#dbe3eb',
    },
    d: {
      side: '#11161c',
      pane: '#1f2630',
      content: '#1a2027',
      text: '#e8eef5',
      text2: '#c6d0db',
      text3: '#9aa7b6',
      hover: '#26303b',
      line: '#26303b',
    },
  },
};
/* Services with a key: [id, name, group, icon, what it is for, address instead of a key]. */
const KEY_GROUPS = [
  ['ai', 'Artificial intelligence'],
  ['msg', 'Messages'],
  ['doc', 'Documents and languages'],
];
const KEY_SVC = [
  ['ai-hosted', 'Hosted AI provider', 'ai', 'spark', 'Assistant and AI steps in automations'],
  ['ai-second', 'Second AI provider', 'ai', 'spark', 'Assistant and AI steps in automations'],
  [
    'ai-local',
    'Self-hosted model',
    'ai',
    'cpu',
    'A model running on one of your servers',
    'http://llm.internal:11434',
  ],
  ['sms', 'Text message gateway', 'msg', 'message', 'Sign-in codes and urgent notifications'],
  ['push', 'Push notifications', 'msg', 'bell', 'Notifications on phones'],
  ['translate', 'Translation service', 'doc', 'globe', 'Translation of texts in the apps'],
  ['ocr', 'Document recognition', 'doc', 'file', 'Reads scanned documents and receipts'],
];
const BACKUPS = [
  ['b1', 'Today 02:00', 'Full', '38.2 GB', 'ok'],
  ['b2', 'Yesterday 02:00', 'Full', '38.0 GB', 'ok'],
  ['b3', '6 Oct 2026 02:00', 'Full', '37.7 GB', 'ok'],
  ['b4', '5 Oct 2026 02:00', 'Full', '—', 'bad'],
  ['b5', '1 Oct 2026 02:00', 'Monthly', '37.1 GB', 'ok'],
];

/* ── Monitoring ──────────────────────────────────────────────────────── */

const MON_SVC = [
  ['kernel', 'Mosaikit kernel', 'ok', '1.0.0 · 2 instances', 180, 0.2, 'API, shell and extensions'],
  [
    'keycloak',
    'Sign-in',
    'ok',
    '2 identity providers (OIDC)',
    95,
    0.0,
    'Local accounts with argon2id, and the identity providers of the tenants',
  ],
  [
    'relay',
    'Collaboration relay',
    'ok',
    '1.0 · 11 sessions',
    40,
    0.1,
    'Shared sessions in real time',
  ],
  [
    'worker',
    'Automation worker',
    'warn',
    '0.9 · queue of 6 jobs',
    1200,
    2.4,
    'Scheduled and heavy jobs of the apps',
  ],
  ['search', 'Search index', 'ok', '2,312 documents', 35, 0.0, 'Global search across apps'],
  [
    'postgres',
    'PostgreSQL',
    'ok',
    '16 · disk at 42%',
    12,
    0.0,
    'The database of the platform and of the apps',
  ],
  ['objects', 'File storage', 'ok', '31 GB', 35, 0.0, 'Attachments and documents'],
  [
    'mail',
    'Mail relay',
    'ok',
    '3,108 messages today',
    60,
    0.0,
    'Invitations, notifications and alerts',
  ],
];
const MON_ST = { ok: ['Healthy', 'ok'], warn: ['Degraded', 'warn'], bad: ['Down', 'bad'] };

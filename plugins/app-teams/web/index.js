// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/**
 * Teams (MK-034): the teams of the person, their channels and the posts of each channel, with
 * threads, mentions and reactions. A plugin without a backend (ADR-0033): the teams and their people
 * are those of the kernel (MK-032), the channels and posts are documents of the data API shared with
 * the team, so that only its people read them. A private channel is a group of the team, and its
 * posts are shared with that group only. Posts of others appear at once through the real-time
 * channel (MK-031); mentions reach the activity feed (MK-038).
 */

const GENERAL = 'general';
const REACTIONS = ['👍', '❤️', '🎉', '😄'];
/** `@name@example.org` names a person, `@team` everyone of the team. */
const MENTION = /@(team|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

const STYLE = `
  :host { display: block; color: var(--mk-fg); }
  .layout { display: grid; grid-template-columns: minmax(200px, 260px) 1fr; gap: 16px; align-items: start; }
  @media (max-width: 720px) { .layout { grid-template-columns: 1fr; } }
  nav, main { background: var(--mk-surface); border: 1px solid var(--mk-line); border-radius: var(--mk-radius); padding: 16px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  h2 { font-size: 18px; margin: 0; }
  h3 { font-size: 14px; margin: 16px 0 6px; color: var(--mk-muted); }
  ul { list-style: none; margin: 0; padding: 0; }
  nav li button { width: 100%; text-align: left; }
  .channels { margin: 4px 0 8px 12px; }
  button, input, select, textarea { font: inherit; color: var(--mk-fg); }
  button { padding: 6px 10px; border-radius: var(--mk-radius); cursor: pointer;
           border: 1px solid var(--mk-line); background: var(--mk-surface); }
  button.primary { border-color: var(--mk-accent); background: var(--mk-accent); color: var(--mk-accent-fg); }
  button.link { border-color: transparent; background: transparent; padding: 4px 8px; }
  button[aria-current='true'] { background: var(--mk-accent-soft); font-weight: 600; }
  input, select, textarea { padding: 6px 8px; border: 1px solid var(--mk-line); border-radius: var(--mk-radius);
           background: var(--mk-bg); box-sizing: border-box; }
  textarea { width: 100%; min-height: 60px; resize: vertical; }
  form { display: grid; gap: 6px; margin: 8px 0; }
  form .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
  article { border-top: 1px solid var(--mk-line); padding: 10px 0; }
  article .meta { color: var(--mk-muted); font-size: 13px; }
  article p { margin: 4px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .mention { color: var(--mk-accent); font-weight: 600; }
  .replies { margin-left: 20px; border-left: 2px solid var(--mk-line); padding-left: 12px; }
  .reactions { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
  .reactions button[aria-pressed='true'] { border-color: var(--mk-accent); background: var(--mk-accent-soft); }
  .muted { color: var(--mk-muted); }
  .people li { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; }
  :focus-visible { outline: 2px solid var(--mk-focus); outline-offset: 2px; }
`;

/** @type {import('@mosaikit/sdk').MosaikitPlugin} */
const plugin = {
  activate(context) {
    if (customElements.get('mk-app-teams')) {
      return;
    }
    const me = context.user;

    /** Calls the kernel, and turns a refusal into an error with its detail. */
    async function call(path, init = {}) {
      const response = await context.fetch(path, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...init.headers },
      });
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const problem = await response.json();
          detail = problem.detail ?? problem.title ?? detail;
        } catch {
          // not a problem detail
        }
        throw new Error(detail);
      }
      return response.status === 204 ? undefined : response.json();
    }

    /** Builds an element with attributes and children; text is never parsed as HTML. */
    function h(tag, attributes = {}, ...children) {
      const element = document.createElement(tag);
      for (const [name, value] of Object.entries(attributes)) {
        if (value === undefined || value === null || value === false) {
          continue;
        }
        if (name.startsWith('on')) {
          element.addEventListener(name.slice(2), value);
        } else {
          element.setAttribute(name, value === true ? '' : String(value));
        }
      }
      element.append(
        ...children.flat(Infinity).filter((child) => child !== null && child !== undefined),
      );
      return element;
    }

    /** The text of a post, with its mentions highlighted. */
    function withMentions(text) {
      const parts = [];
      let last = 0;
      for (const match of text.matchAll(MENTION)) {
        parts.push(text.slice(last, match.index));
        parts.push(h('span', { class: 'mention' }, match[0]));
        last = match.index + match[0].length;
      }
      parts.push(text.slice(last));
      return parts;
    }

    class AppTeams extends HTMLElement {
      teams = [];
      team = null;
      people = [];
      channels = [];
      groups = [];
      channel = GENERAL;
      posts = [];
      replying = null;
      showPeople = false;

      connectedCallback() {
        this.root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        this.onLocation = () => void this.fromLocation();
        window.addEventListener('popstate', this.onLocation);
        void this.fromLocation();
      }

      disconnectedCallback() {
        window.removeEventListener('popstate', this.onLocation);
        this.stopChannels?.();
        this.stopPosts?.();
      }

      /** Opens the team and channel of the address, such as the link of a mention. */
      async fromLocation() {
        const query = new URLSearchParams(location.search);
        await this.loadTeams();
        const wanted = query.get('team');
        const team =
          this.teams.find((candidate) => candidate.id === wanted) ?? this.team ?? this.teams[0];
        if (team) {
          await this.open(
            team.id,
            query.get('channel') ?? (team.id === this.team?.id ? this.channel : GENERAL),
          );
        } else {
          this.render();
        }
      }

      async loadTeams() {
        try {
          this.teams = await call('/api/v1/teams');
        } catch (error) {
          this.teams = [];
          this.say(`The teams cannot be read: ${error.message}`);
        }
      }

      /** Opens a team and one of its channels, and follows their changes. */
      async open(teamId, channel = GENERAL) {
        const changed = this.team?.id !== teamId;
        this.team = this.teams.find((candidate) => candidate.id === teamId) ?? null;
        if (!this.team) {
          this.render();
          return;
        }
        if (changed) {
          this.showPeople = false;
          this.stopChannels?.();
          this.channelData = context.data('channels', { team: teamId });
          this.stopChannels = this.channelData.onChange(
            () => void this.loadChannels().then(() => this.render()),
          );
        }
        await this.loadChannels();
        const known =
          channel === GENERAL ||
          this.channels.some((c) => c.id === channel) ||
          this.groups.some((g) => g.id === channel);
        this.channel = known ? channel : GENERAL;
        this.replying = null;
        this.follow();
        await this.loadPosts();
        this.render();
      }

      async loadChannels() {
        try {
          const [detail, channels, groups] = await Promise.all([
            call(`/api/v1/teams/${this.team.id}`),
            this.channelData.list({ limit: 500 }),
            call(`/api/v1/teams?parent=${encodeURIComponent(this.team.id)}`),
          ]);
          this.people = detail.members ?? [];
          this.team = { ...this.team, role: detail.role };
          this.channels = channels
            .map((document) => ({ id: document.id, name: document.data.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
          this.groups = groups;
        } catch (error) {
          this.say(`The channels cannot be read: ${error.message}`);
        }
      }

      /** Where the posts of the open channel are shared: the team, or the group of a private channel. */
      scope() {
        return this.groups.some((group) => group.id === this.channel) ? this.channel : this.team.id;
      }

      follow() {
        this.stopPosts?.();
        this.postData = context.data('posts', { team: this.scope() });
        // Posts, replies and reactions of the others show at once (MK-031).
        this.stopPosts = this.postData.onChange(
          () => void this.loadPosts().then(() => this.renderPosts()),
        );
      }

      async loadPosts() {
        try {
          const all = await this.postData.list({ limit: 500 });
          this.posts = all.filter((post) => post.data.channel === this.channel);
        } catch (error) {
          this.posts = [];
          this.say(`The posts cannot be read: ${error.message}`);
        }
      }

      channelName() {
        if (this.channel === GENERAL) {
          return 'General';
        }
        return (
          this.channels.find((c) => c.id === this.channel)?.name ??
          this.groups.find((g) => g.id === this.channel)?.name ??
          ''
        );
      }

      say(message) {
        const status = this.root.querySelector('[role=status]');
        if (status) {
          status.textContent = message;
        }
        this.lastMessage = message;
      }

      async run(change, done) {
        try {
          await change();
          this.say(done ?? '');
        } catch (error) {
          this.say(`Not saved: ${error.message}`);
        }
      }

      render() {
        const teamList = this.teams.map((team) =>
          h(
            'li',
            {},
            h(
              'button',
              {
                type: 'button',
                class: 'link',
                'aria-current': String(team.id === this.team?.id),
                onclick: () => void this.navigate(team.id, GENERAL),
              },
              team.name,
            ),
            team.id === this.team?.id ? this.renderChannels() : null,
          ),
        );
        const nav = h(
          'nav',
          { 'aria-label': 'Teams' },
          h('h1', {}, 'Teams'),
          this.teams.length === 0 ? h('p', { class: 'muted' }, 'You are in no team yet.') : null,
          h('ul', {}, teamList),
          this.renderNewTeam(),
        );
        const main = this.team
          ? h(
              'main',
              {},
              this.renderHeader(),
              this.showPeople ? this.renderPeople() : null,
              this.renderComposer(),
              h('div', { id: 'posts' }),
            )
          : h(
              'main',
              {},
              h('p', { class: 'muted' }, 'Create a team, or ask a colleague to add you to one.'),
            );
        // What the person is typing survives the changes that arrive meanwhile.
        const drafts = this.drafts();
        this.root.replaceChildren(
          h('style', {}, STYLE),
          h('div', { class: 'layout' }, nav, main),
          h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' }, this.lastMessage ?? ''),
        );
        if (this.team) {
          this.renderPosts();
        }
        this.restore(drafts);
      }

      /** The texts being typed, by the label of their field, and the field that has the focus. */
      drafts() {
        const fields = [...this.root.querySelectorAll('textarea, input:not([type=checkbox])')];
        return {
          values: new Map(
            fields
              .filter((field) => field.value)
              .map((field) => [field.getAttribute('aria-label'), field.value]),
          ),
          focused: this.root.activeElement?.getAttribute?.('aria-label') ?? null,
        };
      }

      restore({ values, focused }) {
        for (const field of this.root.querySelectorAll('textarea, input:not([type=checkbox])')) {
          const label = field.getAttribute('aria-label');
          if (values.has(label)) {
            field.value = values.get(label);
          }
          if (label && label === focused) {
            field.focus();
          }
        }
      }

      async navigate(teamId, channel) {
        history.pushState(
          null,
          '',
          `/app/teams?team=${encodeURIComponent(teamId)}&channel=${encodeURIComponent(channel)}`,
        );
        await this.open(teamId, channel);
      }

      renderChannels() {
        const item = (id, name, isPrivate) =>
          h(
            'li',
            {},
            h(
              'button',
              {
                type: 'button',
                class: 'link',
                'aria-current': String(id === this.channel),
                'aria-label': isPrivate ? `${name}, private channel` : `${name} channel`,
                onclick: () => void this.navigate(this.team.id, id),
              },
              `${isPrivate ? '🔒' : '#'} ${name}`,
            ),
          );
        const guest = this.team.role === 'guest';
        return h(
          'div',
          { class: 'channels' },
          h(
            'ul',
            { 'aria-label': `Channels of ${this.team.name}` },
            item(GENERAL, 'General', false),
            this.channels.map((c) => item(c.id, c.name, false)),
            this.groups.map((g) => item(g.id, g.name, true)),
          ),
          guest
            ? null
            : h(
                'form',
                {
                  'aria-label': 'New channel',
                  onsubmit: (event) => {
                    event.preventDefault();
                    const form = event.target;
                    const name = form.elements.namedItem('name').value.trim();
                    const isPrivate = form.elements.namedItem('private').checked;
                    if (name) {
                      void this.run(
                        () => this.createChannel(name, isPrivate),
                        `Channel ${name} created.`,
                      );
                    }
                  },
                },
                h('input', {
                  name: 'name',
                  'aria-label': 'Channel name',
                  placeholder: 'New channel',
                  maxlength: 100,
                  required: true,
                }),
                h(
                  'div',
                  { class: 'row' },
                  h('label', {}, h('input', { type: 'checkbox', name: 'private' }), ' Private'),
                  h('button', { type: 'submit' }, 'Add channel'),
                ),
              ),
        );
      }

      async createChannel(name, isPrivate) {
        let id;
        if (isPrivate) {
          // A private channel is a group of the team: only its people read its posts (MK-034).
          const group = await call('/api/v1/teams', {
            method: 'POST',
            body: JSON.stringify({ name, parent: this.team.id }),
          });
          id = group.id;
        } else {
          id = (await this.channelData.create({ name })).id;
        }
        await this.navigate(this.team.id, id);
      }

      renderNewTeam() {
        return h(
          'form',
          {
            'aria-label': 'New team',
            onsubmit: (event) => {
              event.preventDefault();
              const form = event.target;
              const name = form.elements.namedItem('team').value.trim();
              const visibility = form.elements.namedItem('visibility').value;
              if (name) {
                void this.run(async () => {
                  const team = await call('/api/v1/teams', {
                    method: 'POST',
                    body: JSON.stringify({ name, visibility }),
                  });
                  await this.loadTeams();
                  await this.navigate(team.id, GENERAL);
                }, `Team ${name} created.`);
              }
            },
          },
          h('h3', {}, 'New team'),
          h('input', {
            name: 'team',
            'aria-label': 'Team name',
            placeholder: 'Name of the team',
            maxlength: 100,
            required: true,
          }),
          h(
            'div',
            { class: 'row' },
            h(
              'select',
              { name: 'visibility', 'aria-label': 'Visibility' },
              h('option', { value: 'private' }, 'Private'),
              h('option', { value: 'public' }, 'Public'),
            ),
            h('button', { type: 'submit', class: 'primary' }, 'Create team'),
          ),
        );
      }

      renderHeader() {
        return h(
          'header',
          {},
          h('h2', {}, `${this.channelName()} · ${this.team.name}`),
          h(
            'button',
            {
              type: 'button',
              'aria-expanded': String(this.showPeople),
              onclick: () => {
                this.showPeople = !this.showPeople;
                this.render();
              },
            },
            `People (${this.people.length})`,
          ),
        );
      }

      renderPeople() {
        const owner = this.team.role === 'owner';
        return h(
          'section',
          { 'aria-label': 'People of the team' },
          h(
            'ul',
            { class: 'people' },
            this.people.map((person) =>
              h(
                'li',
                {},
                h(
                  'span',
                  {},
                  `${person.displayName} `,
                  h('span', { class: 'muted' }, person.email),
                ),
                h('span', { class: 'muted' }, person.role),
              ),
            ),
          ),
          owner
            ? h(
                'form',
                {
                  'aria-label': 'Add a person',
                  onsubmit: (event) => {
                    event.preventDefault();
                    const form = event.target;
                    const email = form.elements.namedItem('email').value.trim();
                    const role = form.elements.namedItem('role').value;
                    if (email) {
                      void this.run(async () => {
                        await call(
                          `/api/v1/teams/${this.team.id}/members/${encodeURIComponent(email)}`,
                          {
                            method: 'PUT',
                            body: JSON.stringify({ role }),
                          },
                        );
                        await this.loadChannels();
                        this.render();
                      }, `${email} added.`);
                    }
                  },
                },
                h(
                  'div',
                  { class: 'row' },
                  h('input', {
                    type: 'email',
                    name: 'email',
                    'aria-label': 'Email of the person',
                    placeholder: 'name@example.org',
                    required: true,
                  }),
                  h(
                    'select',
                    { name: 'role', 'aria-label': 'Role' },
                    h('option', { value: 'member' }, 'Member'),
                    h('option', { value: 'owner' }, 'Owner'),
                    h('option', { value: 'guest' }, 'Guest'),
                  ),
                  h('button', { type: 'submit' }, 'Add'),
                ),
              )
            : null,
        );
      }

      renderComposer() {
        return h(
          'form',
          {
            'aria-label': 'New post',
            onsubmit: (event) => {
              event.preventDefault();
              const text = event.target.elements.namedItem('text');
              const value = text.value.trim();
              if (value) {
                text.value = '';
                void this.run(() => this.post(value, null));
              }
            },
          },
          h('textarea', {
            name: 'text',
            'aria-label': `Message in ${this.channelName()}`,
            placeholder: 'Write a post; @name@example.org or @team to mention',
            maxlength: 4000,
            required: true,
          }),
          h('div', { class: 'row' }, h('button', { type: 'submit', class: 'primary' }, 'Post')),
        );
      }

      renderPosts() {
        const area = this.root.querySelector('#posts');
        if (!area) {
          return;
        }
        const drafts = this.drafts();
        const roots = this.posts.filter((post) => !post.data.parent).reverse();
        const repliesOf = (id) => this.posts.filter((post) => post.data.parent === id).reverse();
        area.replaceChildren(
          roots.length === 0
            ? h('p', { class: 'muted' }, 'No posts yet: start the conversation.')
            : h(
                'ul',
                { 'aria-label': 'Posts' },
                roots.map((post) => h('li', {}, this.renderPost(post, repliesOf(post.id)))),
              ),
        );
        this.restore(drafts);
      }

      renderPost(post, replies) {
        const reply = this.replying === post.id;
        return h(
          'article',
          { 'aria-label': `Post of ${post.data.author}` },
          this.renderBody(post),
          h(
            'div',
            { class: 'replies' },
            replies.length > 0
              ? h(
                  'ul',
                  { 'aria-label': 'Replies' },
                  replies.map((r) =>
                    h(
                      'li',
                      {},
                      h(
                        'article',
                        { 'aria-label': `Reply of ${r.data.author}` },
                        this.renderBody(r),
                      ),
                    ),
                  ),
                )
              : null,
            reply
              ? h(
                  'form',
                  {
                    'aria-label': 'Reply',
                    onsubmit: (event) => {
                      event.preventDefault();
                      const field = event.target.elements.namedItem('text');
                      const value = field.value.trim();
                      field.value = '';
                      if (value) {
                        this.replying = null;
                        void this.run(() => this.post(value, post.id));
                      }
                    },
                  },
                  h('textarea', {
                    name: 'text',
                    'aria-label': 'Your reply',
                    maxlength: 4000,
                    required: true,
                  }),
                  h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Send reply')),
                )
              : h(
                  'button',
                  {
                    type: 'button',
                    class: 'link',
                    onclick: () => {
                      this.replying = post.id;
                      this.renderPosts();
                      this.root.querySelector('textarea[aria-label="Your reply"]')?.focus();
                    },
                  },
                  'Reply',
                ),
          ),
        );
      }

      renderBody(post) {
        const reactions = post.data.reactions ?? {};
        return [
          h(
            'div',
            { class: 'meta' },
            `${post.data.author} · ${new Date(post.createdAt).toLocaleString(context.locale)}`,
          ),
          h('p', {}, withMentions(post.data.text)),
          h(
            'div',
            { class: 'reactions' },
            REACTIONS.map((emoji) => {
              const who = reactions[emoji] ?? [];
              const mine = who.includes(me.username);
              return h(
                'button',
                {
                  type: 'button',
                  'aria-pressed': String(mine),
                  'aria-label': `${emoji} ${who.length}`,
                  title: who.join(', '),
                  onclick: () => void this.run(() => this.react(post, emoji)),
                },
                who.length > 0 ? `${emoji} ${who.length}` : emoji,
              );
            }),
          ),
        ];
      }

      /** Adds a post or a reply, and notifies the people it mentions. */
      async post(text, parent) {
        await this.postData.create({
          channel: this.channel,
          text,
          parent: parent ?? undefined,
          author: me.displayName,
          authorEmail: me.username,
          reactions: {},
        });
        await this.loadPosts();
        this.renderPosts();
        await this.mention(text);
      }

      async mention(text) {
        const named = new Set();
        let everyone = false;
        for (const match of text.matchAll(MENTION)) {
          if (match[1] === 'team') {
            everyone = true;
          } else {
            named.add(match[1].toLowerCase());
          }
        }
        if (everyone) {
          for (const person of this.people) {
            named.add(person.email);
          }
        }
        // Only the people who can read the channel: those of the team, or of the private channel.
        const readers =
          this.scope() === this.team.id
            ? new Set(this.people.map((person) => person.email))
            : new Set(
                ((await call(`/api/v1/teams/${this.scope()}`)).members ?? []).map(
                  (person) => person.email,
                ),
              );
        const to = [...named].filter((email) => email !== me.username && readers.has(email));
        if (to.length === 0) {
          return;
        }
        await context.notify({
          to,
          kind: 'mention',
          title: `${me.displayName} mentioned you in ${this.channelName()}`,
          body: text.length > 300 ? `${text.slice(0, 297)}...` : text,
          link: `/app/teams?team=${this.team.id}&channel=${this.channel}`,
        });
      }

      /** Adds or takes back a reaction of the person, again if someone changed the post meanwhile. */
      async react(post, emoji) {
        let current = post;
        for (let attempt = 0; attempt < 3; attempt++) {
          const reactions = { ...(current.data.reactions ?? {}) };
          const who = new Set(reactions[emoji] ?? []);
          if (who.has(me.username)) {
            who.delete(me.username);
          } else {
            who.add(me.username);
          }
          reactions[emoji] = [...who];
          try {
            await this.postData.update(current.id, { ...current.data, reactions }, current.version);
            break;
          } catch (error) {
            if (error.status !== 409 || attempt === 2) {
              throw error;
            }
            current = await this.postData.get(post.id);
          }
        }
        await this.loadPosts();
        this.renderPosts();
      }
    }

    customElements.define('mk-app-teams', AppTeams);
  },
};

export default plugin;

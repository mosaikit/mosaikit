// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/**
 * Chat (MK-036): chats one to one and in groups. A plugin without a backend (ADR-0033): a chat is
 * a group of the kernel of kind `chat`, seen only by its people, and its messages are documents of
 * the data API shared with it, kept as history and read by its people only. Messages, and where
 * each person is (what they read, whether they are typing), arrive at once through the real-time
 * channel (MK-031).
 *
 * A message can carry a card, which other plugins publish by adding a message to the collection
 * `messages` of the chat: `{ text, card: { title, text?, fields?: [{ label, value }], actions?:
 * [{ label, link } | { label, request: { method, path, body? } }] } }`. An action runs in the page of
 * the person who chooses it, with their rights: a link opens a page of the shell, a request calls
 * the API of the kernel as them.
 */

/** How long a "typing" lasts without news, and how often it is said again while typing. */
const TYPING_FOR = 6000;
const TYPING_EVERY = 3000;
const METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);

const STYLE = `
  :host { display: block; color: var(--mk-fg); }
  .layout { display: grid; grid-template-columns: minmax(200px, 280px) 1fr; gap: 16px; align-items: start; }
  @media (max-width: 720px) { .layout { grid-template-columns: 1fr; } }
  nav, main { background: var(--mk-surface); border: 1px solid var(--mk-line); border-radius: var(--mk-radius); padding: 16px; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  h2 { font-size: 18px; margin: 0 0 8px; }
  h3 { font-size: 14px; margin: 16px 0 6px; color: var(--mk-muted); }
  ul { list-style: none; margin: 0; padding: 0; }
  nav li button { width: 100%; text-align: left; }
  button, input, textarea { font: inherit; color: var(--mk-fg); }
  button { padding: 6px 10px; border-radius: var(--mk-radius); cursor: pointer;
           border: 1px solid var(--mk-line); background: var(--mk-surface); }
  button.primary { border-color: var(--mk-accent); background: var(--mk-accent); color: var(--mk-accent-fg); }
  button.link { border-color: transparent; background: transparent; padding: 6px 8px; }
  button[aria-current='true'] { background: var(--mk-accent-soft); font-weight: 600; }
  input, textarea { padding: 6px 8px; border: 1px solid var(--mk-line); border-radius: var(--mk-radius);
           background: var(--mk-bg); box-sizing: border-box; width: 100%; }
  textarea { min-height: 48px; resize: vertical; }
  form { display: grid; gap: 6px; margin: 8px 0; }
  .messages { max-height: 60vh; overflow-y: auto; display: grid; gap: 8px; padding: 4px 0; }
  .message { max-width: 80%; padding: 8px 12px; border-radius: var(--mk-radius); background: var(--mk-bg);
             border: 1px solid var(--mk-line); }
  .message.mine { justify-self: end; background: var(--mk-accent-soft); }
  .message .meta { color: var(--mk-muted); font-size: 12px; }
  .message p { margin: 2px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .card { margin-top: 6px; border: 1px solid var(--mk-line); border-left: 4px solid var(--mk-accent);
          border-radius: var(--mk-radius); padding: 8px 10px; background: var(--mk-surface); }
  .card strong { display: block; }
  .card dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 6px 0; }
  .card dt { color: var(--mk-muted); }
  .card dd { margin: 0; }
  .card .actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .muted { color: var(--mk-muted); }
  .status-line { min-height: 1.4em; font-size: 13px; }
  :focus-visible { outline: 2px solid var(--mk-focus); outline-offset: 2px; }
`;

/** @type {import('@mosaikit/sdk').MosaikitPlugin} */
const plugin = {
  activate(context) {
    if (customElements.get('mk-app-chat')) {
      return;
    }
    const me = context.user;

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
      return response.status === 204 || response.status === 202 ? undefined : response.json();
    }

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

    /** Whether one instant comes before another; ISO texts of the kernel differ in their decimals. */
    const before = (one, other) => Date.parse(one) < Date.parse(other);

    /** The name of a chat: its own, or the people in it other than the person. */
    function nameOf(chat) {
      if (chat.name) {
        return chat.name;
      }
      const others = (chat.members ?? []).filter((person) => person.email !== me.username);
      return others.map((person) => person.displayName).join(', ') || 'Only you';
    }

    function names(emails, chat) {
      return emails.map(
        (email) =>
          (chat?.members ?? []).find((person) => person.email === email)?.displayName ?? email,
      );
    }

    class AppChat extends HTMLElement {
      chats = [];
      chat = null;
      messages = [];
      reads = [];
      lastTyping = 0;

      connectedCallback() {
        this.root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        this.onLocation = () => void this.fromLocation();
        window.addEventListener('popstate', this.onLocation);
        // A new chat shows as soon as its first message notifies the person (MK-038).
        this.stopNotifications = context.live.subscribe(
          'notifications',
          () => void this.refreshChats(),
        );
        this.ticker = setInterval(() => this.renderStatusLine(), 2000);
        void this.fromLocation();
      }

      disconnectedCallback() {
        window.removeEventListener('popstate', this.onLocation);
        this.stopNotifications?.();
        this.stopMessages?.();
        this.stopReads?.();
        clearInterval(this.ticker);
      }

      async fromLocation() {
        await this.loadChats();
        const wanted = new URLSearchParams(location.search).get('chat');
        const chat =
          this.chats.find((candidate) => candidate.id === wanted) ?? this.chat ?? this.chats[0];
        if (chat) {
          await this.open(chat.id);
        } else {
          this.render();
        }
      }

      async loadChats() {
        try {
          this.chats = await call('/api/v1/teams?kind=chat');
        } catch (error) {
          this.chats = [];
          this.lastMessage = `The chats cannot be read: ${error.message}`;
        }
      }

      async refreshChats() {
        const known = this.chats.length;
        await this.loadChats();
        if (this.chats.length !== known) {
          if (!this.chat && this.chats[0]) {
            await this.open(this.chats[0].id);
          } else {
            this.render();
          }
        }
      }

      async open(chatId) {
        const changed = this.chat?.id !== chatId;
        this.chat = this.chats.find((candidate) => candidate.id === chatId) ?? null;
        if (!this.chat) {
          this.render();
          return;
        }
        if (changed) {
          this.stopMessages?.();
          this.stopReads?.();
          this.messageData = context.data('messages', { team: chatId });
          this.readData = context.data('reads', { team: chatId });
          this.stopMessages = this.messageData.onChange(
            () => void this.loadMessages().then(() => this.afterMessages()),
          );
          this.stopReads = this.readData.onChange(
            () => void this.loadReads().then(() => this.renderStatusLine()),
          );
        }
        await Promise.all([this.loadMessages(), this.loadReads()]);
        this.render();
        await this.markRead();
      }

      async loadMessages() {
        try {
          this.messages = (await this.messageData.list({ limit: 500 })).reverse();
        } catch (error) {
          this.messages = [];
          this.lastMessage = `The messages cannot be read: ${error.message}`;
        }
      }

      async loadReads() {
        try {
          this.reads = await this.readData.list({ limit: 100 });
        } catch {
          this.reads = [];
        }
      }

      async afterMessages() {
        this.renderMessages();
        await this.markRead();
      }

      /** Where the person is in the chat: what they read last, and when they last typed. */
      async whereIAm(change) {
        const mine = this.reads.find((read) => read.data.person === me.username);
        const data = {
          person: me.username,
          readAt: mine?.data.readAt ?? null,
          typingAt: mine?.data.typingAt ?? null,
          ...change,
        };
        try {
          if (mine) {
            await this.readData.update(mine.id, data);
          } else {
            await this.readData.create(data);
          }
        } catch {
          // Only an indicator: the next change says it again.
        }
      }

      async markRead() {
        const last = this.messages.at(-1);
        if (!last || document.visibilityState === 'hidden') {
          return;
        }
        const mine = this.reads.find((read) => read.data.person === me.username);
        if (mine?.data.readAt && !before(mine.data.readAt, last.createdAt) && !mine.data.typingAt) {
          return;
        }
        await this.whereIAm({ readAt: last.createdAt, typingAt: null });
      }

      typing() {
        const now = Date.now();
        if (now - this.lastTyping > TYPING_EVERY) {
          this.lastTyping = now;
          void this.whereIAm({ typingAt: new Date(now).toISOString() });
        }
      }

      render() {
        const drafts = this.drafts();
        const nav = h(
          'nav',
          { 'aria-label': 'Chats' },
          h('h1', {}, 'Chat'),
          this.chats.length === 0 ? h('p', { class: 'muted' }, 'No chats yet.') : null,
          h(
            'ul',
            {},
            this.chats.map((chat) =>
              h(
                'li',
                {},
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'link',
                    'aria-current': String(chat.id === this.chat?.id),
                    onclick: () => {
                      history.pushState(null, '', `/app/chat?chat=${encodeURIComponent(chat.id)}`);
                      void this.open(chat.id);
                    },
                  },
                  nameOf(chat),
                ),
              ),
            ),
          ),
          this.renderNewChat(),
        );
        const main = this.chat
          ? h(
              'main',
              {},
              h('h2', {}, nameOf(this.chat)),
              h('div', { id: 'messages' }),
              h('p', { class: 'muted status-line', 'aria-live': 'polite', id: 'presence' }),
              this.renderComposer(),
            )
          : h('main', {}, h('p', { class: 'muted' }, 'Start a chat with a colleague.'));
        this.root.replaceChildren(
          h('style', {}, STYLE),
          h('div', { class: 'layout' }, nav, main),
          h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' }, this.lastMessage ?? ''),
        );
        if (this.chat) {
          this.renderMessages();
          this.renderStatusLine();
        }
        this.restore(drafts);
      }

      drafts() {
        const fields = [...this.root.querySelectorAll('textarea, input')];
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
        for (const field of this.root.querySelectorAll('textarea, input')) {
          const label = field.getAttribute('aria-label');
          if (values.has(label)) {
            field.value = values.get(label);
          }
          if (label && label === focused) {
            field.focus();
          }
        }
      }

      renderNewChat() {
        return h(
          'form',
          {
            'aria-label': 'New chat',
            onsubmit: (event) => {
              event.preventDefault();
              const form = event.target;
              const people = form.elements
                .namedItem('people')
                .value.split(/[\s,;]+/)
                .filter(Boolean);
              const name = form.elements.namedItem('name').value.trim();
              if (people.length > 0) {
                void this.startChat(people, name, form);
              }
            },
          },
          h('h3', {}, 'New chat'),
          h('input', {
            name: 'people',
            'aria-label': 'People',
            placeholder: 'name@example.org, …',
            required: true,
          }),
          h('input', {
            name: 'name',
            'aria-label': 'Name of the group (optional)',
            placeholder: 'Name of the group (optional)',
            maxlength: 100,
          }),
          h('button', { type: 'submit', class: 'primary' }, 'Start chat'),
        );
      }

      async startChat(people, name, form) {
        try {
          const chat = await call('/api/v1/teams', {
            method: 'POST',
            body: JSON.stringify({ kind: 'chat', people, name: name || undefined }),
          });
          form.reset();
          await this.loadChats();
          history.pushState(null, '', `/app/chat?chat=${encodeURIComponent(chat.id)}`);
          this.lastMessage = '';
          await this.open(chat.id);
        } catch (error) {
          this.lastMessage = `The chat was not started: ${error.message}`;
          this.render();
        }
      }

      renderComposer() {
        const send = (textarea) => {
          const text = textarea.value.trim();
          if (text) {
            textarea.value = '';
            void this.send(text);
          }
        };
        return h(
          'form',
          {
            'aria-label': 'New message',
            onsubmit: (event) => {
              event.preventDefault();
              send(event.target.elements.namedItem('text'));
            },
          },
          h('textarea', {
            name: 'text',
            'aria-label': `Message to ${nameOf(this.chat)}`,
            placeholder: 'Write a message; Enter sends it, Shift+Enter starts a new line',
            maxlength: 4000,
            oninput: () => this.typing(),
            onkeydown: (event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send(event.target);
              }
            },
          }),
          h('button', { type: 'submit', class: 'primary' }, 'Send'),
        );
      }

      async send(text) {
        try {
          await this.messageData.create({ text, author: me.displayName, authorEmail: me.username });
          this.lastTyping = 0;
          await this.loadMessages();
          await this.afterMessages();
          const to = (this.chat.members ?? [])
            .map((person) => person.email)
            .filter((email) => email !== me.username);
          if (to.length > 0) {
            await context.notify({
              to,
              kind: 'message',
              title: this.chat.name
                ? `${me.displayName} in ${this.chat.name}`
                : `Message from ${me.displayName}`,
              body: text.length > 300 ? `${text.slice(0, 297)}...` : text,
              link: `/app/chat?chat=${this.chat.id}`,
            });
          }
        } catch (error) {
          this.say(`Not sent: ${error.message}`);
        }
      }

      say(message) {
        this.lastMessage = message;
        const status = this.root.querySelector('[role=status]');
        if (status) {
          status.textContent = message;
        }
      }

      renderMessages() {
        const area = this.root.querySelector('#messages');
        if (!area) {
          return;
        }
        const drafts = this.drafts();
        area.replaceChildren(
          this.messages.length === 0
            ? h('p', { class: 'muted' }, 'No messages yet: say hello.')
            : h(
                'ul',
                { class: 'messages', 'aria-label': 'Messages' },
                this.messages.map((message) => h('li', {}, this.renderMessage(message))),
              ),
        );
        area.querySelector('.messages')?.scrollTo({ top: Number.MAX_SAFE_INTEGER });
        this.restore(drafts);
      }

      renderMessage(message) {
        const mine = message.createdBy === me.username;
        const author = message.data.author ?? names([message.createdBy], this.chat)[0];
        return h(
          'article',
          { class: `message${mine ? ' mine' : ''}`, 'aria-label': `Message of ${author}` },
          h(
            'div',
            { class: 'meta' },
            `${author} · ${new Date(message.createdAt).toLocaleTimeString(context.locale, { hour: '2-digit', minute: '2-digit' })}`,
          ),
          message.data.text ? h('p', {}, String(message.data.text)) : null,
          message.data.card ? this.renderCard(message.data.card) : null,
        );
      }

      renderCard(card) {
        const fields = Array.isArray(card.fields) ? card.fields : [];
        const actions = Array.isArray(card.actions) ? card.actions : [];
        return h(
          'section',
          { class: 'card', 'aria-label': `Card: ${String(card.title ?? '')}` },
          h('strong', {}, String(card.title ?? '')),
          card.text ? h('p', {}, String(card.text)) : null,
          fields.length > 0
            ? h(
                'dl',
                {},
                fields.map((field) => [
                  h('dt', {}, String(field.label ?? '')),
                  h('dd', {}, String(field.value ?? '')),
                ]),
              )
            : null,
          actions.length > 0
            ? h(
                'div',
                { class: 'actions' },
                actions.map((action) =>
                  h(
                    'button',
                    {
                      type: 'button',
                      title:
                        action.link ??
                        `${action.request?.method ?? ''} ${action.request?.path ?? ''}`,
                      onclick: () => void this.act(action),
                    },
                    String(action.label ?? 'Open'),
                  ),
                ),
              )
            : null,
        );
      }

      /** Runs an action of a card in this page, with the rights of the person who chose it. */
      async act(action) {
        if (typeof action.link === 'string' && /^\/(?!\/)/.test(action.link)) {
          history.pushState(null, '', action.link);
          window.dispatchEvent(new PopStateEvent('popstate'));
          return;
        }
        const request = action.request ?? {};
        const method = String(request.method ?? 'GET').toUpperCase();
        if (
          !METHODS.has(method) ||
          typeof request.path !== 'string' ||
          !request.path.startsWith('/api/v1/')
        ) {
          this.say('This action is not one the chat can run.');
          return;
        }
        try {
          await call(request.path, {
            method,
            body:
              method === 'GET' || request.body === undefined
                ? undefined
                : JSON.stringify(request.body),
          });
          this.say(`Done: ${String(action.label ?? '')}`);
        } catch (error) {
          this.say(`${String(action.label ?? 'The action')} failed: ${error.message}`);
        }
      }

      /** Who read the last message, and who is typing now. */
      renderStatusLine() {
        const line = this.root.querySelector('#presence');
        if (!line || !this.chat) {
          return;
        }
        const others = this.reads.filter((read) => read.data.person !== me.username);
        const now = Date.now();
        const typing = others.filter(
          (read) => read.data.typingAt && now - Date.parse(read.data.typingAt) < TYPING_FOR,
        );
        const last = this.messages.at(-1);
        const seen =
          last && last.createdBy === me.username
            ? others.filter((read) => read.data.readAt && !before(read.data.readAt, last.createdAt))
            : [];
        const parts = [];
        if (typing.length > 0) {
          parts.push(
            `${names(
              typing.map((read) => read.data.person),
              this.chat,
            ).join(', ')} ${typing.length === 1 ? 'is' : 'are'} typing…`,
          );
        }
        if (seen.length > 0) {
          parts.push(
            `Seen by ${names(
              seen.map((read) => read.data.person),
              this.chat,
            ).join(', ')}`,
          );
        }
        const text = parts.join(' · ');
        if (line.textContent !== text) {
          line.textContent = text;
        }
      }
    }

    customElements.define('mk-app-chat', AppChat);
  },
};

export default plugin;

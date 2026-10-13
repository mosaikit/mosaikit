// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/**
 * Frontend of the sample Java extension: lists and creates notes through the extension API
 * (/api/v1/ext/fixture-notes/notes), with the credentials of the signed-in person, and memos
 * (/api/v1/ext/fixture-notes/memos), which the kernel shares (MK-055): the Share button opens the
 * sharing dialog of the shell, and mk-fixture-memo shows a memo opened with a link.
 */

const API = '/api/v1/ext/fixture-notes/notes';
const MEMOS = '/api/v1/ext/fixture-notes/memos';

/** @type {import('@mosaikit/sdk').MosaikitExtension} */
const extension = {
  activate(context) {
    if (customElements.get('mk-fixture-notes')) {
      return;
    }

    /** Opens the sharing dialog of the shell, the same for every resource type (MK-055). */
    const share = (id) => {
      context.events.publish('shell.share', { extension: context.extension.id, type: 'memo', id });
    };

    class SampleNotes extends HTMLElement {
      connectedCallback() {
        const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        root.innerHTML = `
          <style>
            section { background: var(--mk-surface); border: 1px solid var(--mk-line);
                      border-radius: var(--mk-radius); padding: 20px; max-width: 640px; }
            form { display: flex; gap: 8px; margin-bottom: 16px; }
            input { flex: 1; font: inherit; padding: 8px 10px; border: 1px solid var(--mk-line);
                    border-radius: var(--mk-radius); background: var(--mk-bg); color: var(--mk-fg); }
            button { font: inherit; font-weight: 600; padding: 8px 12px; border-radius: var(--mk-radius);
                     border: 1px solid var(--mk-accent); background: var(--mk-accent);
                     color: var(--mk-accent-fg); cursor: pointer; }
            ul { list-style: none; margin: 0; padding: 0; }
            li { padding: 10px 0; border-top: 1px solid var(--mk-line); }
            time, .muted { color: var(--mk-muted); font-size: 13px; }
            .error { color: var(--mk-danger); }
            section + section { margin-top: 16px; }
            li.memo { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
            button.secondary { background: var(--mk-surface); color: var(--mk-fg); border-color: var(--mk-line); }
          </style>
          <section>
            <h1>Notes</h1>
            <form class="notes">
              <input name="text" maxlength="500" required aria-label="New note" placeholder="Write a note" />
              <button type="submit">Add</button>
            </form>
            <p role="status" aria-live="polite" class="muted"></p>
            <ul class="notes"></ul>
          </section>
          <section aria-labelledby="memos-title">
            <h2 id="memos-title">Memos</h2>
            <p class="muted">Only you read your memos, until you share them.</p>
            <form class="memos">
              <input name="memo" maxlength="500" required aria-label="New memo" placeholder="Write a memo" />
              <button type="submit">Add memo</button>
            </form>
            <ul class="memos" aria-label="Memos"></ul>
          </section>`;
        this.list = root.querySelector('ul.notes');
        this.memos = root.querySelector('ul.memos');
        this.status = root.querySelector('p');
        const memoForm = root.querySelector('form.memos');
        memoForm.addEventListener('submit', (event) => {
          event.preventDefault();
          const input = memoForm.elements.namedItem('memo');
          void this.addMemo(input.value).then((added) => {
            if (added) {
              input.value = '';
            }
          });
        });
        const form = root.querySelector('form.notes');
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const input = form.elements.namedItem('text');
          void this.add(input.value).then((added) => {
            if (added) {
              input.value = '';
            }
          });
        });
        void this.refresh();
        void this.refreshMemos();
      }

      async refreshMemos() {
        const response = await context.fetch(MEMOS);
        if (!response.ok) {
          this.fail(`The memos cannot be loaded (${response.status}).`);
          return;
        }
        const memos = await response.json();
        this.memos.replaceChildren(
          ...memos.map((memo) => {
            const item = document.createElement('li');
            item.className = 'memo';
            const text = document.createElement('span');
            text.textContent = memo.text;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'secondary';
            button.textContent = 'Share';
            button.setAttribute('aria-label', `Share ${memo.text}`);
            button.addEventListener('click', () => {
              share(memo.id);
            });
            item.append(text, button);
            return item;
          }),
        );
      }

      async addMemo(text) {
        const response = await context.fetch(MEMOS, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!response.ok) {
          this.fail(`The memo cannot be saved (${response.status}).`);
          return false;
        }
        await this.refreshMemos();
        return true;
      }

      async refresh() {
        const response = await context.fetch(API);
        if (!response.ok) {
          this.fail(`The notes cannot be loaded (${response.status}).`);
          return;
        }
        const notes = await response.json();
        this.list.replaceChildren(
          ...notes.map((note) => {
            const item = document.createElement('li');
            const text = document.createElement('div');
            text.textContent = note.text;
            const time = document.createElement('time');
            time.dateTime = note.createdAt;
            time.textContent = new Date(note.createdAt).toLocaleString(context.locale);
            item.append(text, time);
            return item;
          }),
        );
        this.status.classList.remove('error');
        this.status.textContent = notes.length === 0 ? 'No notes yet.' : `${notes.length} notes.`;
      }

      async add(text) {
        const response = await context.fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
        if (!response.ok) {
          this.fail(`The note cannot be saved (${response.status}).`);
          return false;
        }
        await this.refresh();
        return true;
      }

      fail(message) {
        this.status.classList.add('error');
        this.status.textContent = message;
      }
    }

    customElements.define('mk-fixture-notes', SampleNotes);

    /**
     * A memo opened with a link (MK-055), also by people without an account: the shell gives the
     * element the resource, the level of the link and `request`, which calls the API with the link.
     */
    class SharedMemo extends HTMLElement {
      connectedCallback() {
        const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        root.innerHTML = `
          <style>
            article { background: var(--mk-surface); border: 1px solid var(--mk-line);
                      border-radius: var(--mk-radius); padding: 20px; max-width: 640px; }
            .muted { color: var(--mk-muted); font-size: 13px; }
            .error { color: var(--mk-danger); }
          </style>
          <article>
            <h2>Memo</h2>
            <p class="text"></p>
            <p class="muted"></p>
          </article>`;
        void this.load(root);
      }

      async load(root) {
        const text = root.querySelector('.text');
        const call = this.request ?? context.fetch;
        const response = await call(`${MEMOS}/${encodeURIComponent(this.resource?.id ?? '')}`);
        if (!response.ok) {
          text.classList.add('error');
          text.textContent = `The memo cannot be read (${response.status}).`;
          return;
        }
        const memo = await response.json();
        text.textContent = memo.text;
        root.querySelector('.muted').textContent = `Level: ${memo.level ?? this.level ?? ''}`;
      }
    }

    customElements.define('mk-fixture-memo', SharedMemo);
  },
};

export default extension;

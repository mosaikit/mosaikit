// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/**
 * Frontend of the sample Java plugin: lists and creates notes through the plugin API
 * (/api/v1/p/sample-notes/notes), with the credentials of the signed-in person.
 */

const API = '/api/v1/p/sample-notes/notes';

/** @type {import('@mosaikit/sdk').MosaikitPlugin} */
const plugin = {
  activate(context) {
    if (customElements.get('mk-sample-notes')) {
      return;
    }

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
          </style>
          <section>
            <h1>Notes</h1>
            <form>
              <input name="text" maxlength="500" required aria-label="New note" placeholder="Write a note" />
              <button type="submit">Add</button>
            </form>
            <p role="status" aria-live="polite" class="muted"></p>
            <ul></ul>
          </section>`;
        this.list = root.querySelector('ul');
        this.status = root.querySelector('p');
        const form = root.querySelector('form');
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

    customElements.define('mk-sample-notes', SampleNotes);
  },
};

export default plugin;

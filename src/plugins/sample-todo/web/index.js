// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/**
 * Sample app without a backend (ADR-0031): its items are documents of the collection "items",
 * which the kernel keeps for the organization of the person, under row-level security. Nothing to
 * build, no Java, no schema: the plugin is active as soon as it is installed.
 */

/** @type {import('@mosaikit/sdk').MosaikitPlugin} */
const plugin = {
  activate(context) {
    if (customElements.get('mk-sample-todo')) {
      return;
    }
    const items = context.data('items');

    class SampleTodo extends HTMLElement {
      connectedCallback() {
        const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        root.innerHTML = `
          <style>
            section { background: var(--mk-surface); border: 1px solid var(--mk-line);
                      border-radius: var(--mk-radius); padding: 20px; max-width: 560px; color: var(--mk-fg); }
            form { display: flex; gap: 8px; margin: 12px 0; }
            input[type=text] { flex: 1; font: inherit; padding: 8px 10px; border: 1px solid var(--mk-line);
                    border-radius: var(--mk-radius); background: var(--mk-bg); color: var(--mk-fg); }
            button { font: inherit; padding: 8px 12px; border-radius: var(--mk-radius); cursor: pointer;
                     border: 1px solid var(--mk-accent); background: var(--mk-accent); color: var(--mk-accent-fg); }
            button.remove { background: transparent; color: var(--mk-muted); border-color: var(--mk-line); }
            ul { list-style: none; padding: 0; margin: 0; }
            li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--mk-line); }
            li span { flex: 1; }
            li.done span { text-decoration: line-through; color: var(--mk-muted); }
            .muted { color: var(--mk-muted); }
          </style>
          <section>
            <h1>To do</h1>
            <form>
              <input type="text" name="title" maxlength="200" required aria-label="New item" placeholder="What needs doing" />
              <button type="submit">Add</button>
            </form>
            <ul aria-label="Items"></ul>
            <p class="muted" role="status" aria-live="polite"></p>
          </section>`;
        this.list = root.querySelector('ul');
        this.status = root.querySelector('[role=status]');
        root.querySelector('form').addEventListener('submit', (event) => {
          event.preventDefault();
          const input = event.target.elements.namedItem('title');
          const title = input.value.trim();
          if (title) {
            input.value = '';
            void this.run(() => items.create({ title, done: false }));
          }
        });
        void this.refresh();
        // The items that colleagues add, tick or remove show at once (MK-031).
        this.stop = items.onChange(() => void this.refresh());
      }

      disconnectedCallback() {
        this.stop?.();
      }

      async run(change) {
        try {
          await change();
          await this.refresh();
        } catch (error) {
          this.status.textContent = `Not saved: ${error.message}`;
        }
      }

      async refresh() {
        try {
          const documents = await items.list();
          this.list.replaceChildren(...documents.map((document) => this.item(document)));
          this.status.textContent =
            documents.length === 0
              ? 'Nothing to do.'
              : `${documents.length} item(s), shared with your organization.`;
        } catch (error) {
          this.status.textContent = `The items cannot be read: ${error.message}`;
        }
      }

      item(document) {
        const row = globalThis.document.createElement('li');
        row.classList.toggle('done', document.data.done === true);
        const done = globalThis.document.createElement('input');
        done.type = 'checkbox';
        done.checked = document.data.done === true;
        done.setAttribute('aria-label', `Done: ${document.data.title}`);
        done.addEventListener('change', () => {
          void this.run(() =>
            items.update(document.id, { ...document.data, done: done.checked }, document.version),
          );
        });
        const title = globalThis.document.createElement('span');
        title.textContent = document.data.title;
        const remove = globalThis.document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.textContent = 'Remove';
        remove.setAttribute('aria-label', `Remove ${document.data.title}`);
        remove.addEventListener('click', () => void this.run(() => items.remove(document.id)));
        row.append(done, title, remove);
        return row;
      }
    }

    customElements.define('mk-sample-todo', SampleTodo);
  },
};

export default plugin;

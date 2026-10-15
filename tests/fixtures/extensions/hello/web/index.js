// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/**
 * Sample extension frontend. It is a plain ES module: any framework that produces custom elements
 * (Lit, React, Vue, Svelte, Angular) can be used instead.
 */

const TOPIC = 'fixture.hello.greeted';

/**
 * A memo of the fixture Notes that Hello shows when one is pinned in this browser (MK-135): a
 * reference to a resource of another extension, which the kernel resolves to the memo or to why it
 * is not available. A bundled extension uses `watchReferences` of `@mosaikit/sdk`; this plain module
 * does the same with `context.fetch` and `context.extensions`.
 */
const PINNED = 'fixture.hello.memo';
const NOTES = 'dev.mosaikit.fixture.notes';

/** @type {import('@mosaikit/sdk').MosaikitExtension} */
const extension = {
  activate(context) {
    if (customElements.get('mk-fixture-hello')) {
      return;
    }

    class SampleHello extends HTMLElement {
      connectedCallback() {
        const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        root.innerHTML = `
          <style>
            section { background: var(--mk-surface); border: 1px solid var(--mk-line);
                      border-radius: var(--mk-radius); padding: 20px; max-width: 520px; }
            button { font: inherit; padding: 8px 12px; border-radius: var(--mk-radius);
                     border: 1px solid var(--mk-accent); background: var(--mk-accent);
                     color: var(--mk-accent-fg); cursor: pointer; }
            p { color: var(--mk-muted); }
          </style>
          <section>
            <h1>Hello</h1>
            <p></p>
            <button type="button">Publish an event</button>
            <p role="status" aria-live="polite"></p>
          </section>
          <section class="folders" aria-label="Folders">
            <p class="state"></p>
            <button type="button" data-folder="alpha">Open folder Alpha</button>
            <button type="button" data-folder="beta">Open folder Beta</button>
          </section>
          <section class="pinned" aria-label="Pinned memo" hidden>
            <h2>Pinned memo</h2>
            <strong class="memo"></strong>
            <mk-reference-placeholder label="Pinned memo"></mk-reference-placeholder>
          </section>`;
        const [intro, status] = root.querySelectorAll('p');
        intro.textContent = `Signed in as ${context.user.displayName}. Extension ${context.extension.id} ${context.extension.version}.`;
        root.querySelector('button').addEventListener('click', () => {
          context.events.publish(TOPIC, { at: new Date().toISOString() });
        });
        this.unsubscribe = context.events.on(TOPIC, (payload) => {
          status.textContent = `Received ${TOPIC} at ${payload.at}`;
        });
        this.stopWatching = this.pin(root);
        this.stopAddress = this.folders(root);
      }

      /**
       * The folder opened is kept in the address of the page (MK-099): a copied address opens the
       * same folder, and the back and forward buttons move between the folders opened.
       */
      folders(root) {
        const address = context.address;
        const state = root.querySelector('.state');
        const show = (value) => {
          state.textContent = `Address state: ${value || '(none)'}`;
        };
        if (!address) {
          show('');
          return undefined;
        }
        show(address.read());
        for (const button of root.querySelectorAll('[data-folder]')) {
          button.addEventListener('click', () => {
            const value = `/folders/${button.dataset.folder}`;
            address.write(value);
            show(value);
          });
        }
        return address.subscribe(show);
      }

      /** Shows the pinned memo, or the placeholder of the kernel, again whenever Notes comes or goes. */
      pin(root) {
        const id = localStorage.getItem(PINNED);
        if (!id) {
          return undefined;
        }
        const reference = { extension: NOTES, type: 'memo', id };
        const memo = root.querySelector('.memo');
        const placeholder = root.querySelector('mk-reference-placeholder');
        placeholder.setAttribute('locale', context.locale);
        root.querySelector('.pinned').hidden = false;
        const resolve = async () => {
          const response = await context.fetch('/api/v1/resources/references/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([reference]),
          });
          if (!response.ok) {
            return;
          }
          const [resolved] = await response.json();
          memo.textContent = resolved.status === 'available' ? resolved.title : '';
          placeholder.reference = resolved;
        };
        void resolve();
        return context.extensions.subscribe((change) => {
          if (change.extension === NOTES) {
            void resolve();
          }
        });
      }

      disconnectedCallback() {
        this.unsubscribe?.();
        this.stopWatching?.();
        this.stopAddress?.();
      }
    }

    customElements.define('mk-fixture-hello', SampleHello);
  },
};

export default extension;

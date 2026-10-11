// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/**
 * Sample plugin frontend. It is a plain ES module: any framework that produces custom elements
 * (Lit, React, Vue, Svelte, Angular) can be used instead.
 */

const TOPIC = 'sample.hello.greeted';

/** @type {import('@mosaikit/sdk').MosaikitPlugin} */
const plugin = {
  activate(context) {
    if (customElements.get('mk-sample-hello')) {
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
          </section>`;
        const [intro, status] = root.querySelectorAll('p');
        intro.textContent = `Signed in as ${context.user.displayName}. Plugin ${context.plugin.id} ${context.plugin.version}.`;
        root.querySelector('button').addEventListener('click', () => {
          context.events.publish(TOPIC, { at: new Date().toISOString() });
        });
        this.unsubscribe = context.events.on(TOPIC, (payload) => {
          status.textContent = `Received ${TOPIC} at ${payload.at}`;
        });
      }

      disconnectedCallback() {
        this.unsubscribe?.();
      }
    }

    customElements.define('mk-sample-hello', SampleHello);
  },
};

export default plugin;

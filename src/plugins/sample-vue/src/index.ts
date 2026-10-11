// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { definePlugin } from '@mosaikit/sdk';
import { createApp, defineComponent, h, onUnmounted, ref, type App } from 'vue';

/** The topic on which the React palette publishes the picked colour. */
export const SELECTED = 'palette.selected';

interface Colour {
  readonly name: string;
  readonly value: string;
}

/** Whether a payload of the bus is a colour, since any plugin may publish on the topic. */
export function isColour(payload: unknown): payload is Colour {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const { name, value } = payload as Record<string, unknown>;
  return typeof name === 'string' && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

const STYLE = `
  div { display: flex; align-items: center; gap: 10px; padding: 10px 14px; color: var(--mk-fg);
        border: 1px solid var(--mk-line); border-radius: var(--mk-radius); background: var(--mk-bg); }
  span.swatch { width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--mk-line); }
  small { color: var(--mk-muted); }
`;

export default definePlugin({
  activate(context) {
    if (customElements.get('mk-sample-swatch')) {
      return;
    }
    const Swatch = defineComponent({
      setup() {
        const colour = ref<Colour | undefined>(undefined);
        const off = context.events.on(SELECTED, (payload) => {
          if (isColour(payload)) {
            colour.value = payload;
          }
        });
        onUnmounted(off);
        return () =>
          h('div', [
            h('style', STYLE),
            h('span', {
              class: 'swatch',
              style: { background: colour.value?.value ?? 'transparent' },
              'aria-hidden': 'true',
            }),
            h(
              'span',
              { role: 'status', 'aria-live': 'polite' },
              colour.value?.name ?? 'Pick a colour',
            ),
            h('small', 'Vue'),
          ]);
      },
    });
    customElements.define(
      'mk-sample-swatch',
      class extends HTMLElement {
        private app: App | undefined;

        connectedCallback(): void {
          const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
          const mount = document.createElement('span');
          shadow.replaceChildren(mount);
          this.app = createApp(Swatch);
          this.app.mount(mount);
        }

        disconnectedCallback(): void {
          this.app?.unmount();
          this.app = undefined;
        }
      },
    );
  },
});

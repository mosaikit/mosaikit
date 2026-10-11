// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { definePlugin, stringAttribute, type PluginContext } from '@mosaikit/sdk';
import { createElement, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** Colours to pick from; the shell theme gives the rest of the style. */
export const COLOURS = [
  { name: 'Tomato', value: '#e5533d' },
  { name: 'Gold', value: '#d9a400' },
  { name: 'Teal', value: '#1f9e89' },
  { name: 'Indigo', value: '#4b5bd6' },
] as const;

/** The topic on which the palette publishes the picked colour. */
export const SELECTED = 'palette.selected';

const STYLE = `
  section { background: var(--mk-surface); border: 1px solid var(--mk-line);
            border-radius: var(--mk-radius); padding: 20px; max-width: 720px; color: var(--mk-fg); }
  .colours { display: flex; gap: 8px; margin: 12px 0; }
  button { font: inherit; padding: 8px 12px; border-radius: var(--mk-radius); cursor: pointer;
           border: 2px solid transparent; color: #fff; }
  button[aria-pressed='true'] { border-color: var(--mk-fg); }
  .previews { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
  .muted { color: var(--mk-muted); font-size: 13px; }
`;

function Palette({ context }: { readonly context: PluginContext }): ReactElement {
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const previews = context
    .contributionsTo('palette.preview')
    .map((contribution) => stringAttribute(contribution, 'element'))
    .filter((element): element is string => element?.includes('-') === true);
  const today = new Intl.DateTimeFormat(context.locale, { dateStyle: 'full' }).format(new Date());
  const pick = (colour: (typeof COLOURS)[number]): void => {
    setPicked(colour.value);
    context.events.publish(SELECTED, { name: colour.name, value: colour.value });
  };
  return createElement(
    'section',
    null,
    createElement('style', null, STYLE),
    createElement('h1', null, 'Palette'),
    createElement('p', { className: 'muted' }, `React, ${context.locale}: ${today}`),
    createElement(
      'div',
      { className: 'colours', role: 'group', 'aria-label': 'Colours' },
      COLOURS.map((colour) =>
        createElement(
          'button',
          {
            key: colour.value,
            type: 'button',
            style: { background: colour.value },
            'aria-pressed': picked === colour.value,
            onClick: () => {
              pick(colour);
            },
          },
          colour.name,
        ),
      ),
    ),
    previews.length === 0
      ? createElement('p', { className: 'muted' }, 'No preview plugin is installed.')
      : createElement(
          'div',
          { className: 'previews' },
          previews.map((element) => createElement(element, { key: element })),
        ),
  );
}

export default definePlugin({
  activate(context) {
    if (customElements.get('mk-sample-palette')) {
      return;
    }
    customElements.define(
      'mk-sample-palette',
      class extends HTMLElement {
        private root: Root | undefined;

        connectedCallback(): void {
          const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
          this.root = createRoot(shadow);
          this.root.render(createElement(Palette, { context }));
        }

        disconnectedCallback(): void {
          this.root?.unmount();
          this.root = undefined;
        }
      },
    );
  },
});

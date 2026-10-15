// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { css } from 'lit';

/**
 * The styles that the administration pages share around `<mk-admin-view>` (MK-072): the table and
 * its rows, the filters, the detail in the side pane, buttons and states.
 */
export const adminStyles = css`
  :host {
    display: block;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--mk-surface);
  }
  th,
  td {
    text-align: left;
    padding: 8px 10px;
    border-top: 1px solid var(--mk-line);
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  th {
    font-size: 13px;
    color: var(--mk-muted);
  }
  tbody th {
    font-size: inherit;
    color: var(--mk-fg);
  }
  tr.selected {
    background: var(--mk-accent-soft, transparent);
  }
  .muted {
    color: var(--mk-muted);
    font-size: 13px;
  }
  .pill {
    display: inline-block;
    padding: 0 8px;
    border-radius: 10px;
    font-size: 13px;
    border: 1px solid var(--mk-line);
  }
  .pill.warn {
    border-color: var(--mk-danger);
    color: var(--mk-danger);
  }
  label.filter {
    display: grid;
    gap: 4px;
    font-weight: 600;
  }
  label.filter input,
  label.filter select {
    font: inherit;
    font-weight: normal;
    padding: 6px 8px;
    border-radius: var(--mk-radius);
    border: 1px solid var(--mk-line);
    background: var(--mk-surface);
    color: var(--mk-fg);
  }
  .pane {
    display: grid;
    align-content: start;
    gap: 12px;
  }
  .pane h2 {
    margin: 0;
    font-size: 1.1em;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;
    margin: 0;
  }
  dt {
    color: var(--mk-muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  button.link {
    border: none;
    background: none;
    padding: 0;
    color: var(--mk-accent);
    text-decoration: underline;
    text-align: left;
    font: inherit;
    cursor: pointer;
  }
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .status {
    min-height: 1.5em;
    color: var(--mk-muted);
  }
  .error {
    color: var(--mk-danger);
  }
  :focus-visible {
    outline: 2px solid var(--mk-focus);
    outline-offset: 2px;
  }
`;

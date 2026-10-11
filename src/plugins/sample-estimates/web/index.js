// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/**
 * Frontend of the Estimates extension (MK-020): the widget "mk-activity-estimate", which the
 * Activities app shows with each activity because this plugin contributes it to the
 * "activities.detail" point. It publishes "estimates.changed" and listens to
 * "activities.completed".
 */

const API = '/api/v1/p/sample-estimates/estimates';

/** @type {import('@mosaikit/sdk').MosaikitPlugin} */
const plugin = {
  activate(context) {
    if (customElements.get('mk-activity-estimate')) {
      return;
    }

    class ActivityEstimate extends HTMLElement {
      connectedCallback() {
        const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        root.innerHTML = `
          <style>
            label { display: inline-flex; align-items: center; gap: 6px; color: var(--mk-muted);
                    font-size: 13px; }
            input { width: 5em; font: inherit; padding: 4px 6px; border: 1px solid var(--mk-line);
                    border-radius: var(--mk-radius); background: var(--mk-bg); color: var(--mk-fg); }
            .error { color: var(--mk-danger); }
          </style>
          <label>Estimate <input type="number" min="0" max="10000" step="0.5" aria-label="Estimated hours" /> h</label>
          <span role="status" aria-live="polite"></span>`;
        this.input = root.querySelector('input');
        this.status = root.querySelector('[role=status]');
        this.input.addEventListener('change', () => void this.save());
        this.unsubscribe = context.events.on('activities.completed', (payload) => {
          if (payload?.id === this.activityId) {
            this.input.disabled = true;
          }
        });
        void this.load();
      }

      disconnectedCallback() {
        this.unsubscribe?.();
      }

      get activityId() {
        return this.getAttribute('activity-id') ?? '';
      }

      async load() {
        const response = await context.fetch(`${API}/${encodeURIComponent(this.activityId)}`);
        if (!response.ok) {
          this.fail(`(${response.status})`);
          return;
        }
        const estimate = await response.json();
        this.input.disabled = estimate.done;
        if (estimate.hours !== null && estimate.hours !== undefined) {
          this.input.value = String(estimate.hours);
          this.announce(Number(estimate.hours));
        }
      }

      async save() {
        const hours = Number(this.input.value);
        const response = await context.fetch(`${API}/${encodeURIComponent(this.activityId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hours }),
        });
        if (!response.ok) {
          this.fail(`(${response.status})`);
          return;
        }
        this.status.classList.remove('error');
        this.status.textContent = '';
        this.announce(hours);
      }

      announce(hours) {
        context.events.publish('estimates.changed', { activityId: this.activityId, hours });
      }

      fail(message) {
        this.status.classList.add('error');
        this.status.textContent = message;
      }
    }

    customElements.define('mk-activity-estimate', ActivityEstimate);
  },
};

export default plugin;

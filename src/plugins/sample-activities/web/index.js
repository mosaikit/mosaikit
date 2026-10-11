// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/**
 * Frontend of the Activities sample (MK-020): lists and creates activities, shows with each one the
 * widgets that other plugins contribute to the "activities.detail" extension point, publishes
 * "activities.completed" and listens to "estimates.changed" to show the estimated total.
 */

const API = '/api/v1/p/sample-activities/activities';
const POINT = 'activities.detail';

/** @type {import('@mosaikit/sdk').MosaikitPlugin} */
const plugin = {
  activate(context) {
    if (customElements.get('mk-sample-activities')) {
      return;
    }
    const widgets = context
      .contributionsTo(POINT)
      .map((contribution) => contribution.attributes.element)
      .filter((element) => typeof element === 'string' && element.includes('-'));

    class SampleActivities extends HTMLElement {
      connectedCallback() {
        this.estimates = new Map();
        const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
        root.innerHTML = `
          <style>
            section { background: var(--mk-surface); border: 1px solid var(--mk-line);
                      border-radius: var(--mk-radius); padding: 20px; max-width: 720px; }
            form { display: flex; gap: 8px; margin-bottom: 16px; }
            input { flex: 1; font: inherit; padding: 8px 10px; border: 1px solid var(--mk-line);
                    border-radius: var(--mk-radius); background: var(--mk-bg); color: var(--mk-fg); }
            button { font: inherit; font-weight: 600; padding: 6px 12px; border-radius: var(--mk-radius);
                     border: 1px solid var(--mk-accent); background: var(--mk-accent);
                     color: var(--mk-accent-fg); cursor: pointer; }
            button.secondary { background: transparent; color: var(--mk-fg); border-color: var(--mk-line); }
            ul { list-style: none; margin: 0; padding: 0; }
            li { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 10px 0;
                 border-top: 1px solid var(--mk-line); }
            li .title { flex: 1; }
            li.done .title { text-decoration: line-through; color: var(--mk-muted); }
            .muted { color: var(--mk-muted); font-size: 13px; }
            .error { color: var(--mk-danger); }
          </style>
          <section>
            <h1>Activities</h1>
            <form>
              <input name="title" maxlength="200" required aria-label="New activity" placeholder="What needs doing" />
              <button type="submit">Add</button>
            </form>
            <p role="status" aria-live="polite" class="muted"></p>
            <ul></ul>
            <p class="muted" data-total></p>
          </section>`;
        this.list = root.querySelector('ul');
        this.status = root.querySelector('[role=status]');
        this.total = root.querySelector('[data-total]');
        const form = root.querySelector('form');
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const input = form.elements.namedItem('title');
          void this.add(input.value).then((added) => {
            if (added) {
              input.value = '';
            }
          });
        });
        this.unsubscribe = context.events.on('estimates.changed', (payload) => {
          if (
            payload &&
            typeof payload.activityId === 'string' &&
            typeof payload.hours === 'number'
          ) {
            this.estimates.set(payload.activityId, payload.hours);
            this.showTotal();
          }
        });
        void this.refresh();
      }

      disconnectedCallback() {
        this.unsubscribe?.();
      }

      async refresh() {
        const response = await context.fetch(API);
        if (!response.ok) {
          this.fail(`The activities cannot be loaded (${response.status}).`);
          return;
        }
        const activities = await response.json();
        this.list.replaceChildren(...activities.map((activity) => this.item(activity)));
        this.status.classList.remove('error');
        this.status.textContent =
          activities.length === 0 ? 'No activities yet.' : `${activities.length} activities.`;
      }

      item(activity) {
        const item = document.createElement('li');
        item.classList.toggle('done', activity.done);
        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = activity.title;
        item.append(title);
        // The widgets of the extensions, each with the activity it is about.
        for (const element of widgets) {
          const widget = document.createElement(element);
          widget.setAttribute('activity-id', activity.id);
          item.append(widget);
        }
        if (!activity.done) {
          const done = document.createElement('button');
          done.className = 'secondary';
          done.textContent = 'Done';
          done.addEventListener('click', () => void this.complete(activity));
          item.append(done);
        }
        return item;
      }

      showTotal() {
        const hours = [...this.estimates.values()].reduce((sum, value) => sum + value, 0);
        this.total.textContent = this.estimates.size === 0 ? '' : `Estimated: ${hours} h`;
      }

      async add(title) {
        const response = await context.fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        if (!response.ok) {
          this.fail(`The activity cannot be saved (${response.status}).`);
          return false;
        }
        await this.refresh();
        return true;
      }

      async complete(activity) {
        const response = await context.fetch(`${API}/${activity.id}/completion`, {
          method: 'POST',
        });
        if (!response.ok) {
          this.fail(`The activity cannot be completed (${response.status}).`);
          return;
        }
        context.events.publish('activities.completed', { id: activity.id, title: activity.title });
        await this.refresh();
      }

      fail(message) {
        this.status.classList.add('error');
        this.status.textContent = message;
      }
    }

    customElements.define('mk-sample-activities', SampleActivities);
  },
};

export default plugin;

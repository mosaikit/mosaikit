// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { PresenceStore, type FrontendExtension } from '@mosaikit/sdk';
import { describe, expect, it } from 'vitest';
import { HOME_WIDGET_POINT, VISITOR, homeWidgets } from '../src/home.js';

const extension = (
  id: string,
  widgets: Record<string, unknown>[],
  isolation: 'module' | 'iframe' = 'module',
): FrontendExtension => ({
  id,
  version: '1.0.0',
  entry: `/api/v1/extension-assets/${id}/web/index.js`,
  isolation,
  contributions: [
    { point: 'rail.app', id: 'app', attributes: { title: 'App', route: '/app/x' } },
    ...widgets.map(({ id: widget, ...attributes }) => ({
      point: HOME_WIDGET_POINT,
      id: String(widget),
      attributes,
    })),
  ],
});

const NEWS = 'dev.example.news';
const TASKS = 'dev.example.tasks';

/** What the kernel gives each audience of the same installation (HomeWidgetsTest). */
const installation = {
  platformAdmin: [
    extension(NEWS, [
      { id: 'news', title: 'News', element: 'ex-news', public: true, size: 'wide', order: 1 },
      { id: 'health', title: 'Health', element: 'ex-health', roles: ['platform-admin'] },
    ]),
  ],
  organizationAdmin: [
    extension(NEWS, [
      { id: 'news', title: 'News', element: 'ex-news', public: true, size: 'wide', order: 1 },
    ]),
    extension(TASKS, [
      { id: 'requests', title: 'Requests', element: 'ex-requests', roles: ['organization-admin'] },
      {
        id: 'tasks',
        title: 'Tasks',
        element: 'ex-tasks',
        roles: ['organization-user'],
        i18n: { it: { title: 'Compiti' } },
      },
    ]),
  ],
  member: [
    extension(NEWS, [
      { id: 'news', title: 'News', element: 'ex-news', public: true, size: 'wide', order: 1 },
    ]),
    extension(TASKS, [
      { id: 'tasks', title: 'Tasks', element: 'ex-tasks', roles: ['organization-user'] },
    ]),
  ],
  visitor: [
    extension(NEWS, [
      { id: 'news', title: 'News', element: 'ex-news', public: true, size: 'wide', order: 1 },
    ]),
  ],
};

const ids = (extensions: readonly FrontendExtension[], held?: ReadonlySet<string>): string[] =>
  homeWidgets(extensions, { locale: 'en', held }).map((widget) => widget.id);

describe('homeWidgets', () => {
  it('shows each role and a visitor of the same installation their own widgets', () => {
    expect(ids(installation.platformAdmin)).toEqual(['news', 'health']);
    expect(ids(installation.organizationAdmin)).toEqual(['news', 'requests', 'tasks']);
    expect(ids(installation.member)).toEqual(['news', 'tasks']);
    expect(ids(installation.visitor)).toEqual(['news']);
    expect(VISITOR.roles).toEqual([]);
  });

  it('orders the widgets, sizes them and translates their titles', () => {
    const widgets = homeWidgets(installation.organizationAdmin, { locale: 'it' });
    expect(widgets[0]).toEqual({
      extensionId: NEWS,
      id: 'news',
      title: 'News',
      element: 'ex-news',
      size: 'wide',
      order: 1,
    });
    expect(widgets[2]).toMatchObject({ title: 'Compiti', size: 'small', order: 100 });
  });

  it('leaves out what it cannot render and what needs a permission the person lacks', () => {
    const extensions = [
      extension('dev.example.odd', [
        { id: 'no-element', title: 'No element' },
        { id: 'not-custom', title: 'Not custom', element: 'div' },
        { id: 'guarded', title: 'Guarded', element: 'ex-guarded', permission: 'see-it' },
        { id: 'untitled', element: 'ex-untitled' },
      ]),
      extension(
        'dev.example.isolated',
        [{ id: 'framed', title: 'Framed', element: 'ex-framed' }],
        'iframe',
      ),
    ];
    expect(ids(extensions)).toEqual(['guarded', 'untitled']);
    expect(ids(extensions, new Set())).toEqual(['untitled']);
    expect(ids(extensions, new Set(['dev.example.odd:see-it']))).toEqual(['guarded', 'untitled']);
  });

  it('drops the widgets of an extension as soon as it is no longer active', () => {
    const presence = new PresenceStore([
      { id: NEWS, version: '1.0.0' },
      { id: TASKS, version: '1.0.0' },
    ]);
    const shown = () =>
      homeWidgets(installation.member, { locale: 'en', presence }).map((widget) => widget.id);
    expect(shown()).toEqual(['news', 'tasks']);

    presence.apply({ extension: TASKS, active: false, version: '1.0.0', reason: 'disabled' });
    expect(shown()).toEqual(['news']);

    // A store that knows no extension yet hides nothing.
    expect(
      homeWidgets(installation.member, { locale: 'en', presence: new PresenceStore() }),
    ).toHaveLength(2);
  });
});

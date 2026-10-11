// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { contributionsTo, stringAttribute, type FrontendPlugin } from '@mosaikit/sdk';

/** Extension point through which a plugin adds an app to the app bar (MK-025, ADR-0026). */
export const RAIL_POINT = 'rail.app';

/** The extension point that rail.app replaces; still read during the 0.x versions. */
export const LAUNCHER_POINT = 'launcher.app';

/** An app offered in the app bar. */
export interface LauncherEntry {
  readonly pluginId: string;
  readonly id: string;
  readonly title: string;
  readonly route: string;
  /** Custom element that renders the app. */
  readonly element: string;
  /** Address of the icon of the app, an SVG or PNG file of the plugin; a tile with its initials otherwise. */
  readonly icon?: string;
}

const CUSTOM_ELEMENT = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
const ROUTE = /^\/app\/[a-z0-9-]+$/;
const ICON = /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_./-]*\.(svg|png)$/;
const DEFAULT_ORDER = 100;

/**
 * Builds the app bar from the contributions of active plugins: rail.app first, then launcher.app
 * for the routes that rail.app does not have, sorted by their `order` (100 by default) and then as
 * the plugins come. Contributions without a valid route or custom element name are ignored, so that
 * a broken plugin cannot break the shell.
 */
export function launcherEntries(plugins: readonly FrontendPlugin[]): LauncherEntry[] {
  const seen = new Set<string>();
  const entries: { entry: LauncherEntry; order: number }[] = [];
  for (const point of [RAIL_POINT, LAUNCHER_POINT]) {
    for (const contribution of contributionsTo(plugins, point)) {
      const route = stringAttribute(contribution, 'route');
      const element = stringAttribute(contribution, 'element');
      if (!route || !ROUTE.test(route) || !element || !CUSTOM_ELEMENT.test(element)) {
        continue;
      }
      if (seen.has(route)) {
        continue;
      }
      seen.add(route);
      const icon = stringAttribute(contribution, 'icon');
      const order = contribution.attributes.order;
      entries.push({
        entry: {
          pluginId: contribution.pluginId,
          id: contribution.id,
          title: stringAttribute(contribution, 'title') ?? contribution.id,
          route,
          element,
          ...(icon && ICON.test(icon)
            ? { icon: `/api/v1/plugin-assets/${contribution.pluginId}/${icon}` }
            : {}),
        },
        order: typeof order === 'number' && Number.isFinite(order) ? order : DEFAULT_ORDER,
      });
    }
  }
  // A stable sort keeps the order of the plugins among apps of the same order.
  return entries.sort((a, b) => a.order - b.order).map(({ entry }) => entry);
}

/** Finds the entry for a path, ignoring a trailing slash. */
export function entryForPath(
  entries: readonly LauncherEntry[],
  path: string,
): LauncherEntry | undefined {
  const normalized = path.length > 1 ? withoutTrailingSlashes(path) : path;
  return entries.find((entry) => entry.route === normalized);
}

/** The apps and pages whose title contains the text, for the search of the top bar. */
export function matching<T extends { readonly title: string }>(
  items: readonly T[],
  text: string,
): T[] {
  const wanted = text.trim().toLocaleLowerCase();
  if (!wanted) {
    return [];
  }
  return items.filter((item) => item.title.toLocaleLowerCase().includes(wanted));
}

/** The initials of a name, for the avatar of the person and the tiles of apps without an icon. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words.at(-1)] : [words[0]];
  return letters
    .map((word) => word?.[0] ?? '')
    .join('')
    .toLocaleUpperCase();
}

function withoutTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === '/') {
    end--;
  }
  return path.slice(0, end);
}

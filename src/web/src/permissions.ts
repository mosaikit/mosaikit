// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { DeclaredPermission, PermissionSource } from './api.js';
import { language as shellLanguage, t } from './i18n.js';

/**
 * What the shell does with permissions (MK-056, ADR-0038): it groups the declared permissions by
 * extension for the console of the organization, names where each permission of a person comes
 * from, and hides the contributions that need a permission the person lacks. Hiding is only for the
 * interface: the backends check every request.
 */

/** A permission as the console shows it, with its texts in the language of the shell. */
export interface ShownPermission {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** The app the permission opens, for the permission of an app (MK-030). */
  readonly app?: string;
}

/** The permissions of one extension. */
export interface PermissionGroup {
  readonly extension: string;
  readonly name: string;
  /** Whether all the apps of the extension are off for the organization: nobody holds them. */
  readonly off: boolean;
  readonly permissions: readonly ShownPermission[];
}

/** The text of a permission in a language, from its `i18n`, or the one of the manifest. */
function text(
  permission: DeclaredPermission,
  field: 'title' | 'description',
  language: string,
): string {
  const translated = permission.i18n?.[language]?.[field];
  return translated && translated.trim() ? translated : permission[field];
}

/**
 * The declared permissions grouped by extension, the extensions by name; within an extension, the
 * permissions of the manifest in its order, then those of its apps.
 */
export function byExtension(
  declared: readonly DeclaredPermission[],
  language: string = shellLanguage(),
): PermissionGroup[] {
  const groups = new Map<string, { name: string; off: boolean; permissions: ShownPermission[] }>();
  const ordered = [
    ...declared.filter((permission) => !permission.app),
    ...declared.filter((permission) => permission.app),
  ];
  for (const permission of ordered) {
    const group = groups.get(permission.extension) ?? {
      name: permission.extensionName || permission.extension,
      off: permission.off,
      permissions: [],
    };
    group.permissions.push({
      id: permission.id,
      title: text(permission, 'title', language),
      description: text(permission, 'description', language),
      ...(permission.app ? { app: permission.app } : {}),
    });
    groups.set(permission.extension, group);
  }
  return [...groups.entries()]
    .map(([extension, group]) => ({ extension, ...group }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.extension.localeCompare(b.extension));
}

/** Where a permission comes from, for people. */
export function sourceLabel(source: PermissionSource): string {
  switch (source.kind) {
    case 'administrator':
      return t('Administrator of the organization');
    case 'profile':
      return t('Profile {name}', { name: source.name ?? '' });
    case 'team':
      return t('Team {name}', { name: source.name ?? '' });
    case 'exception':
      return t('Personal exception');
    default:
      return String((source as { kind: unknown }).kind);
  }
}

/** The sources of a permission, in one line. */
export function sourcesLabel(sources: readonly PermissionSource[]): string {
  return sources.map(sourceLabel).join(', ');
}

/** The list with the permission added or removed, sorted, without repetitions. */
export function toggled(permissions: readonly string[], permission: string, on: boolean): string[] {
  const set = new Set(permissions);
  if (on) {
    set.add(permission);
  } else {
    set.delete(permission);
  }
  return [...set].sort();
}

/**
 * The permission that a contribution needs, as `<extension>:<permission>`: its `permission`
 * attribute, a name within the extension or a qualified identifier; `undefined` without one.
 */
export function requiredPermission(contribution: {
  readonly extensionId: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}): string | undefined {
  const value = contribution.attributes.permission;
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  return value.includes(':') ? value : `${contribution.extensionId}:${value}`;
}

/**
 * Whether the person may see what needs a permission: always without a permission, and when the
 * permissions of the person are not known (the backend refuses anyway).
 */
export function allows(held: ReadonlySet<string> | undefined, permission?: string): boolean {
  return permission === undefined || held === undefined || held.has(permission);
}

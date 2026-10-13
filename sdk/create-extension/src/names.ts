// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/** The names an extension derives from its identifier, following the rules of the manifest. */
export interface ExtensionNames {
  /** Reverse-DNS identifier, such as `dev.acme.traffic-lights`. */
  readonly id: string;
  /** Last part of the identifier: directory, package file and API name (`traffic-lights`). */
  readonly slug: string;
  /** Database schema owned by the extension (`ext_traffic_lights`). */
  readonly schema: string;
  /** Java package (`dev.acme.trafficlights`). */
  readonly javaPackage: string;
  /** Custom element of its app (`traffic-lights-app`). */
  readonly element: string;
  /** Human readable name. */
  readonly name: string;
}

const ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const API = /^[a-z][a-z0-9-]{1,39}$/;
const JAVA_KEYWORDS = new Set([
  'class',
  'default',
  'import',
  'package',
  'public',
  'new',
  'final',
  'static',
]);

/**
 * Derives the names of an extension from its identifier.
 *
 * @throws Error when the identifier is not a valid extension identifier
 */
export function namesOf(id: string, name?: string): ExtensionNames {
  if (!ID.test(id)) {
    throw new Error(
      `'${id}' is not an extension identifier: use lowercase reverse-DNS, such as dev.acme.traffic`,
    );
  }
  const slug = id.slice(id.lastIndexOf('.') + 1);
  if (!API.test(slug)) {
    throw new Error(`The last part of '${id}' must have 2 to 40 letters, digits or hyphens`);
  }
  const javaPackage = id
    .split('.')
    .map((part) => part.replaceAll('-', ''))
    .map((part) => (JAVA_KEYWORDS.has(part) ? `${part}_` : part))
    .join('.');
  return {
    id,
    slug,
    schema: `ext_${slug.replaceAll('-', '_')}`.slice(0, 63),
    javaPackage,
    element: `${slug}-app`,
    name: name?.trim() || titleOf(slug),
  };
}

/** `traffic-lights` → `Traffic lights`. */
export function titleOf(slug: string): string {
  const words = slug.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

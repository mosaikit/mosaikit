// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import {
  contributionsTo,
  textAttribute,
  type ExtensionPresence,
  type FrontendExtension,
} from '@mosaikit/sdk';
import { allows, requiredPermission } from './permissions.js';

/** The extension point of the widgets of the home page, owned by the kernel (MK-101). */
export const HOME_WIDGET_POINT = 'home.widget';

/** The position of a widget that does not give one. */
const DEFAULT_ORDER = 100;

/** A widget of the home page, ready to be shown. */
export interface HomeWidget {
  readonly extensionId: string;
  readonly id: string;
  readonly title: string;
  /** The custom element of the extension that renders the widget. */
  readonly element: string;
  /** `wide` takes two columns of the grid. */
  readonly size: 'small' | 'wide';
  readonly order: number;
}

/** What decides which widgets a page shows. */
export interface HomeWidgetsOptions {
  /** The language of the titles. */
  readonly locale: string;
  /** The permissions the person holds (MK-056); `undefined` while unknown, when nothing is hidden. */
  readonly held?: ReadonlySet<string> | undefined;
  /**
   * The extensions active in the organization (MK-133): the widgets of the others disappear as soon
   * as the shell is told. Without it, or while it knows no extension, every widget shows.
   */
  readonly presence?: ExtensionPresence | undefined;
}

const ELEMENT = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

/**
 * The widgets of the home page, in order. The kernel already gives each person only the widgets of
 * their roles, and visitors only the public ones, and refuses those that do not match the schema of
 * the point; here the shell leaves out those it cannot render (an isolated frontend, a name that is
 * not a custom element), those that need a permission the person lacks, and those of extensions that
 * are no longer active.
 */
export function homeWidgets(
  extensions: readonly FrontendExtension[],
  options: HomeWidgetsOptions,
): HomeWidget[] {
  const inPage = new Set(
    extensions
      .filter((extension) => extension.isolation !== 'iframe')
      .map((extension) => extension.id),
  );
  const presence = options.presence;
  const knowsPresence = presence !== undefined && presence.active().length > 0;
  return contributionsTo(extensions, HOME_WIDGET_POINT)
    .flatMap((contribution): HomeWidget[] => {
      const element = contribution.attributes.element;
      if (typeof element !== 'string' || !ELEMENT.test(element)) {
        return [];
      }
      if (!inPage.has(contribution.extensionId)) {
        return [];
      }
      if (knowsPresence && !presence.isActive(contribution.extensionId)) {
        return [];
      }
      if (!allows(options.held, requiredPermission(contribution))) {
        return [];
      }
      const order = contribution.attributes.order;
      return [
        {
          extensionId: contribution.extensionId,
          id: contribution.id,
          title: textAttribute(contribution, 'title', options.locale) ?? contribution.id,
          element,
          size: contribution.attributes.size === 'wide' ? 'wide' : 'small',
          order: typeof order === 'number' ? order : DEFAULT_ORDER,
        },
      ];
    })
    .sort((a, b) => a.order - b.order);
}

/** The identity given to the frontends that a visitor without an account loads for the public widgets. */
export const VISITOR = { username: '', displayName: '', roles: [] } as const;

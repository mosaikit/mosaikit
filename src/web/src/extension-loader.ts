// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { language } from './i18n.js';
import {
  dataCollections,
  NO_LIVE,
  type LiveChannel,
  EventBus,
  contributionsTo,
  isMosaikitExtension,
  type CurrentUser,
  type FrontendExtension,
} from '@mosaikit/sdk';

/** Outcome of loading one extension frontend. */
export interface LoadResult {
  readonly extensionId: string;
  readonly loaded: boolean;
  readonly reason?: string;
}

type ImportModule = (url: string) => Promise<unknown>;

/** Loads extension modules and activates them with their context. */
export class ExtensionLoader {
  readonly events: EventBus;

  constructor(
    private readonly request: (path: string, init?: RequestInit) => Promise<Response>,
    private readonly importModule: ImportModule = (url) => import(/* @vite-ignore */ url),
    reportError: (message: string, error: unknown) => void = (message, error) => {
      console.error(message, error);
    },
    private readonly live: LiveChannel = NO_LIVE,
  ) {
    this.events = new EventBus((error, topic) => {
      reportError(`A handler of '${topic}' failed`, error);
    });
  }

  /** Loads every extension; one failure never prevents the others from loading. */
  /**
   * @param all every active extension, whose contributions the loaded ones can read; by default the
   *     loaded ones
   */
  async loadAll(
    extensions: readonly FrontendExtension[],
    user: CurrentUser,
    all: readonly FrontendExtension[] = extensions,
  ): Promise<LoadResult[]> {
    return Promise.all(extensions.map((extension) => this.load(extension, user, all)));
  }

  private async load(
    extension: FrontendExtension,
    user: CurrentUser,
    all: readonly FrontendExtension[],
  ): Promise<LoadResult> {
    if (extension.isolation === 'iframe') {
      // Isolated frontends are loaded in their own frame when one of their apps is opened (MK-014).
      return { extensionId: extension.id, loaded: true };
    }
    try {
      const module = await this.importModule(extension.entry);
      const candidate = (module as { default?: unknown }).default;
      if (!isMosaikitExtension(candidate)) {
        return {
          extensionId: extension.id,
          loaded: false,
          reason: 'the module has no default extension export',
        };
      }
      await candidate.activate({
        extension: { id: extension.id, version: extension.version },
        contributions: extension.contributions,
        // Only the extension that declares a point reads what others contribute to it (MK-020).
        contributionsTo: (point: string) =>
          extension.points?.includes(point) ? contributionsTo(all, point) : [],
        events: this.events,
        // Read when used: it follows the language chosen in the settings (MK-027).
        get locale() {
          return language();
        },
        user,
        fetch: this.request,
        data: dataCollections(this.request, extension.id, this.live),
        live: this.live,
        notify: async (notification) => {
          const response = await this.request('/api/v1/notifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ extension: extension.id, ...notification }),
          });
          if (!response.ok) {
            throw new Error(`The notification was not sent (${String(response.status)})`);
          }
        },
      });
      return { extensionId: extension.id, loaded: true };
    } catch (error) {
      return { extensionId: extension.id, loaded: false, reason: String(error) };
    }
  }
}

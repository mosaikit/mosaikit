// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/** An extension active in the organization of the session (MK-133). */
export interface ActiveExtension {
  readonly id: string;
  readonly version: string;
}

/** An extension that became active or inactive in the organization of the session. */
export interface ExtensionPresenceChange {
  /** The identifier of the extension. */
  readonly extension: string;
  /** Whether it is active now. */
  readonly active: boolean;
  /** The version it has now, or the one it had when it is no longer active. */
  readonly version: string;
  /**
   * Why: `installed`, `updated` or `enabled` when it became active; `removed`, `incompatible` or
   * `disabled` when it is no longer active.
   */
  readonly reason: string;
  /** The version before an update. */
  readonly previousVersion?: string;
}

/**
 * Whether other extensions are present and active in the organization of the session (MK-133): installed,
 * compatible with the kernel and with what they require, and not turned off by the organization. The
 * shell delivers the list with the session and keeps it current through the real-time channel, so a
 * question never makes a request to the server. Any extension may ask about any other; of one that is
 * not active the answer says only that it is absent.
 */
export interface ExtensionPresence {
  /** Whether an extension is active in the organization of the session. */
  isActive(id: string): boolean;
  /** The version of an active extension, or `undefined` when it is not active. */
  version(id: string): string | undefined;
  /** The extensions active now, by identifier. */
  active(): readonly ActiveExtension[];
  /**
   * Calls `handler` each time an extension becomes active or inactive, or is updated, until the
   * returned function is called; the answers of `isActive` and `version` already reflect the change.
   */
  subscribe(handler: (change: ExtensionPresenceChange) => void): () => void;
}

/** Whether a value received from the kernel is a change of presence. */
export function isPresenceChange(value: unknown): value is ExtensionPresenceChange {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const change = value as Record<string, unknown>;
  return (
    typeof change.extension === 'string' &&
    typeof change.active === 'boolean' &&
    typeof change.version === 'string' &&
    typeof change.reason === 'string'
  );
}

/**
 * The presence of extensions that the shell keeps current; also a fixed presence for the tests of an
 * extension: `new PresenceStore([{ id: 'org.example.ext.catalog', version: '1.2.0' }])`.
 */
export class PresenceStore implements ExtensionPresence {
  private readonly versions = new Map<string, string>();
  private readonly handlers = new Set<(change: ExtensionPresenceChange) => void>();

  constructor(
    active: readonly ActiveExtension[] = [],
    private readonly onHandlerError: (error: unknown) => void = (error) => {
      console.error('A handler of the presence of extensions failed', error);
    },
  ) {
    for (const extension of active) {
      this.versions.set(extension.id, extension.version);
    }
  }

  isActive(id: string): boolean {
    return this.versions.has(id);
  }

  version(id: string): string | undefined {
    return this.versions.get(id);
  }

  active(): readonly ActiveExtension[] {
    return [...this.versions.entries()]
      .map(([id, version]) => ({ id, version }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  subscribe(handler: (change: ExtensionPresenceChange) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Applies a change and tells the subscribers, when it changes what the store answers. */
  apply(change: ExtensionPresenceChange): void {
    const current = this.versions.get(change.extension);
    if (change.active) {
      if (current === change.version) {
        return;
      }
      this.versions.set(change.extension, change.version);
    } else {
      if (current === undefined) {
        return;
      }
      this.versions.delete(change.extension);
    }
    for (const handler of [...this.handlers]) {
      try {
        handler(change);
      } catch (error) {
        this.onHandlerError(error);
      }
    }
  }

  /**
   * Replaces the whole list, such as when it was read again, telling the subscribers what changed.
   */
  replace(active: readonly ActiveExtension[]): void {
    const next = new Map(active.map((extension) => [extension.id, extension.version]));
    for (const [id, version] of [...this.versions]) {
      if (!next.has(id)) {
        this.apply({ extension: id, active: false, version, reason: 'removed' });
      }
    }
    for (const [id, version] of next) {
      const previous = this.versions.get(id);
      if (previous !== version) {
        this.apply({
          extension: id,
          active: true,
          version,
          reason: previous === undefined ? 'installed' : 'updated',
          ...(previous === undefined ? {} : { previousVersion: previous }),
        });
      }
    }
  }
}

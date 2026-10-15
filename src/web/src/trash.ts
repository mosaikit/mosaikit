// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import type { KernelClient, TrashedResource } from './api.js';
import { t } from './i18n.js';

/** What the trash tells the page around it. */
export interface TrashEvents {
  changed(): void;
  announce(message: string, failed: boolean): void;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What a resource of the trash is, in a few words: its type, and what went with it. */
export function describe(resource: TrashedResource): string {
  const kind = `${resource.typeTitle} · ${resource.extensionName}`;
  if (resource.contents === 0) {
    return kind;
  }
  return resource.contents === 1
    ? t('{kind}, with 1 item inside', { kind })
    : t('{kind}, with {count} items inside', { kind, count: String(resource.contents) });
}

/**
 * The trash of the person, without the view (MK-095): reads the resources they own that were
 * trashed, or those of the whole organization for an administrator, restores them and deletes them
 * for good, and says what happened.
 */
export class TrashList {
  resources: readonly TrashedResource[] | undefined;
  /** Whether it shows the trash of the whole organization, for an administrator. */
  wholeOrganization = false;

  constructor(
    private readonly client:
      Pick<KernelClient, 'trash' | 'restoreFromTrash' | 'deleteFromTrash'> | undefined,
    private readonly events: TrashEvents,
    private readonly when: (iso: string) => string,
  ) {}

  async load(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      this.resources = await this.client.trash(this.wholeOrganization);
    } catch (error) {
      this.events.announce(
        t('The trash cannot be read: {reason}', { reason: reason(error) }),
        true,
      );
    }
    this.events.changed();
  }

  /** Shows the trash of the person, or of the whole organization. */
  async show(wholeOrganization: boolean): Promise<void> {
    this.wholeOrganization = wholeOrganization;
    await this.load();
  }

  /** Restores a resource with what went with it; answers whether it was restored. */
  async restore(resource: TrashedResource): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    try {
      await this.client.restoreFromTrash(resource.id);
      await this.load();
      this.events.announce(t('{title} restored.', { title: resource.title }), false);
      return true;
    } catch (error) {
      this.events.announce(t('Not restored: {reason}', { reason: reason(error) }), true);
      return false;
    }
  }

  /** Deletes a resource for good with what went with it; answers whether it was deleted. */
  async remove(resource: TrashedResource): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    try {
      await this.client.deleteFromTrash(resource.id);
      await this.load();
      this.events.announce(t('{title} deleted for good.', { title: resource.title }), false);
      return true;
    } catch (error) {
      this.events.announce(t('Not deleted for good: {reason}', { reason: reason(error) }), true);
      return false;
    }
  }

  /** When a resource is deleted for good, for the page. */
  deletedOn(resource: TrashedResource): string {
    return t('Deleted for good on {date}', { date: this.when(resource.purgeableFrom) });
  }
}

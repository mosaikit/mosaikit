// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
import { REQUEST_ACCESS_TOPIC } from '@mosaikit/sdk';
import { toError } from './api.js';
import { t } from './i18n.js';
import { resourceOf, type ResourceRef } from './sharing.js';

/**
 * Requests for access in the shell (MK-058): the dialog that sends one from a refused page, and the
 * page that lists those the person may decide. Without the view, so that it can be tested.
 */

export { REQUEST_ACCESS_TOPIC };

/** The DOM event of `<mk-empty-state kind="denied" resource>`, as `@mosaikit/ui` names it. */
export const REQUEST_ACCESS_EVENT = 'mk-request-access';

/** The page of the shell that lists the requests to decide. */
export const ACCESS_REQUESTS_PATH = '/access-requests';

/** The resource a page refused, and the level the person may ask for. */
export interface RequestedAccess {
  readonly resource: ResourceRef;
  readonly level?: string;
}

/** A request as the requester sees it: what they gave, and the outcome. */
export interface OwnAccessRequest {
  readonly id: string;
  readonly resource: ResourceRef;
  readonly level: string;
  readonly message: string;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly created: string;
  readonly decided: string | null;
  readonly grantedLevel: string | null;
  readonly reason: string | null;
}

/** A level of a resource type. */
export interface AccessLevel {
  readonly name: string;
  readonly title: string;
}

/** A pending request, as the people who may decide it see it. */
export interface PendingAccessRequest {
  readonly id: string;
  readonly requester: string;
  readonly requesterName: string | null;
  readonly requesterEmail: string | null;
  readonly resource: ResourceRef;
  readonly title: string;
  readonly link: string;
  readonly extensionName: string;
  readonly typeTitle: string;
  readonly level: string;
  readonly levels: readonly AccessLevel[];
  readonly message: string;
  readonly created: string;
}

/**
 * The request for access that a topic of the event bus (`shell.request-access`) or a DOM event
 * (`mk-request-access`, with `{ resource }`) carries, or `undefined` when it carries none.
 */
export function requestedAccessOf(payload: unknown): RequestedAccess | undefined {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const resource = resourceOf('resource' in record ? record.resource : record);
  if (!resource) {
    return undefined;
  }
  const level = record.level;
  return typeof level === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(level)
    ? { resource, level }
    : { resource };
}

/**
 * Passes the requests for access that an element of the page dispatches (`mk-request-access`, such
 * as `<mk-empty-state kind="denied" resource>` does) to a handler; answers the function that stops.
 */
export function listenForAccessRequests(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  handle: (request: RequestedAccess) => void,
): () => void {
  const listener = (event: Event): void => {
    const request = requestedAccessOf((event as CustomEvent<unknown>).detail);
    if (request) {
      handle(request);
    }
  };
  target.addEventListener(REQUEST_ACCESS_EVENT, listener);
  return () => {
    target.removeEventListener(REQUEST_ACCESS_EVENT, listener);
  };
}

type Request = (path: string, init?: RequestInit) => Promise<Response>;

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw await toError(response);
  }
  return (await response.json()) as T;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const PATH = '/api/v1/access-requests';

/** The REST API of the requests for access (`/api/v1/access-requests`), with the credentials of the shell. */
export class AccessRequestsApi {
  constructor(private readonly request: Request) {}

  /** Sends a request: the answer is the same whether the resource exists or not. */
  send(access: RequestedAccess, message: string): Promise<OwnAccessRequest> {
    return this.request(PATH, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...access.resource, level: access.level, message }),
    }).then((response) => json<OwnAccessRequest>(response));
  }

  /** The pending requests the person may decide. */
  toDecide(): Promise<PendingAccessRequest[]> {
    return this.request(PATH).then((response) => json<PendingAccessRequest[]>(response));
  }

  approve(id: string, level?: string): Promise<OwnAccessRequest> {
    return this.request(`${PATH}/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(level ? { level } : {}),
    }).then((response) => json<OwnAccessRequest>(response));
  }

  reject(id: string, reason?: string): Promise<OwnAccessRequest> {
    return this.request(`${PATH}/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(reason ? { reason } : {}),
    }).then((response) => json<OwnAccessRequest>(response));
  }
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The longest message of a request. */
export const MAX_MESSAGE = 1000;

/**
 * Sends a request for access from the dialog; answers what to tell the person, and whether it
 * failed. The text never says more of the resource than the refused page did.
 */
export async function sendAccessRequest(
  api: Pick<AccessRequestsApi, 'send'>,
  access: RequestedAccess,
  message: string,
): Promise<{ readonly message: string; readonly failed: boolean }> {
  const text = message.trim();
  if (text.length > MAX_MESSAGE) {
    return {
      message: t('The message is too long: at most {count} characters.', {
        count: String(MAX_MESSAGE),
      }),
      failed: true,
    };
  }
  try {
    await api.send(access, text);
    return {
      message: t('Request sent. You will be notified when it is answered.'),
      failed: false,
    };
  } catch (error) {
    return {
      message: t('The request was not sent: {reason}', { reason: reason(error) }),
      failed: true,
    };
  }
}

/** What the list tells the page around it. */
export interface AccessRequestEvents {
  changed(): void;
  announce(message: string, failed: boolean): void;
}

/** The name of the requester as the list shows it. */
export function requesterOf(request: PendingAccessRequest): string {
  return request.requesterName ?? request.requesterEmail ?? t('Someone');
}

/** The title of a level of the request, or its name. */
export function levelTitle(request: PendingAccessRequest, level: string): string {
  return request.levels.find((found) => found.name === level)?.title ?? level;
}

/**
 * The pending requests the person may decide, without the view: reads them, approves one with the
 * level asked or another, rejects one with a reason, and says what happened.
 */
export class AccessRequestList {
  requests: readonly PendingAccessRequest[] | undefined;

  constructor(
    private readonly api: Pick<AccessRequestsApi, 'toDecide' | 'approve' | 'reject'> | undefined,
    private readonly events: AccessRequestEvents,
  ) {}

  async load(): Promise<void> {
    if (!this.api) {
      return;
    }
    try {
      this.requests = await this.api.toDecide();
    } catch (error) {
      this.events.announce(
        t('The requests for access cannot be read: {reason}', { reason: reason(error) }),
        true,
      );
    }
    this.events.changed();
  }

  /** Approves a request, granting the level given or the one asked; answers whether it was approved. */
  async approve(request: PendingAccessRequest, level?: string): Promise<boolean> {
    if (!this.api) {
      return false;
    }
    const granted = level ?? request.level;
    try {
      await this.api.approve(request.id, granted === request.level ? undefined : granted);
      await this.load();
      this.events.announce(
        t('{name} may now open {title} ({level}).', {
          name: requesterOf(request),
          title: request.title,
          level: levelTitle(request, granted),
        }),
        false,
      );
      return true;
    } catch (error) {
      this.events.announce(t('Not approved: {reason}', { reason: reason(error) }), true);
      return false;
    }
  }

  /** Rejects a request with an optional reason; answers whether it was rejected. */
  async reject(request: PendingAccessRequest, why?: string): Promise<boolean> {
    if (!this.api) {
      return false;
    }
    try {
      await this.api.reject(request.id, why?.trim() || undefined);
      await this.load();
      this.events.announce(
        t('The request of {name} was declined.', { name: requesterOf(request) }),
        false,
      );
      return true;
    } catch (error) {
      this.events.announce(t('Not declined: {reason}', { reason: reason(error) }), true);
      return false;
    }
  }
}

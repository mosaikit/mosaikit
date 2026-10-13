// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0

/**
 * The real-time channel of the shell (MK-031): events that the kernel sends when something changes,
 * such as a document of a collection or a notification. The shell keeps one WebSocket for the page;
 * an extension subscribes to the topics it may read and is called for each event.
 */
export interface LiveChannel {
  /**
   * Calls `handler` with the data of every event of the topic, until the returned function is
   * called. Topics: `documents.<extension id>.<collection>`, `extension.<extension id>.<name>`, `notifications`.
   */
  subscribe(topic: string, handler: (data: unknown) => void): () => void;
}

/** A channel that never sends anything, where the shell has no real-time channel. */
export const NO_LIVE: LiveChannel = {
  subscribe: () => () => undefined,
};

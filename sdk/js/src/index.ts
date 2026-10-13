// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * Public contract between the Mosaikit shell and extension frontends.
 *
 * @packageDocumentation
 */
export { NO_LIVE, type LiveChannel } from './live.js';
export { contributionsTo, stringAttribute, textAttribute } from './contributions.js';
export type {
  Contribution,
  FrontendBridge,
  FrontendExtension,
  OwnedContribution,
} from './contributions.js';
export { EventBus, isTopic, patternCovers, topicMatches } from './events.js';
export type { EventHandler, HandlerErrorListener } from './events.js';
export { DataError, dataCollections } from './data.js';
export type { DataCollection, DataDocument } from './data.js';
export { defineExtension, isMosaikitExtension } from './extension.js';
export type { CurrentUser, MosaikitExtension, ExtensionContext } from './extension.js';

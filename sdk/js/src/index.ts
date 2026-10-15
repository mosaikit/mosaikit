// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * Public contract between the Mosaikit shell and extension frontends.
 *
 * @packageDocumentation
 */
export { NO_LIVE, type LiveChannel } from './live.js';
export {
  contributionsTo,
  pointId,
  stringAttribute,
  textAttribute,
  typedContributions,
} from './contributions.js';
export type {
  Contribution,
  FrontendBridge,
  FrontendExtension,
  OwnedContribution,
  TypedContribution,
} from './contributions.js';
export { EventBus, isTopic, patternCovers, topicMatches } from './events.js';
export type { EventHandler, HandlerErrorListener } from './events.js';
export { DataError, dataCollections } from './data.js';
export type { DataCollection, DataDocument } from './data.js';
export { defineExtension, isMosaikitExtension } from './extension.js';
export type { CurrentUser, MosaikitExtension, ExtensionContext } from './extension.js';
export { PresenceStore, isPresenceChange } from './presence.js';
export type { ActiveExtension, ExtensionPresence, ExtensionPresenceChange } from './presence.js';
export { SHARE_TOPIC, openSharing, sharingLevel } from './sharing.js';
export type { SharedResourceRef } from './sharing.js';
export { RESOLVE_REFERENCES_PATH, resolveReferences, watchReferences } from './references.js';
export type {
  MissingExtension,
  MissingExtensionAction,
  ReferenceStatus,
  ResolvedReference,
} from './references.js';
export {
  REFERENCE_PLACEHOLDER_TAG,
  defineReferencePlaceholder,
  referencePlaceholderHtml,
  referencePlaceholderText,
} from './placeholder.js';
export type { ReferencePlaceholderElement, ReferencePlaceholderText } from './placeholder.js';

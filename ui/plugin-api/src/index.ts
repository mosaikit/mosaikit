// Public surface of `@mosaikit/plugin-api` (plugin API 1). Everything exported here follows the deprecation rule
// of the CHANGELOG; what is not listed is internal and may change in any release.

export { API_VERSION, checkHostApi, INCOMPATIBLE_API, isIncompatible } from './version.ts'
export { BridgeError } from './bridge.ts'
export type { Bridge } from './bridge.ts'
export { Msk, connect, type CrudClient, type ExtensionsClient, type TabClient } from './client.ts'
export { mountCrud, errText, type CrudOptions, type CrudView, type EditorCtx, type ItemCtx } from './crud-view.ts'
export type {
  ErrorCode,
  ExtensionTab,
  ExtensionView,
  FieldDecl,
  FieldKind,
  FileEntry,
  Hello,
  HostEventName,
  HostEvents,
  Level,
  ListResult,
  Listing,
  Notify,
  PublicResource,
  Rect,
  ResourceMeta,
  Row,
  SiteInfo,
  TabInfo,
  UiContext,
  Values,
  WebProbe,
} from './protocol.ts'
export { pageBody, pageHead, type PageHead } from './head.ts'
export { avatar, chip } from './items.ts'
export { h as el } from './dom.ts'
export { gridTable, type Grid, type GridCol, type GridOptions } from './grid.ts'
export { emptyState, filteredEmpty, type ArtName, type EmptyStateOptions } from './empty-state.ts'
export { watchTableScroll } from './scrollwatch.ts'

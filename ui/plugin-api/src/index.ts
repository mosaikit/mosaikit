// Public surface of `@mosaikit/plugin-api` (plugin API 1). Everything exported here follows the deprecation rule
// of the CHANGELOG; what is not listed is internal and may change in any release.

export { API_VERSION, checkHostApi, INCOMPATIBLE_API, isIncompatible } from './version.ts'
export { BridgeError } from './bridge.ts'
export type { Bridge } from './bridge.ts'
export { Msk, connect, type RealtimeApi, type RealtimeChannel, type RealtimeOptions, type CrudClient, type ExtensionsClient, type TabClient } from './client.ts'
export { fill as fillText, type Vars as TextVars } from './text.ts'
export { mountCrud, errText, type CrudHandle, type CrudOptions, type CrudView, type CustomViewApi, type EditorCtx, type ItemCtx } from './crud-view.ts'
export type {
  BandApi,
  BandBack,
  BandComments,
  BandMode,
  BandPerson,
  BandState,
  ErrorCode,
  ExtensionTab,
  ExtensionView,
  FieldDecl,
  FieldKind,
  FileEntry,
  DirectoryApi,
  DirectoryGroup,
  DirectorySearch,
  DirectoryUser,
  EmbedUrl,
  EmbedsApi,
  Schedule,
  ScheduleCreate,
  SchedulePatch,
  ScheduleRun,
  SchedulesApi,
  Hello,
  RealtimeEvent,
  RealtimeMessage,
  RealtimePerson,
  RealtimeStatus,
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
  Unzipped,
  UploadProgress,
  FileInfo,
  FileTicket,
  FolderSuggestion,
  TabInfo,
  UiContext,
  Values,
  WebProbe,
} from './protocol.ts'
export { embedSession, type EmbedSession } from './embed.ts'
export { pageBody, pageHead, type PageHead } from './head.ts'
export { avatar, chip, initials } from './items.ts'
export { addDays, avatarStack, confirmDialog, dateField, dialog, menu, personPicker, popover, progress, segmented, skeleton, tagInput, timeline, toast } from './kit.ts'
export type { DialogOptions, MenuItem, PersonPickerOptions, SegmentedOption, TimelineItem } from './kit.ts'
export { kanban, type Kanban, type KanbanColumn, type KanbanOptions } from './kanban.ts'
export { checkProgress, renderInline, renderMarkdown, toggleCheck } from './markdown.ts'
export { prefixLines, richText, wrapSelection, type RichText, type RichTextLabels } from './richtext.ts'
export { h as el } from './dom.ts'
export { gridTable, type Grid, type GridCol, type GridOptions } from './grid.ts'
export { emptyState, filteredEmpty, type ArtName, type EmptyStateOptions } from './empty-state.ts'
export { watchTableScroll } from './scrollwatch.ts'

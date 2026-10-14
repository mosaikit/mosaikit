### Fixed

- The content of the files of deleted teams and organizations, and of uninstalled extensions, stayed
  in the file store (#102). The database now queues the content of every file whose record is
  deleted (migration V36), a platform administrator queues the files of an uninstalled extension
  (`POST /api/v1/platform/files/removals/extensions/{extension}`), and an explicit clean-up
  (`POST /api/v1/platform/files/clean-up`) removes what was queued before the new setting
  `mosaikit.files.removal-retention` (30 days, one at least). It refuses a store that does not hold
  the files the database records, keeps the files of an extension installed again, and is audited
  (MK-041).

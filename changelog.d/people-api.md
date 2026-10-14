### Added

- `People` in `kernel-api` (`dev.mosaikit.kernel.api.teams`): the Java code of extensions reads the
  people and teams of the organization without a database login (#105): a person by account or
  username (e-mail, display name, standing, active), the teams and groups of the organization, never
  chats, their people and the teams of a person. It answers for one organization, also in a
  subscriber of events without a person; a guest reads only their teams and the people of those
  teams.

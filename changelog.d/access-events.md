### Added

- Events of the platform for the changes of access (#103), so that extensions that translate grants,
  teams and permissions into the rules of other servers stop polling: `sharing.granted`,
  `sharing.changed` and `sharing.revoked` (MK-055), `team.member.added`, `team.member.changed` and
  `team.member.removed` (MK-032, never for chats), `permissions.profile.changed`,
  `permissions.profile.assigned`, `permissions.team.changed` and `permissions.exception.changed`
  (MK-056). New constants of `PlatformEvents` in `kernel-api`; the events are written in the
  transaction of the change, like the others of MK-085.

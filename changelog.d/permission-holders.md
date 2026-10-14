### Added

- `PermissionHolders` in `kernel-api` (`dev.mosaikit.kernel.api.permission`): the Java code of
  extensions lists who holds a permission in the organization (#104), the people for any reason
  (administrators, profile, teams, exceptions) and the teams granted it, by the rules of
  `Permissions`, also in a subscriber of events without a person. Services outside the kernel read
  the same in the new published view `mk_published.permission_holder` (migration V33), an addition to
  the contract of MK-123.

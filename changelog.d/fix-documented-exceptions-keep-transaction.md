### Fixed

- A documented exception of a bean of `kernel-api` no longer marks the transaction of the extension
  for rollback (#126): `SecretsUnavailableException` and the other exceptions that `Secrets`,
  `Resources`, `Sharing` and `PermissionHolders` declare are thrown before the bean writes anything,
  so an extension that catches one goes on writing in the same transaction. Before, on an
  installation without a master key, the first read of a credential doomed every later write of the
  request. `FileStorage`, `Quotas`, `Permissions`, `AuditLog` and `PlatformEvents` already behaved
  this way and are now tested for it. The extension guide states the rule.

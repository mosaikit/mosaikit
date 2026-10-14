### Added

- The test bench of `@mosaikit/testing` generates a random master key for each bench
  (`mosaikit.secrets.master-key`), so that the store of credentials works on it and extensions that
  read credentials can be tested; the store answered 503 before (#100, MK-062).

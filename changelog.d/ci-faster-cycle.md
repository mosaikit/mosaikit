### Changed

- Contributors describe a change in a fragment of `changelog.d/` instead of editing
  `CHANGELOG.md`; the release assembles the fragments into the changelog
  (`node build/changelog.ts assemble`, run by `distribution/release/prepare.sh`).

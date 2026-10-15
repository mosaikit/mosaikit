### Fixed

- A page of the shell opens without failing requests: `GET /api/v1/shell/extensions/revision` answers
  `204` without a body, instead of `404`, when the extensions directory is not watched, and the shell
  no longer asks a guest for the assistant and its drafts, which the kernel refuses to guests (#132).

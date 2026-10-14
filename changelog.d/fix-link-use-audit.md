### Changed

- The use of a shared link is audited (`sharing.link.used`) the first time of each hour for each
  link, as access keys and signed links to files are, instead of on every request: a map read through
  a link wrote one entry per tile (#96). Every refused use is still audited (MK-055).

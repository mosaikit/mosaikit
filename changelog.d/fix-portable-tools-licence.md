### Fixed

- The `portable-tools` artifact did not contain Mosaikit's licence (#116), so a product building its
  portable archives from it had to copy the file by hand: it now carries `portable/LICENSE` and
  `portable/NOTICE`, which `portable/build.sh` puts in `bin/licenses` of every archive instead of the
  `LICENSE` of the directory it runs from, and the build fails if the artifact lacks them.

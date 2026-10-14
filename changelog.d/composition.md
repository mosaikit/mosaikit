### Changed

- Products are composed from common extensions (ADR-0041): the common extensions, such as a file
  catalog, dashboards and processes, live in `mosaikit/mosaikit-ext` under MPL-2.0 with requirements
  of their own (`EXT-nnn`); extensions are named `ext-<extension>[-<sub-extension>]...` with a
  manifest id of their owner's reverse-DNS name and the same segments. The sample extensions moved
  to `mosaikit/mosaikit-ext-samples`. The platform work this needs is planned in the new phase
  "Composition" of the roadmap (MK-131 to MK-135).

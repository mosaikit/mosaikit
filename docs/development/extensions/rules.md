# Rules

- Import only `kernel-api`, the Jakarta APIs and the extensions provided by the kernel (Java) and
  `@mosaikit/sdk` (frontend), plus the SPI modules of the extensions you declare in `requires`. Never
  import the kernel itself (`mosaikit-kernel`).
- Talk to other extensions through the event bus and declared services, never by importing them.
- Keep one database schema per extension, forward-only migrations, no foreign keys to other schemas.

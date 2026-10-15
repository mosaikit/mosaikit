# Try and test an extension

`@mosaikit/testing` ([ADR-0035](../../adr/0035-plugins-outside-the-kernel-repository.md), MK-050) is
a test bench: a real installation with your extension, on an embedded PostgreSQL, with an
organization and two people who confirmed their address. Nothing to install but Java 25 and
Node.js 24; the installation is downloaded once into `~/.cache/mosaikit`. The generated extension
uses it already:

```bash
npm install
npm run dev     # Mosaikit with the extension, until Ctrl+C; prints the address and the people
npm test        # the Playwright tests of tests/, on a bench started for them
```

With `npm run dev` the extension directory is linked into the installation and watched: a changed
frontend shows at once in the open page; Java code and migrations are read at the next start.
`npm test` starts a bench in `tests/global-setup.ts` (`Bench.start`) and the tests use the helpers
of `@mosaikit/testing/playwright`: `signIn`, `openApp`, `api`, `member`, `restart`. The bench
generates a random master key at each start, so an extension that reads credentials (`Secrets`) can
store them first in its tests, through the API of the credentials of the organization or of the
installation. A run with one test takes about 20 seconds for a frontend-only extension and 35
seconds with Java code, which the launcher builds into the kernel at the first start. `MOSAIKIT_BENCH_DEBUG=1` prints how long each
phase of the start takes.

On Windows an antivirus scans each new file when a program first opens it: the bench links the
libraries of the kernel instead of copying them, but the first start after a new installation is
slower. A [Dev Drive](https://learn.microsoft.com/windows/dev-drive/) for the sources and the
caches avoids most of it.

Until the first release the bench tests on the snapshot of `main`, published at every push in the
pre-release [`snapshot`](https://github.com/mosaikit/mosaikit/releases/tag/snapshot): the version
of `@mosaikit/testing` chooses the installation. `MOSAIKIT_INSTALLATION` chooses another one, such
as `target/dist/mosaikit` of a build of the kernel.

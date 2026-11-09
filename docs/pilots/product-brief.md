# Pilot brief: build a product (phase 14)

You are testing the documents, not yourselves. If something is unclear, that is our mistake: tell us.

**You need:** a computer with Node 24 or later, Rust (stable), and Docker; a second, clean machine with Docker for the
installation. Windows is welcome: it is the hardest case.

**You get:** the release `kit-v1.0.0-rc2` of `github.com/mosaikit/mosaikit` (kit and, for the desktop build, the desktop kit
of the base). Download it, check it as `docs/devkit/releasing.md` says, unpack it. Start at `docs/devkit/README.md`, then
`docs/devkit/building-an-application.md`.

**The task**

1. Make a product with its own name, brand and colour, one navigation group, one plugin of your own and at least one
   official plugin, a locked setting and a first tenant with its quotas.
2. `mosaikit-product validate` and `mosaikit-product test` pass.
3. Build the desktop release and run it.
4. Build the Docker release, install it on the clean machine, then upgrade the base to a newer version and check that the data
   survives.

**How to work**

- Use only the files of the kit.
- Write down the clock time when you start and when each step works. The first product running must take less than one
  working day.
- When you are stuck for more than ten minutes, open an issue on `mosaikit/mosaikit` with the label `pilot`.
- Say when you guess.

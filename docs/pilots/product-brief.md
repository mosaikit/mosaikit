# Pilot brief: build a product (phase 14)

You are testing the documents, not yourselves. If something is unclear, that is our mistake: tell us.

A **product** is Mosaikit with a name, a brand, a choice of plugins and defaults that are yours. You build it on the
compiled Mosaikit (the base), without the source code of the platform.

**You need**

- A computer with Node 24 or later, Rust (stable) with the target `wasm32-unknown-unknown`, and Docker.
- A second, clean machine with Docker, to install the Docker release. Windows is welcome for the desktop build: it is the
  hardest case.
- A GitHub account, to ask questions.

**You get (all public, no login)**

| What | Where |
|---|---|
| The Dev Kit (`mosaikit-product`, `mosaikit-plugin`, the documents) | <https://github.com/mosaikit/mosaikit/releases/tag/v1.0.1>, list **Assets** at the end of the page: `mosaikit-devkit-1.0.1-<your system>`, with `SHA256SUMS` and `SHA256SUMS.sig` |
| The base 1.0.0: desktop zip | <https://github.com/mosaikit/mosaikit/releases/tag/v1.0.0>, **Assets**: `mosaikit-1.0.0-desktop-windows-x86_64.zip` |
| The base 1.0.0: Docker image | `ghcr.io/mosaikit/mosaikit:v1.0.0` |
| The base 1.0.1 (for the upgrade): desktop zip | <https://github.com/mosaikit/mosaikit/releases/tag/v1.0.1>, **Assets**: `mosaikit-1.0.1-desktop-windows-x86_64.zip` |
| The base 1.0.1: Docker image | `ghcr.io/mosaikit/mosaikit:v1.0.1` |

Download the Dev Kit archive of your system and `SHA256SUMS` and `SHA256SUMS.sig`, check them as `docs/devkit/releasing.md` says,
and unpack it. Start at `README.md` of the kit, then `docs/devkit/building-an-application.md`.

**The task**

1. Make a product (`mosaikit-product new <name>`) with its own name, brand and colour, one navigation group, one plugin of
   your own, at least one official plugin, a locked setting, and a first tenant with its quotas. The base it works with:
   `>=1.0, <2`.
2. `mosaikit-product validate` and `mosaikit-product test` pass.
3. Run it (`mosaikit-product dev`), sign in as the test users, and check the brand.
4. Build the **desktop** release on the base 1.0.0 and run it.
5. Build the **Docker** release on the base 1.0.0 (`--base-image ghcr.io/mosaikit/mosaikit:v1.0.0`), install it on the
   clean machine, sign in and create some data.
6. **Upgrade the base** to 1.0.1: run `mosaikit-product test --server <base 1.0.1> --upgrade-from <base 1.0.0>`, then rebuild the
   Docker release on `ghcr.io/mosaikit/mosaikit:v1.0.1`, bring the installed product up on it, and check that the data of step 5
   is still there.

**How to work**

- Use only the files of the kit and the pages above. Do not read the source code of Mosaikit.
- Write down the clock time when you start and when each step works. The first product running (steps 1 to 3) must take
  less than one working day.
- When you are stuck for more than ten minutes, open an issue on <https://github.com/mosaikit/mosaikit/issues> with the label
  `pilot`: what you wanted to do, what you did, what you saw. Answers come there; nobody types for you.
- Say when you guess.

**At the end, tell us**

- The time of each step, with the clock times.
- Where you stopped and read something twice.
- What you expected to find and did not.
- What you would remove.

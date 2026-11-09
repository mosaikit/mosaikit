# Pilot brief: build a plugin (phase 8)

You are testing the documents, not yourself. If something is unclear, that is our mistake: tell us.

**You need:** a computer with Node 24 or later, Rust (stable) with the `wasm32-unknown-unknown` target, and Docker. Nothing
from Mosaikit is installed yet.

**You get:** the release `kit-v1.0.0-rc2` of `github.com/mosaikit/mosaikit`. Download the archive for your system, check the
hashes and the signature as `docs/devkit/releasing.md` says, unpack it. Start at `docs/devkit/README.md`.

**The task**

1. Make a plugin of your choice (a small one: a list of something with a form and a stored value is enough).
2. Run it in the development server and use it in the browser.
3. `mosaikit-plugin validate --strict` passes. `mosaikit-plugin test` passes.
4. Pack and sign it, then install the `.mskp` on the Docker kit with a trusted key, turn it on and use it.

**How to work**

- Use only the files of the kit. Do not read the source code of Mosaikit.
- Write down the clock time when you start and when each step works.
- When you are stuck for more than five minutes, open an issue on `mosaikit/mosaikit` with the label `pilot`: what you
  wanted, what you did, what you saw.
- Say it out loud or in the issue when you guess.

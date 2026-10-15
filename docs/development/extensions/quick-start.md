# Quick start

Java 25, Maven and Node.js 24; nothing else to install. `create-mosaikit-extension` (MK-023) writes
a working extension, already wired to the parent POM of extensions and to the test bench:

```bash
npx @mosaikit/create-extension dev.acme.traffic --name "Traffic"            # frontend only
npx @mosaikit/create-extension dev.acme.traffic --name "Traffic" --backend  # with Java, schema and actions
cd traffic
npm install
npm run dev      # Mosaikit with the extension, until Ctrl+C: open the address it prints and sign in
mvn verify       # the package target/traffic-0.1.0.zip, and the tests of tests/ on the bench
```

`npm run dev` starts a real Mosaikit with the extension, an organization and two people on your
machine, downloading the installation once; a changed frontend shows at once in the open page.
The generated extension has an app at `/app/traffic`; with `--backend`, a table under row-level
security, a REST API under `/api/v1/ext/traffic`, and two actions for assistants. From this
repository, `node sdk/create-extension/dist/bin.js` does the same after `npm run build`.

To install the extension elsewhere, copy `target/traffic-0.1.0.zip` into `extensions/` of an
installation, or upload it from the Extensions page; sign it first for an installation that accepts
only trusted publishers ([Signing a package](signing.md#signing-a-package)). The samples in
[mosaikit/mosaikit-ext-samples](https://github.com/mosaikit/mosaikit-ext-samples) are complete extensions built the same way.
The rest of this guide explains what each part does.

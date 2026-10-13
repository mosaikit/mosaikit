# Mosaikit SDK

Everything a third party needs to write a Mosaikit extension, and nothing of the kernel itself.

| Part | Artifact | For |
|---|---|---|
| `java/` | `io.github.mosaikit:mosaikit-kernel-api` (Maven) | the Java code of an extension: manifest model, versions, service interfaces. It depends on the JDK only |
| `java/src/main/resources/.../extension-manifest.schema.json` | in the same JAR | the JSON Schema of `manifest.yaml`, for editors and CI |
| `js/` | `@mosaikit/sdk` (npm) | the frontend of an extension: the context the shell passes to `activate(context)`, the event bus, the types of contributions |
| `extension-parent/` | `io.github.mosaikit:mosaikit-extension-parent` (Maven) | the parent POM of an extension: build, package and, with `mvn verify`, tests on the bench (MK-051) |
| `testing/` | `@mosaikit/testing` (npm) | the test bench of an extension: a real installation with the extension on an embedded PostgreSQL, for `npm run dev` (`mosaikit-bench`) and for Playwright tests (ADR-0035) |

Both are published with each release: the Maven artifact to Maven Central (`io.github.mosaikit`),
the npm package to npmjs.org ([docs/development/release.md](../docs/development/release.md)).

## An extension in short

```
my-extension/
├── pom.xml          # on mosaikit-extension-parent: the package, and for Java code its dependencies
├── manifest.yaml    # id, version, what the extension needs and contributes
├── src/main/java/   # Java code (optional), compiled into lib/my-extension.jar
├── db/              # Flyway migrations of the extension schema (optional)
└── web/index.js     # frontend, an ES module that defines Web Components (optional)
```

The build produces `target/my-extension-<version>.zip` with `manifest.yaml`, `lib/`, `db/` and
`web/`; it is installed by copying it into `extensions/` of an installation, as it is. The samples in
[`mosaikit/mosaikit-samples`](https://github.com/mosaikit/mosaikit-samples) are complete examples, and
[docs/development/extension-development.md](../docs/development/extension-development.md) is the full guide.

## Rules

- Java: import only `mosaikit-kernel-api`, the Jakarta APIs and the Quarkus extensions the kernel
  already contains, all with scope `provided`. Never the kernel itself.
- Frontend: import only `@mosaikit/sdk`; any framework that produces custom elements works.
- Talk to other extensions through the kernel (events, declared services), never by importing them.

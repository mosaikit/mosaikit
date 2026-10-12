# Mosaikit SDK

Everything a third party needs to write a Mosaikit plugin, and nothing of the kernel itself.

| Part | Artifact | For |
|---|---|---|
| `java/` | `io.github.mosaikit:mosaikit-kernel-api` (Maven) | the Java code of a plugin: manifest model, versions, service interfaces. It depends on the JDK only |
| `java/src/main/resources/.../plugin-manifest.schema.json` | in the same JAR | the JSON Schema of `manifest.yaml`, for editors and CI |
| `js/` | `@mosaikit/sdk` (npm) | the frontend of a plugin: the context the shell passes to `activate(context)`, the event bus, the types of contributions |
| `plugin-parent/` | `io.github.mosaikit:mosaikit-plugin-parent` (Maven) | the parent POM of a plugin: build, package and, with `mvn verify`, tests on the bench (MK-051) |
| `testing/` | `@mosaikit/testing` (npm) | the test bench of a plugin: a real installation with the plugin on an embedded PostgreSQL, for `npm run dev` (`mosaikit-bench`) and for Playwright tests (ADR-0035) |

Both are published with each release: the Maven artifact to Maven Central (`io.github.mosaikit`),
the npm package to npmjs.org ([docs/development/release.md](../docs/development/release.md)).

## A plugin in short

```
my-plugin/
├── pom.xml          # on mosaikit-plugin-parent: the package, and for Java code its dependencies
├── manifest.yaml    # id, version, what the plugin needs and contributes
├── src/main/java/   # Java code (optional), compiled into lib/my-plugin.jar
├── db/              # Flyway migrations of the plugin schema (optional)
└── web/index.js     # frontend, an ES module that defines Web Components (optional)
```

The build produces `target/my-plugin-<version>.zip` with `manifest.yaml`, `lib/`, `db/` and
`web/`; it is installed by copying it into `plugins/` of an installation, as it is. The samples in
[`mosaikit/mosaikit-samples`](https://github.com/mosaikit/mosaikit-samples) are complete examples, and
[docs/development/plugin-development.md](../docs/development/plugin-development.md) is the full guide.

## Rules

- Java: import only `mosaikit-kernel-api`, the Jakarta APIs and the Quarkus extensions the kernel
  already contains, all with scope `provided`. Never the kernel itself.
- Frontend: import only `@mosaikit/sdk`; any framework that produces custom elements works.
- Talk to other plugins through the kernel (events, declared services), never by importing them.

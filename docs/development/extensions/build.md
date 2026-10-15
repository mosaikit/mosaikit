# Build an extension

The POM of an extension names the parent of extensions, `io.github.mosaikit:mosaikit-extension-parent`
(MK-051), which holds the build: versions of Quarkus and of the extension API, compilation, the Jandex
index, the JAR in `lib/` and the package.

```xml
<parent>
    <groupId>io.github.mosaikit</groupId>
    <artifactId>mosaikit-extension-parent</artifactId>
    <version>0.1.0-SNAPSHOT</version>
    <relativePath/>
</parent>
<groupId>dev.acme</groupId>
<artifactId>traffic</artifactId>
<version>0.1.0</version>
<!-- <packaging>pom</packaging> for an extension without Java code -->
```

`mvn package` writes `target/<artifactId>-<version>.zip`; the property `extension.package.name`
changes its name, which is also the name of the JAR (`backend.jar` in the manifest). With a
`package.json`, `mvn package` also runs `npm install` and `npm run build`, and `mvn verify` the
tests of the extension (`npm test`); `-Dskip.npm` and `-DskipTests` skip them.

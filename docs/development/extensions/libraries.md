# Libraries of an extension

A Java extension can use libraries that the kernel does not have, such as a database driver or a
reader of a file format (MK-131): declare them as ordinary dependencies in its POM. `mvn package`
copies its runtime dependencies into `lib/`, next to its JAR, and writes them into `manifest.yaml`
under `libraries`, with their Maven coordinates and the SHA-256 digest of each JAR; the package
carries them, and the launcher adds them to the kernel with the JAR of the extension.

- **What the kernel provides is left out.** The parent POM manages the
  [libraries of the kernel](../kernel-libraries.md) in its versions with scope `provided`: a library
  of the kernel, used directly or through another library, compiles against the kernel's version
  and stays out of the package. That list is generated from the build of the kernel.
- **One version of each library.** Extensions run in one application with the kernel, on one class
  loader, so the kernel and every extension share each library. The installation refuses, naming
  the library and both versions, an extension that brings a library the kernel has in another
  version, or one that another installed extension brings in another version; the extension the
  kernel already runs keeps its version. Align the version, use the one of the kernel, or relocate
  the library into a package of your own (the Maven Shade plugin with a `relocation`). The same
  library in the same version brought by two extensions is loaded once, and stays while one of them
  is installed. A library is identified by `groupId:artifactId` (and its classifier), and versions
  compare exactly.
- **No Quarkus extensions.** A library that is a Quarkus extension fails the build and is refused
  at installation: only the kernel brings them.
- **Commit the manifest.** The `libraries` block is written by the build; do not edit it, and commit
  `manifest.yaml` after a change of dependencies, so that the directory of the extension, which
  `@mosaikit/testing` packs as it is, lists the JARs of `lib/`.

[`tests/fixtures/extensions/libraries`](../../../tests/fixtures/extensions/libraries) is a small example.

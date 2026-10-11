// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Where the kernel finds its UI: in the kernel JAR once packaged, in a directory in tests. */
@Tag("MK-008")
class UserInterfaceLocationTest {

    @TempDir
    Path directory;

    @Test
    void opensTheKernelJarAndReusesItWhenAlreadyOpen() throws IOException {
        Path jar = directory.resolve("kernel.jar");
        try (var out = new JarOutputStream(Files.newOutputStream(jar))) {
            out.putNextEntry(new JarEntry(UserInterfaceRoutes.CLASS_PATH_ROOT + "/index.html"));
            out.write("<mk-shell></mk-shell>".getBytes(UTF_8));
            out.closeEntry();
        }
        try (var loader = new URLClassLoader(new URL[] {jar.toUri().toURL()}, null)) {
            var first = UserInterfaceRoutes.locate(loader).orElseThrow();
            assertThat(first.openedFileSystem()).isPresent();
            try (var fileSystem = first.openedFileSystem().get()) {
                assertThat(Files.readString(first.root().resolve("index.html"))).contains("<mk-shell>");

                var second = UserInterfaceRoutes.locate(loader).orElseThrow();
                assertThat(second.openedFileSystem()).isEmpty();
                assertThat(second.root().resolve("index.html")).exists();
                assertThat(fileSystem.isOpen()).isTrue();
            }
        }
    }

    @Test
    void findsTheDirectoryOfTheClassPath() throws IOException {
        Path ui = Files.createDirectories(directory.resolve(UserInterfaceRoutes.CLASS_PATH_ROOT));
        Files.writeString(ui.resolve("index.html"), "<mk-shell></mk-shell>");
        try (var loader = new URLClassLoader(new URL[] {directory.toUri().toURL()}, null)) {
            var location = UserInterfaceRoutes.locate(loader).orElseThrow();

            assertThat(location.root()).isEqualTo(ui);
            assertThat(location.openedFileSystem()).isEmpty();
        }
    }

    @Test
    void findsNothingWithoutTheUserInterface() throws IOException {
        try (var loader = new URLClassLoader(new URL[] {directory.toUri().toURL()}, null)) {
            assertThat(UserInterfaceRoutes.locate(loader)).isEmpty();
        }
    }
}

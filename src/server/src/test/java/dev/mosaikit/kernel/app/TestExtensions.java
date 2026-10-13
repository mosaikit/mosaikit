// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import io.quarkus.test.junit.QuarkusTestProfile;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;

/**
 * One kernel for the tests that need extensions without a backend in its extensions directory: every
 * Quarkus test profile starts a kernel of its own, 15 to 40 seconds each, so the tests share this
 * one. The extensions do not see each other: each test reads only its own.
 */
public class TestExtensions implements QuarkusTestProfile {

    static final Path EXTENSIONS =
            Path.of("target", "test-extensions", "extensions").toAbsolutePath();

    @Override
    public Map<String, String> getConfigOverrides() {
        try {
            // ActivityTest: an extension that sends notifications.
            extension("notify", "dev.mosaikit.test.notify", "Notify", "");
            // DocumentTest and OrganizationAppsTest: an app with a collection of documents.
            extension("todo", "dev.mosaikit.test.todo", "To do", """
                    data:
                      collections: [items]
                    permissions:
                      - { name: add-item, title: Add items }
                    contributes:
                      rail.app:
                        - { id: todo, title: To do, route: /app/todo, element: test-todo-app, order: 10 }
                    """);
            // OrganizationAppsTest: a second app.
            extension("board", "dev.mosaikit.test.board", "Board", """
                    contributes:
                      rail.app:
                        - { id: board, title: Board, route: /app/board, element: test-board-app, order: 20 }
                    """);
            // LiveTest and TeamTest: collections of documents.
            extension("live", "dev.mosaikit.test.live", "Live", """
                    data:
                      collections: [items]
                    """);
            extension("notes", "dev.mosaikit.test.notes", "Notes", """
                    data:
                      collections: [notes]
                    """);
            // ResourceRegistryTest: an extension that registers notes in folders, and one that is
            // uninstalled (MK-054).
            extension("resources", "dev.mosaikit.test.resources", "Resources", """
                    resources:
                      - type: note
                        title: Note
                        levels: [{ name: view, title: View }, { name: edit, title: Edit, edits: true }]
                      - type: folder
                        title: Folder
                        levels: [{ name: view, title: View }]
                    """);
            extension("parting", "dev.mosaikit.test.parting", "Parting", """
                    resources:
                      - type: note
                        title: Note
                        levels: [{ name: view, title: View }]
                    """);
            // FileStorageTest: an extension that stores files, some attached to its albums (MK-041).
            extension("files", FileStorageTest.EXTENSION, "Files", """
                    resources:
                      - type: album
                        title: Album
                        levels: [{ name: view, title: View }]
                    """);
            // PermissionsTest: an extension that declares permissions (MK-056); the test changes
            // its manifest as an update would.
            extension("permissions", PermissionsTest.EXTENSION, "Permissions", PermissionsTest.PERMISSIONS);
            // SharingTest: documents shared at four levels with every kind of subject, links up to
            // "use", and memos shared with people, groups and the organization only (MK-055).
            extension("sharing", SharingTest.EXTENSION, "Sharing", SharingTest.RESOURCES);
            // ThemeExtensionTest: a theme that names the product and brings its logo (MK-052), and one
            // with a value that is not a color.
            theme("green", "dev.mosaikit.test.green", "Green", "'#1b6e3c'", """
                      product: Green Works
                      logo:
                        light: web/logo.svg
                    """);
            Path logo = Files.createDirectories(EXTENSIONS.resolve("green").resolve("web"));
            Files.writeString(logo.resolve("logo.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>\n");
            theme("broken", "dev.mosaikit.test.broken-theme", "Broken", "red", "");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return Map.of(
                "mosaikit.extensions.directory",
                EXTENSIONS.toString(),
                "mosaikit.ui.theme",
                "dev.mosaikit.test.green",
                // FileStorageTest: a limit that a test reaches quickly.
                "mosaikit.files.max-size",
                "1M");
    }

    static void extension(String directory, String id, String name, String extra) throws IOException {
        Path web = Files.createDirectories(EXTENSIONS.resolve(directory).resolve("web"));
        Files.writeString(web.resolve("index.js"), "export default { activate() {} };\n");
        Files.writeString(web.getParent().resolve("manifest.yaml"), """
                id: %s
                version: 1.0.0
                name: %s (test)
                kind: [app]
                platform: '>=0.1 <1'
                frontend:
                  entry: web/index.js
                %s""".formatted(id, name, extra));
    }

    private static void theme(String directory, String id, String title, String brand, String extra)
            throws IOException {
        Path extension = Files.createDirectories(EXTENSIONS.resolve(directory));
        Files.writeString(extension.resolve("manifest.yaml"), """
                id: %s
                version: 1.0.0
                name: %s (test)
                kind: [theme]
                platform: '>=0.1 <1'
                theme:
                  title: %s
                  light:
                    brand: %s
                %s""".formatted(id, title, title, brand, extra));
    }
}

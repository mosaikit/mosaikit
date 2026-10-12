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
 * One kernel for the tests that need plugins without a backend in its plugins directory: every
 * Quarkus test profile starts a kernel of its own, 15 to 40 seconds each, so the tests share this
 * one. The plugins do not see each other: each test reads only its own.
 */
public class TestPlugins implements QuarkusTestProfile {

    static final Path PLUGINS = Path.of("target", "test-plugins", "plugins").toAbsolutePath();

    @Override
    public Map<String, String> getConfigOverrides() {
        try {
            // ActivityTest: a plugin that sends notifications.
            plugin("notify", "dev.mosaikit.test.notify", "Notify", "");
            // DocumentTest and OrganizationAppsTest: an app with a collection of documents.
            plugin("todo", "dev.mosaikit.test.todo", "To do", """
                    data:
                      collections: [items]
                    contributes:
                      rail.app:
                        - { id: todo, title: To do, route: /app/todo, element: test-todo-app, order: 10 }
                    """);
            // OrganizationAppsTest: a second app.
            plugin("board", "dev.mosaikit.test.board", "Board", """
                    contributes:
                      rail.app:
                        - { id: board, title: Board, route: /app/board, element: test-board-app, order: 20 }
                    """);
            // LiveTest and TeamTest: collections of documents.
            plugin("live", "dev.mosaikit.test.live", "Live", """
                    data:
                      collections: [items]
                    """);
            plugin("notes", "dev.mosaikit.test.notes", "Notes", """
                    data:
                      collections: [notes]
                    """);
            // ThemePluginTest: a theme, and one with a value that is not a color.
            theme("green", "dev.mosaikit.test.green", "Green", "'#1b6e3c'");
            theme("broken", "dev.mosaikit.test.broken-theme", "Broken", "red");
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return Map.of("mosaikit.plugins.directory", PLUGINS.toString(), "mosaikit.ui.theme", "dev.mosaikit.test.green");
    }

    private static void plugin(String directory, String id, String name, String extra) throws IOException {
        Path web = Files.createDirectories(PLUGINS.resolve(directory).resolve("web"));
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

    private static void theme(String directory, String id, String title, String brand) throws IOException {
        Path plugin = Files.createDirectories(PLUGINS.resolve(directory));
        Files.writeString(plugin.resolve("manifest.yaml"), """
                id: %s
                version: 1.0.0
                name: %s (test)
                kind: [theme]
                platform: '>=0.1 <1'
                theme:
                  title: %s
                  light:
                    brand: %s
                """.formatted(id, title, title, brand));
    }
}

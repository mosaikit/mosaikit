// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web;

import io.quarkus.runtime.LaunchMode;
import io.quarkus.runtime.ShutdownEvent;
import io.vertx.core.buffer.Buffer;
import io.vertx.core.http.HttpHeaders;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.file.FileSystem;
import java.nio.file.FileSystemAlreadyExistsException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import org.jboss.logging.Logger;

/**
 * Serves the built kernel UI, packaged in the kernel under {@code mosaikit-ui/}, as a single-page
 * application: a path that is not a file answers with {@code index.html}, so that deep links such
 * as {@code /app/notes} work after a reload. The API ({@code /api}) and the management endpoints
 * ({@code /q}) are never served from here.
 *
 * <p>The UI is built by npm before the kernel is compiled and is only copied into it, so that
 * rebuilding the kernel for a Java plugin never needs Node.js. In development mode Quinoa serves
 * the UI sources with live reload instead.
 */
@ApplicationScoped
public class UserInterfaceRoutes {

    /** Location of the UI in the class path of the kernel. */
    public static final String CLASS_PATH_ROOT = "mosaikit-ui";

    private static final Logger LOG = Logger.getLogger(UserInterfaceRoutes.class);
    private static final String INDEX = "index.html";
    private static final String UI_PATHS = "^/(?!api(/|$)|q(/|$)|mcp(/|$)).*";

    /** The file system of the kernel JAR, opened to read the UI and closed at shutdown. */
    private FileSystem openedFileSystem;

    void register(@Observes Router router) {
        if (LaunchMode.current() == LaunchMode.DEVELOPMENT) {
            return;
        }
        Optional<Location> location = locate(Thread.currentThread().getContextClassLoader());
        if (location.isEmpty()) {
            LOG.warnf("No %s/%s in the class path: the user interface is not served", CLASS_PATH_ROOT, INDEX);
            return;
        }
        openedFileSystem = location.get().openedFileSystem().orElse(null);
        Path root = location.get().root();
        router.getWithRegex(UI_PATHS).blockingHandler(context -> serve(context, root), false);
        router.headWithRegex(UI_PATHS).blockingHandler(context -> serve(context, root), false);
    }

    void close(@Observes ShutdownEvent event) {
        if (openedFileSystem != null) {
            try {
                openedFileSystem.close();
            } catch (IOException e) {
                LOG.debugf(e, "Cannot close the file system of the user interface");
            }
        }
    }

    /**
     * Where the UI is: a directory of the class path in tests, a directory inside the kernel JAR
     * otherwise.
     *
     * @param root the directory that holds {@code index.html}
     * @param openedFileSystem the JAR file system opened by this call, which the caller closes
     */
    record Location(Path root, Optional<FileSystem> openedFileSystem) {}

    /** The UI directory in the class path of {@code loader}, if it is there. */
    static Optional<Location> locate(ClassLoader loader) {
        URL index = loader.getResource(CLASS_PATH_ROOT + "/" + INDEX);
        if (index == null) {
            return Optional.empty();
        }
        try {
            URI uri = index.toURI();
            if (!"jar".equals(uri.getScheme())) {
                return Optional.of(new Location(Path.of(uri).getParent(), Optional.empty()));
            }
            Optional<FileSystem> opened = openJar(uri);
            FileSystem fileSystem = opened.orElseGet(() -> FileSystems.getFileSystem(uri));
            return Optional.of(new Location(fileSystem.provider().getPath(uri).getParent(), opened));
        } catch (URISyntaxException | IOException e) {
            throw new IllegalStateException("Cannot open the user interface at " + index, e);
        }
    }

    /** Opens the file system of the JAR, or nothing if it is already open. */
    private static Optional<FileSystem> openJar(URI uri) throws IOException {
        try {
            return Optional.of(FileSystems.newFileSystem(uri, Map.of()));
        } catch (FileSystemAlreadyExistsException _) {
            return Optional.empty();
        }
    }

    private static void serve(RoutingContext context, Path root) {
        String path = context.normalizedPath();
        String relative = path.equals("/") ? INDEX : path.substring(1);
        Optional<StaticFiles.StaticFile> file = StaticFiles.resolve(root, relative);
        if (file.isEmpty() && StaticFiles.looksLikeFile(path)) {
            context.response().setStatusCode(404).end();
            return;
        }
        StaticFiles.StaticFile served =
                file.orElseGet(() -> StaticFiles.resolve(root, INDEX).orElseThrow());
        boolean hashedAsset = relative.startsWith("assets/");
        byte[] content;
        try {
            content = Files.readAllBytes(served.file());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        context.response()
                .putHeader(HttpHeaders.CONTENT_TYPE, served.mediaType())
                .putHeader("X-Content-Type-Options", "nosniff")
                // The runtime of isolated plugin frontends (frame.js and its chunks) is loaded by
                // sandboxed iframes with an opaque origin, as cross-origin requests (MK-014).
                .putHeader("Access-Control-Allow-Origin", "*")
                .putHeader(
                        HttpHeaders.CACHE_CONTROL,
                        // Vite gives assets content-hashed names; index.html must always be revalidated.
                        hashedAsset ? "public, max-age=31536000, immutable" : "no-cache")
                .end(Buffer.buffer(content));
    }
}

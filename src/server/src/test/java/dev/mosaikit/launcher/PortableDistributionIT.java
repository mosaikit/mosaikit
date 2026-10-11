// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.launcher;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.Base64;
import java.util.Comparator;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Acceptance test of MK-016 on the Linux archive of the portable distribution, given with {@code
 * -Dmosaikit.it.portable=<archive>}; skipped otherwise. It runs the archive as a user would, with
 * no Java or PostgreSQL other than the ones inside it.
 */
@Tag("MK-016")
class PortableDistributionIT {

    private static final Duration FIRST_START = Duration.ofSeconds(30);
    private static final long MEMORY_LIMIT_MB = 600;

    /** Kept after the test, with the logs of every run (target/it/portable). */
    private Path work;

    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper json = new ObjectMapper();
    private Process mosaikit;
    private int port;
    private int databasePort;

    @AfterEach
    void stopMosaikit() throws InterruptedException {
        stop();
    }

    @Test
    void runsOneOrganizationFromOneArchive() throws Exception {
        String archive = System.getProperty("mosaikit.it.portable");
        assumeTrue(archive != null && !archive.isBlank(), "set -Dmosaikit.it.portable to the Linux archive");
        work = Path.of(System.getProperty("mosaikit.it.work")).resolve("portable");
        deleteRecursively(work);
        port = freePort();
        databasePort = freePort();

        // 1. First start with one command, on a machine without Java or PostgreSQL.
        Path home = unpack(Path.of(archive), work.resolve("first"));
        long start = System.nanoTime();
        start(home);
        assertThat(Duration.ofNanos(System.nanoTime() - start))
                .as("first start")
                .isLessThan(FIRST_START);
        String password = Files.readString(home.resolve("data/initial-admin-password.txt"))
                .strip();
        assertThat(get("/api/v1/accounts/me", password).path("username").asText())
                .isEqualTo("admin");
        assertThat(post(
                        "/api/v1/organizations",
                        password,
                        "{\"slug\":\"demo\",\"name\":\"Demo\",\"selfRegistration\":true}"))
                .isEqualTo(201);
        // Plugin data belong to an organization (MK-017): a member of demo writes the notes.
        assertThat(post(
                        "/api/v1/accounts/registrations",
                        password,
                        "{\"organization\":\"demo\",\"email\":\"" + MEMBER + "\",\"displayName\":\"Member\","
                                + "\"password\":\"" + MEMBER_PASSWORD + "\"}"))
                .isEqualTo(201);

        // 4. The whole distribution stays below the memory limit at rest.
        assertThat(mosaikit.waitFor(3, TimeUnit.SECONDS))
                .as("Mosaikit still runs")
                .isFalse();
        assertThat(residentMemoryMegabytes(home)).as("memory at rest in MB").isLessThan(MEMORY_LIMIT_MB);

        // 3. A plugin copied into plugins/ is active after a restart.
        stop();
        installSampleNotes(home);
        start(home);
        assertThat(post(MEMBER, "/api/v1/p/sample-notes/notes", MEMBER_PASSWORD, "{\"text\":\"Kept in data/\"}"))
                .isEqualTo(201);

        // 2. Data survive a restart and a backup of data/ restores them on another copy.
        stop();
        Path restored = unpack(Path.of(archive), work.resolve("restored"));
        installSampleNotes(restored);
        copy(home.resolve("data"), restored.resolve("data"));
        start(restored);
        assertThat(get("/api/v1/organizations", password).findValuesAsText("slug"))
                .contains("demo");
        assertThat(get(MEMBER, "/api/v1/p/sample-notes/notes", MEMBER_PASSWORD).findValuesAsText("text"))
                .contains("Kept in data/");
    }

    private void start(Path home) throws Exception {
        ProcessBuilder builder = new ProcessBuilder(home.resolve("mosaikit").toString())
                .directory(home.toFile())
                .redirectErrorStream(true)
                .redirectOutput(ProcessBuilder.Redirect.appendTo(
                        home.resolve("mosaikit.log").toFile()));
        Map<String, String> environment = builder.environment();
        environment.remove("JAVA_HOME");
        environment.put("PATH", "/usr/bin:/bin");
        environment.put("QUARKUS_HTTP_PORT", String.valueOf(port));
        environment.put("MOSAIKIT_DATABASE_PORT", String.valueOf(databasePort));
        mosaikit = builder.start();
        long deadline = System.nanoTime() + Duration.ofSeconds(90).toNanos();
        while (System.nanoTime() < deadline) {
            if (!mosaikit.isAlive()) {
                throw new AssertionError("Mosaikit stopped:\n" + Files.readString(home.resolve("mosaikit.log")));
            }
            if (isReady()) {
                return;
            }
            // Returns at once if Mosaikit stops, which the next iteration reports.
            mosaikit.waitFor(250, TimeUnit.MILLISECONDS);
        }
        throw new AssertionError("Mosaikit is not ready:\n" + Files.readString(home.resolve("mosaikit.log")));
    }

    /** Stops Mosaikit as a service manager would: SIGTERM to the mosaikit launcher, which stops the database. */
    private void stop() throws InterruptedException {
        if (mosaikit != null && mosaikit.isAlive()) {
            mosaikit.destroy();
            mosaikit.waitFor();
        }
    }

    private boolean isReady() {
        try {
            return http.send(
                                    HttpRequest.newBuilder(uri("/q/health/ready"))
                                            .build(),
                                    HttpResponse.BodyHandlers.discarding())
                            .statusCode()
                    == 200;
        } catch (IOException _) {
            return false;
        } catch (InterruptedException _) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    /** Resident memory of every process of the installation (kernel, PostgreSQL), from /proc. */
    private static long residentMemoryMegabytes(Path home) {
        String root = home.toString();
        return ProcessHandle.allProcesses()
                        .filter(process -> process.info()
                                .command()
                                .map(command -> command.startsWith(root))
                                .orElse(false))
                        .mapToLong(process -> residentKilobytes(process.pid()))
                        .sum()
                / 1024;
    }

    private static long residentKilobytes(long pid) {
        try (Stream<String> lines = Files.lines(Path.of("/proc", String.valueOf(pid), "status"))) {
            return lines.filter(line -> line.startsWith("VmRSS:"))
                    .mapToLong(line -> Long.parseLong(line.replaceAll("\\D", "")))
                    .sum();
        } catch (IOException _) {
            return 0;
        }
    }

    private static Path unpack(Path archive, Path target) throws Exception {
        Files.createDirectories(target);
        Process tar = new ProcessBuilder("tar", "-xzf", archive.toString(), "-C", target.toString())
                .inheritIO()
                .start();
        assertThat(tar.waitFor()).as("unpack " + archive).isZero();
        try (Stream<Path> children = Files.list(target)) {
            return children.filter(Files::isDirectory).findFirst().orElseThrow();
        }
    }

    /** Copies the package of the sample plugin into plugins/, as it is. */
    private static void installSampleNotes(Path home) throws IOException {
        Path source = Path.of(System.getProperty("mosaikit.it.plugin"));
        Files.copy(source, home.resolve("plugins").resolve(source.getFileName()), StandardCopyOption.REPLACE_EXISTING);
    }

    private static void deleteRecursively(Path directory) throws IOException {
        if (Files.exists(directory)) {
            try (Stream<Path> paths = Files.walk(directory)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) {
                    Files.delete(path);
                }
            }
        }
    }

    private static void copy(Path source, Path target) throws IOException {
        deleteRecursively(target);
        try (Stream<Path> paths = Files.walk(source)) {
            for (Path path : paths.toList()) {
                Path destination = target.resolve(source.relativize(path).toString());
                if (Files.isDirectory(path)) {
                    Files.createDirectories(destination);
                } else {
                    Files.copy(path, destination, StandardCopyOption.COPY_ATTRIBUTES);
                }
            }
        }
    }

    private static final String MEMBER = "member@demo.test";
    private static final String MEMBER_PASSWORD = "a long enough password";

    private JsonNode get(String path, String password) throws IOException, InterruptedException {
        return get("admin", path, password);
    }

    private JsonNode get(String username, String path, String password) throws IOException, InterruptedException {
        HttpResponse<String> response = http.send(
                authorized(HttpRequest.newBuilder(uri(path)), username, password)
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).as(path + ": " + response.body()).isEqualTo(200);
        return json.readTree(response.body());
    }

    private int post(String path, String password, String body) throws IOException, InterruptedException {
        return post("admin", path, password, body);
    }

    private int post(String username, String path, String password, String body)
            throws IOException, InterruptedException {
        return http.send(
                        authorized(HttpRequest.newBuilder(uri(path)), username, password)
                                .header("Content-Type", "application/json")
                                .POST(HttpRequest.BodyPublishers.ofString(body))
                                .build(),
                        HttpResponse.BodyHandlers.discarding())
                .statusCode();
    }

    private static HttpRequest.Builder authorized(HttpRequest.Builder request, String username, String password) {
        return request.header(
                "Authorization",
                "Basic " + Base64.getEncoder().encodeToString((username + ":" + password).getBytes(UTF_8)));
    }

    private URI uri(String path) {
        return URI.create("http://127.0.0.1:" + port + path);
    }

    private static int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }
}

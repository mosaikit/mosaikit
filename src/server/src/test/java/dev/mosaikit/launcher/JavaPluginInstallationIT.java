// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.launcher;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.plugin.PluginPackages;
import dev.mosaikit.testing.EmbeddedPostgres;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import javax.tools.ToolProvider;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInfo;

/**
 * End-to-end test of MK-011 on real installations: kernel as mutable JAR, launcher, Java plugins
 * and PostgreSQL 18 ({@link EmbeddedPostgres}, or an external server given with {@code
 * -Dmosaikit.it.jdbc-url}, {@code -username} and {@code -password}). Each test gets its own
 * installation and its own database.
 */
@Tag("MK-011")
class JavaPluginInstallationIT {

    private static final String ADMIN_PASSWORD = "it-admin-password";
    private static final String NOTES = "dev.mosaikit.sample.notes";
    private static final Duration ACCEPTANCE = Duration.ofSeconds(60);

    private static EmbeddedPostgres postgres;
    private static String serverUrl;
    private static String jdbcUsername;
    private static String jdbcPassword;

    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper json = new ObjectMapper();

    private Installation installation;
    private String database;
    private Process kernel;
    private int port;

    @BeforeAll
    static void startDatabaseServer() {
        serverUrl = System.getProperty("mosaikit.it.jdbc-url");
        if (serverUrl == null) {
            postgres = EmbeddedPostgres.start();
            serverUrl = postgres.jdbcUrl("postgres");
            jdbcUsername = EmbeddedPostgres.USER;
            jdbcPassword = EmbeddedPostgres.PASSWORD;
        } else {
            jdbcUsername = System.getProperty("mosaikit.it.jdbc-username", "mosaikit");
            jdbcPassword = System.getProperty("mosaikit.it.jdbc-password", "mosaikit");
        }
    }

    @AfterAll
    static void stopDatabaseServer() {
        if (postgres != null) {
            postgres.close();
        }
    }

    /** Creates an installation with its own database for each test. */
    private void newInstallation(TestInfo test) throws IOException {
        String name = test.getTestMethod().orElseThrow().getName();
        Path work = Path.of(System.getProperty("mosaikit.it.work")).resolve(name);
        deleteRecursively(work);
        installation = new Installation(work.resolve("mosaikit"));
        copyRecursively(Path.of(System.getProperty("mosaikit.it.kernel")), installation.kernel());
        Files.createDirectories(installation.plugins());
        database = "mosaikit_it_" + Long.toHexString(System.nanoTime());
        execute("create database " + database);
        port = freePort();
    }

    @AfterEach
    void removeInstallation() {
        stopKernel();
        if (database != null) {
            execute("drop database if exists " + database);
        }
    }

    @Test
    void activatesAJavaPluginWithEndpointEntityAndMigrationAfterOneRestart(TestInfo test) throws Exception {
        newInstallation(test);
        assertThat(prepare()).as("prepare without plugins").isZero();

        installSampleNotes();
        long start = System.nanoTime();
        assertThat(prepare()).as("prepare with the new plugin").isZero();
        assertThat(startKernel()).as("the kernel starts").isTrue();
        Duration elapsed = Duration.ofNanos(System.nanoTime() - start);

        assertThat(elapsed).as("rebuild and start").isLessThan(ACCEPTANCE);
        assertThat(plugin(NOTES).path("status").asText()).isEqualTo("ACTIVE");
        String ada = member("acme");
        String bea = member("globex");
        HttpResponse<String> created = send(
                HttpRequest.newBuilder(uri("/api/v1/p/sample-notes/notes"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString("{\"text\":\"Written by the plugin\"}")),
                ada,
                MEMBER_PASSWORD);
        assertThat(created.statusCode()).as(created.body()).isEqualTo(201);
        assertThat(notes(ada)).containsExactly("Written by the plugin");
        // Each organization sees only its own data, and a plugin API always acts on one (MK-017).
        assertThat(notes(bea)).isEmpty();
        assertThat(send(HttpRequest.newBuilder(uri("/api/v1/p/sample-notes/notes"))
                                .GET())
                        .statusCode())
                .as("the platform administrator has no organization")
                .isEqualTo(403);

        runsTheActionsOfThePluginAsTools(ada, bea);

        stopKernel();
        List<String> output = new ArrayList<>();
        assertThat(prepare(output)).isZero();
        assertThat(output).anySatisfy(line -> assertThat(line).contains("kernel up to date"));
        assertThat(installation.providers().resolve(ProviderStateFiles.PENDING)).doesNotExist();
    }

    @Test
    @Tag("MK-020")
    void extendsAnAppWithAnotherPluginWithoutForeignKeys(TestInfo test) throws Exception {
        newInstallation(test);
        for (String property : List.of("mosaikit.it.activities", "mosaikit.it.estimates")) {
            Path source = Path.of(System.getProperty(property));
            Files.copy(source, installation.plugins().resolve(source.getFileName()));
        }
        assertThat(prepare()).as("prepare with the app and its extension").isZero();
        assertThat(startKernel()).as("the kernel starts").isTrue();
        assertThat(plugin("dev.mosaikit.sample.activities").path("status").asText())
                .isEqualTo("ACTIVE");
        assertThat(plugin("dev.mosaikit.sample.estimates").path("status").asText())
                .isEqualTo("ACTIVE");
        String ada = member("acme");
        String bea = member("globex");

        JsonNode shell = json.readTree(
                send(HttpRequest.newBuilder(uri("/api/v1/shell/plugins")).GET(), ada, MEMBER_PASSWORD)
                        .body());
        assertThat(shell.findValues("points").toString()).contains("activities.detail");
        assertThat(shell.toString()).contains("mk-activity-estimate");

        HttpResponse<String> created = send(
                HttpRequest.newBuilder(uri("/api/v1/p/sample-activities/activities"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString("{\"title\":\"Paint the fence\"}")),
                ada,
                MEMBER_PASSWORD);
        assertThat(created.statusCode()).as(created.body()).isEqualTo(201);
        String activity = json.readTree(created.body()).path("id").asText();
        String estimate = "/api/v1/p/sample-estimates/estimates/" + activity;
        HttpResponse<String> estimated = send(
                HttpRequest.newBuilder(uri(estimate))
                        .header("Content-Type", "application/json")
                        .PUT(HttpRequest.BodyPublishers.ofString("{\"hours\":3.5}")),
                ada,
                MEMBER_PASSWORD);
        assertThat(estimated.statusCode()).as(estimated.body()).isEqualTo(200);

        // The extension reads the activities through the data contract of the app, per organization.
        JsonNode adaEstimates = json.readTree(send(
                        HttpRequest.newBuilder(uri("/api/v1/p/sample-estimates/estimates"))
                                .GET(),
                        ada,
                        MEMBER_PASSWORD)
                .body());
        assertThat(adaEstimates.findValuesAsText("title")).containsExactly("Paint the fence");
        assertThat(adaEstimates.get(0).path("hours").decimalValue()).isEqualByComparingTo("3.5");
        assertThat(send(
                                HttpRequest.newBuilder(uri("/api/v1/p/sample-estimates/estimates"))
                                        .GET(),
                                bea,
                                MEMBER_PASSWORD)
                        .body())
                .isEqualTo("[]");
        assertThat(send(
                                HttpRequest.newBuilder(uri(estimate))
                                        .header("Content-Type", "application/json")
                                        .PUT(HttpRequest.BodyPublishers.ofString("{\"hours\":1}")),
                                bea,
                                MEMBER_PASSWORD)
                        .statusCode())
                .as("another organization cannot estimate the activity")
                .isEqualTo(404);
        stopKernel();
    }

    @Test
    void rollsBackAPluginWithWhichTheKernelDoesNotStart(TestInfo test) throws Exception {
        newInstallation(test);
        prepare();
        Path unpacked = installSampleNotesUnpacked();
        Files.writeString(unpacked.resolve("db/V1__create_note.sql"), "this is not SQL;");

        assertThat(prepare()).isZero();
        assertThat(startKernel()).as("the kernel stops on the failed migration").isFalse();

        List<String> output = new ArrayList<>();
        assertThat(prepare(output)).isZero();
        assertThat(output).anySatisfy(line -> assertThat(line).contains("did not start with " + NOTES));
        assertThat(startKernel())
                .as("the kernel starts with the previous plugins")
                .isTrue();
        assertThat(plugin(NOTES).path("status").asText()).isEqualTo("INVALID");
        assertThat(plugin(NOTES).path("problems").get(0).asText()).startsWith("Rolled back");
        assertThat(send(HttpRequest.newBuilder(uri("/api/v1/p/sample-notes/notes"))
                                .GET())
                        .statusCode())
                .isEqualTo(404);
    }

    @Test
    void rollsBackAPluginWithWhichTheKernelCannotBeRebuilt(TestInfo test) throws Exception {
        newInstallation(test);
        prepare();
        installBrokenPlugin();

        List<String> output = new ArrayList<>();
        assertThat(prepare(output)).as("the previous kernel can start").isZero();

        assertThat(output)
                .anySatisfy(line -> assertThat(line).contains("could not be rebuilt with dev.mosaikit.test.broken"));
        assertThat(startKernel()).isTrue();
        assertThat(plugin("dev.mosaikit.test.broken").path("status").asText()).isEqualTo("INVALID");
    }

    /** File names of the launcher state, repeated here to keep the test independent of the code. */
    private static final class ProviderStateFiles {
        static final String PENDING = "mosaikit-pending.txt";
    }

    // --- plugins -------------------------------------------------------------------------------

    /** Installs the sample plugin as a user would: its package, copied into plugins/ as it is. */
    private void installSampleNotes() throws IOException {
        Path source = Path.of(System.getProperty("mosaikit.it.plugin"));
        Files.copy(source, installation.plugins().resolve(source.getFileName()));
    }

    /** Installs the sample plugin as a directory, unpacked from its package. */
    private Path installSampleNotesUnpacked() throws IOException {
        return PluginPackages.unpack(Path.of(System.getProperty("mosaikit.it.plugin")), installation.plugins());
    }

    /** A plugin whose bean has an unsatisfied dependency: the Quarkus build refuses it. */
    private void installBrokenPlugin() throws IOException {
        Path root = installation.plugins().resolve("broken");
        Path sources = Files.createDirectories(root.resolve("src/dev/mosaikit/test/broken"));
        Files.writeString(sources.resolve("Broken.java"), """
                package dev.mosaikit.test.broken;

                @io.quarkus.runtime.Startup
                @jakarta.enterprise.context.ApplicationScoped
                public class Broken {
                    public interface Missing {}

                    @jakarta.inject.Inject
                    Missing missing;
                }
                """);
        Path classes = Files.createDirectories(root.resolve("classes"));
        String classPath;
        try (Stream<Path> jars = Files.list(installation.kernel().resolve("lib/main"))) {
            classPath = jars.map(Path::toString).collect(Collectors.joining(File.pathSeparator));
        }
        int compiled = ToolProvider.getSystemJavaCompiler()
                .run(
                        null,
                        null,
                        null,
                        "-d",
                        classes.toString(),
                        "-cp",
                        classPath,
                        sources.resolve("Broken.java").toString());
        assertThat(compiled).as("compile the broken plugin").isZero();
        Files.createDirectories(root.resolve("lib"));
        try (OutputStream file = Files.newOutputStream(root.resolve("lib/broken.jar"));
                JarOutputStream jar = new JarOutputStream(file);
                Stream<Path> paths = Files.walk(classes)) {
            jar.putNextEntry(new JarEntry("META-INF/beans.xml"));
            jar.closeEntry();
            for (Path path : paths.filter(Files::isRegularFile).toList()) {
                jar.putNextEntry(
                        new JarEntry(classes.relativize(path).toString().replace('\\', '/')));
                Files.copy(path, jar);
                jar.closeEntry();
            }
        }
        Files.writeString(root.resolve("manifest.yaml"), """
                id: dev.mosaikit.test.broken
                version: 1.0.0
                name: Broken
                kind: [service]
                platform: ">=0.1 <1"
                backend:
                  jar: lib/broken.jar
                  api: broken
                """);
    }

    // --- launcher and kernel -------------------------------------------------------------------

    private int prepare() throws IOException, InterruptedException {
        return prepare(new ArrayList<>());
    }

    private int prepare(List<String> output) throws IOException, InterruptedException {
        // The wildcard is a class path convention, not a file name: Windows paths cannot hold it.
        String classPath = installation.kernel().resolve("app") + File.separator + "*"
                + File.pathSeparator
                + installation.kernel().resolve("lib").resolve("main") + File.separator + "*";
        Process process = new ProcessBuilder(
                        java(),
                        "-cp",
                        classPath,
                        Launcher.class.getName(),
                        "prepare",
                        installation.home().toString())
                .redirectErrorStream(true)
                .start();
        try (var lines = process.inputReader(UTF_8).lines()) {
            lines.forEach(line -> {
                System.out.println("[launcher] " + line);
                output.add(line);
            });
        }
        return process.waitFor();
    }

    /** Starts the kernel as the mosaikit script does; returns {@code false} if it stops before being ready. */
    private boolean startKernel() throws Exception {
        Path log = installation.home().resolve("kernel.log");
        kernel = new ProcessBuilder(
                        java(),
                        "-Dquarkus.http.port=" + port,
                        "-Dquarkus.datasource.jdbc.url="
                                + serverUrl.replaceFirst("(jdbc:postgresql://[^/]+/)[^?]*", "$1" + database),
                        "-Dquarkus.datasource.username=" + jdbcUsername,
                        "-Dquarkus.datasource.password=" + jdbcPassword,
                        "-Dmosaikit.bootstrap.admin-password=" + ADMIN_PASSWORD,
                        // The people of the test sign in at once: no mail server (MK-048).
                        "-Dmosaikit.accounts.confirm-email=false",
                        "-Dmosaikit.plugins.directory=" + installation.plugins(),
                        "-Dmosaikit.plugins.providers-directory=" + installation.providers(),
                        "-Dmosaikit.plugins.packages-directory=" + installation.packages(),
                        "-jar",
                        installation.kernelJar().toString())
                .directory(installation.home().toFile())
                .redirectErrorStream(true)
                .redirectOutput(log.toFile())
                .start();
        long deadline = System.nanoTime() + ACCEPTANCE.toNanos();
        while (System.nanoTime() < deadline) {
            if (!kernel.isAlive()) {
                // The next start overwrites the log: keep it in the output of the test.
                System.out.println("[kernel] stopped with exit code " + kernel.exitValue() + ":\n" + logOf(log));
                return false;
            }
            if (isReady()) {
                return true;
            }
            // Returns at once if the kernel stops, which the next iteration reports.
            kernel.waitFor(250, TimeUnit.MILLISECONDS);
        }
        throw new AssertionError("The kernel is not ready:\n" + logOf(log));
    }

    private boolean isReady() {
        try {
            HttpResponse<String> response = http.send(
                    HttpRequest.newBuilder(uri("/q/health/ready")).build(), HttpResponse.BodyHandlers.ofString());
            return response.statusCode() == 200;
        } catch (IOException _) {
            return false;
        } catch (InterruptedException _) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private void stopKernel() {
        if (kernel != null && kernel.isAlive()) {
            kernel.destroy();
            try {
                kernel.waitFor();
            } catch (InterruptedException _) {
                Thread.currentThread().interrupt();
            }
        }
    }

    // --- HTTP ----------------------------------------------------------------------------------

    private JsonNode plugin(String id) throws IOException, InterruptedException {
        for (JsonNode plugin : get("/api/v1/plugins")) {
            if (id.equals(plugin.path("id").asText())) {
                return plugin;
            }
        }
        throw new AssertionError("Plugin " + id + " not listed");
    }

    private static final String MEMBER_PASSWORD = "a long enough password";

    /** Creates an organization with self-registration and registers a person in it. */
    private String member(String slug) throws IOException, InterruptedException {
        HttpResponse<String> organization = send(HttpRequest.newBuilder(uri("/api/v1/organizations"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(
                        "{\"slug\":\"" + slug + "\",\"name\":\"" + slug + "\",\"selfRegistration\":true}")));
        assertThat(organization.statusCode()).as(organization.body()).isEqualTo(201);
        String email = "someone@" + slug + ".test";
        HttpResponse<String> registered = http.send(
                HttpRequest.newBuilder(uri("/api/v1/accounts/registrations"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString("{\"organization\":\"" + slug + "\",\"email\":\""
                                + email + "\",\"displayName\":\"Someone\",\"password\":\"" + MEMBER_PASSWORD + "\"}"))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(registered.statusCode()).as(registered.body()).isEqualTo(201);
        return email;
    }

    /** The actions of the plugin are tools for assistants, run with the credentials of the person (MK-015). */
    private void runsTheActionsOfThePluginAsTools(String ada, String bea) throws IOException, InterruptedException {
        HttpResponse<String> listed = send(
                HttpRequest.newBuilder(uri("/api/v1/ai/tools/sample-notes__list-notes/invocations"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString("{}")),
                ada,
                MEMBER_PASSWORD);
        assertThat(listed.statusCode()).as(listed.body()).isEqualTo(200);
        assertThat(json.readTree(listed.body()).path("result").path("body").findValuesAsText("text"))
                .containsExactly("Written by the plugin");
        HttpResponse<String> drafted = send(
                HttpRequest.newBuilder(uri("/api/v1/ai/tools/sample-notes__create-note/invocations"))
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString("{\"text\":\"Proposed by an assistant\"}")),
                ada,
                MEMBER_PASSWORD);
        assertThat(drafted.statusCode()).as(drafted.body()).isEqualTo(202);
        assertThat(notes(ada)).as("nothing changes before the confirmation").hasSize(1);
        String draft = json.readTree(drafted.body()).path("draft").path("id").asText();
        HttpResponse<String> confirmed = send(
                HttpRequest.newBuilder(uri("/api/v1/ai/drafts/" + draft + "/confirmation"))
                        .POST(HttpRequest.BodyPublishers.noBody()),
                ada,
                MEMBER_PASSWORD);
        assertThat(confirmed.statusCode()).as(confirmed.body()).isEqualTo(200);
        assertThat(json.readTree(confirmed.body()).path("result").path("status").asInt())
                .isEqualTo(201);
        assertThat(notes(ada)).containsExactly("Written by the plugin", "Proposed by an assistant");
        assertThat(notes(bea)).isEmpty();
    }

    private List<String> notes(String username) throws IOException, InterruptedException {
        HttpResponse<String> response =
                send(HttpRequest.newBuilder(uri("/api/v1/p/sample-notes/notes")).GET(), username, MEMBER_PASSWORD);
        assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
        return json.readTree(response.body()).findValuesAsText("text");
    }

    private JsonNode get(String path) throws IOException, InterruptedException {
        HttpResponse<String> response = send(HttpRequest.newBuilder(uri(path)).GET());
        assertThat(response.statusCode()).as(path + ": " + response.body()).isEqualTo(200);
        return json.readTree(response.body());
    }

    private HttpResponse<String> send(HttpRequest.Builder request) throws IOException, InterruptedException {
        return send(request, "admin", ADMIN_PASSWORD);
    }

    private HttpResponse<String> send(HttpRequest.Builder request, String username, String password)
            throws IOException, InterruptedException {
        String credentials = Base64.getEncoder().encodeToString((username + ":" + password).getBytes(UTF_8));
        return http.send(
                request.header("Authorization", "Basic " + credentials).build(), HttpResponse.BodyHandlers.ofString());
    }

    private URI uri(String path) {
        return URI.create("http://localhost:" + port + path);
    }

    // --- helpers -------------------------------------------------------------------------------

    private static void execute(String sql) {
        try (Connection connection = DriverManager.getConnection(serverUrl, jdbcUsername, jdbcPassword);
                Statement statement = connection.createStatement()) {
            statement.execute(sql);
        } catch (SQLException e) {
            throw new IllegalStateException("Cannot run '" + sql + "' on " + serverUrl, e);
        }
    }

    private static String java() {
        return Path.of(System.getProperty("java.home"), "bin", "java").toString();
    }

    private static int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    private static void copyRecursively(Path source, Path target) throws IOException {
        try (Stream<Path> paths = Files.walk(source)) {
            for (Path path : paths.toList()) {
                Path destination = target.resolve(source.relativize(path).toString());
                if (Files.isDirectory(path)) {
                    Files.createDirectories(destination);
                } else {
                    Files.copy(path, destination, StandardCopyOption.REPLACE_EXISTING);
                }
            }
        }
    }

    private static void deleteRecursively(Path directory) throws IOException {
        if (!Files.exists(directory)) {
            return;
        }
        try (Stream<Path> paths = Files.walk(directory)) {
            for (Path path : paths.sorted(
                            Comparator.comparingInt(Path::getNameCount).reversed())
                    .toList()) {
                Files.delete(path);
            }
        }
    }

    /** The log of the kernel, whatever the encoding of the console that wrote it. */
    private static String logOf(Path log) throws IOException {
        return new String(Files.readAllBytes(log), java.nio.charset.StandardCharsets.UTF_8);
    }
}

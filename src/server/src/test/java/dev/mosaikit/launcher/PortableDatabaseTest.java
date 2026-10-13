// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.launcher;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.io.Reader;
import java.io.UncheckedIOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;

/**
 * The PostgreSQL server of the portable distribution, with the PostgreSQL tools replaced by a
 * fake that does what they would do to the files. The real server is exercised by
 * PortableDistributionIT.
 */
@Tag("MK-016")
class PortableDatabaseTest {

    private static final boolean WINDOWS = System.getProperty("os.name").startsWith("Windows");

    @TempDir
    Path home;

    private Installation installation;
    private final ByteArrayOutputStream output = new ByteArrayOutputStream();
    private final List<List<String>> commands = new ArrayList<>();
    private final List<String> createdDatabases = new ArrayList<>();
    private int port;

    @BeforeEach
    void createInstallation() throws IOException {
        installation = new Installation(home);
        Files.createDirectories(installation.pgsql().resolve("bin"));
        Files.writeString(executable("pg_ctl"), "");
        port = freePort();
    }

    @Test
    void initializesTheClusterAtTheFirstStart() throws IOException {
        database(port).start();

        assertThat(commands).extracting(command -> command.get(1)).containsExactly("-D", "start");
        assertThat(commands.getFirst().getFirst())
                .isEqualTo(executable("initdb").toString());
        assertThat(commands.get(1)).contains("-p " + port);
        assertThat(createdDatabases).containsExactly("jdbc:postgresql://127.0.0.1:" + port + "/postgres mosaikit");
        assertThat(Files.readString(cluster().resolve("postgresql.conf")))
                .contains("listen_addresses = '127.0.0.1'")
                .contains("unix_socket_directories = ''");

        Properties secrets = read(installation.data().resolve("secrets.properties"));
        Properties config = read(installation.config().resolve(PortableDatabase.CONFIG_FILE));
        assertThat(config)
                .containsEntry("quarkus.datasource.jdbc.url", "jdbc:postgresql://127.0.0.1:" + port + "/mosaikit")
                .containsEntry("quarkus.datasource.username", PortableDatabase.USER)
                .containsEntry("quarkus.datasource.password", secrets.getProperty("password"))
                .containsEntry("mosaikit.bootstrap.admin-password", secrets.getProperty("admin-password"));
        assertThat(Files.readString(installation.data().resolve(PortableDatabase.ADMIN_PASSWORD_FILE)))
                .isEqualTo(secrets.getProperty("admin-password") + "\n");
        assertThat(output.toString(UTF_8)).contains("first start");
        try (var files = Files.list(installation.data())) {
            assertThat(files).noneMatch(file -> file.getFileName().toString().endsWith(".tmp"));
        }
    }

    @Test
    void onlyStartsTheServerAtTheNextStartsAndFollowsThePort() throws IOException {
        database(port).start();
        database(port).stop();
        commands.clear();
        createdDatabases.clear();
        int otherPort = freePort();

        database(otherPort).start();

        assertThat(commands).extracting(command -> command.get(1)).containsExactly("start");
        assertThat(createdDatabases).isEmpty();
        assertThat(read(installation.config().resolve(PortableDatabase.CONFIG_FILE)))
                .containsEntry("quarkus.datasource.jdbc.url", "jdbc:postgresql://127.0.0.1:" + otherPort + "/mosaikit");
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    void keepsTheClusterAndTheSecretsPrivate() throws IOException {
        database(port).start();
        Files.setPosixFilePermissions(cluster(), PosixFilePermissions.fromString("rwxr-xr-x"));
        database(port).stop();

        database(port).start();

        assertThat(PosixFilePermissions.toString(Files.getPosixFilePermissions(cluster())))
                .isEqualTo("rwx------");
        assertThat(PosixFilePermissions.toString(
                        Files.getPosixFilePermissions(installation.config().resolve(PortableDatabase.CONFIG_FILE))))
                .isEqualTo("rw-------");
    }

    @Test
    void refusesAPortInUse() throws IOException {
        try (ServerSocket busy = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            PortableDatabase database = database(busy.getLocalPort());

            assertThatThrownBy(database::start)
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("MOSAIKIT_DATABASE_PORT");
        }
    }

    @Test
    void stopsOnlyARunningServer() {
        database(port).stop();
        assertThat(commands).isEmpty();

        database(port).start();
        commands.clear();
        database(port).stop();

        assertThat(commands)
                .singleElement()
                .satisfies(command ->
                        assertThat(command).startsWith(executable("pg_ctl").toString(), "stop"));
    }

    @Test
    void doesNothingWithoutPostgreSql() throws IOException {
        Files.delete(executable("pg_ctl"));
        PortableDatabase database = database(port);

        database.start();
        database.stop();

        assertThat(database.isPortable()).isFalse();
        assertThat(commands).isEmpty();
        assertThat(installation.data()).doesNotExist();
    }

    @Test
    void generatesDifferentSecretsOfSafeCharacters() {
        String first = PortableDatabase.randomSecret();

        assertThat(first).hasSize(24).matches("[a-zA-Z2-9]+").doesNotContain("l", "I", "O", "0", "1");
        assertThat(PortableDatabase.randomSecret()).isNotEqualTo(first);
    }

    @Test
    void knowsWhetherAPortIsFree() throws IOException {
        try (ServerSocket busy = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            assertThat(PortableDatabase.isFree(busy.getLocalPort())).isFalse();
        }
        assertThat(PortableDatabase.isFree(port)).isTrue();
    }

    @Test
    @DisabledOnOs(OS.WINDOWS)
    void runsTheToolsAsProcessesAndReportsTheirFailures() throws IOException {
        Files.createDirectories(installation.data());
        PortableDatabase.Tools tools = PortableDatabase.processes(installation);

        tools.run(List.of("sh", "-c", "echo tool output"), "say something");
        List<String> failing = List.of("sh", "-c", "exit 3");
        List<String> missing = List.of(home.resolve("missing").toString());
        assertThatThrownBy(() -> tools.run(failing, "fail"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Cannot fail (exit code 3)");
        assertThatThrownBy(() -> tools.run(missing, "run nothing"))
                .isInstanceOf(UncheckedIOException.class)
                .hasMessage("Cannot run nothing");
        assertThat(Files.readString(installation.data().resolve("postgresql-tools.log")))
                .contains("tool output");
    }

    private PortableDatabase database(int databasePort) {
        return new PortableDatabase(
                installation,
                new PrintStream(output, true, UTF_8),
                databasePort,
                this::fakeTool,
                (url, user, password) -> {
                    assertThat(password).hasSize(24);
                    createdDatabases.add(url + " " + user);
                });
    }

    /** Does to the files what initdb and pg_ctl would do. */
    private void fakeTool(List<String> command, String purpose) {
        commands.add(command);
        try {
            if (command.getFirst().equals(executable("initdb").toString())) {
                assertThat(command).anySatisfy(argument -> assertThat(argument).startsWith("--pwfile="));
                Files.createDirectories(cluster());
                Files.writeString(cluster().resolve("PG_VERSION"), "18\n");
                Files.writeString(cluster().resolve("postgresql.conf"), "# initdb\n");
            } else if (command.get(1).equals("start")) {
                Files.writeString(cluster().resolve("postmaster.pid"), "1\n");
            } else if (command.get(1).equals("stop")) {
                Files.delete(cluster().resolve("postmaster.pid"));
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private Path cluster() {
        return installation.data().resolve("postgresql");
    }

    private Path executable(String name) {
        return installation.pgsql().resolve("bin").resolve(WINDOWS ? name + ".exe" : name);
    }

    private static Properties read(Path file) throws IOException {
        Properties properties = new Properties();
        try (Reader reader = Files.newBufferedReader(file, UTF_8)) {
            properties.load(reader);
        }
        return properties;
    }

    private static int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            return socket.getLocalPort();
        }
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.testing;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.ServerSocket;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

/**
 * A PostgreSQL 18 server for the tests, from the binaries that npm installs with the build
 * ({@code node_modules/@embedded-postgres/<platform>/native}, the same as the portable
 * distribution): no Docker, nothing to start by hand. The cluster lives in a temporary directory,
 * listens on a free port of 127.0.0.1 and trusts local connections; {@link #close()} stops and
 * deletes it.
 */
public final class EmbeddedPostgres implements AutoCloseable {

    public static final String USER = "mosaikit";
    public static final String PASSWORD = "mosaikit";

    private static final boolean WINDOWS =
            System.getProperty("os.name").toLowerCase(Locale.ROOT).contains("win");

    private final Path binaries;
    private final Path directory;
    private final int port;

    private EmbeddedPostgres(Path binaries, Path directory, int port) {
        this.binaries = binaries;
        this.directory = directory;
        this.port = port;
    }

    /** Initializes and starts a new server. */
    public static EmbeddedPostgres start() {
        Path binaries = binaries();
        try {
            Path directory = Files.createTempDirectory("mosaikit-pg-");
            EmbeddedPostgres server = new EmbeddedPostgres(binaries, directory, freePort());
            server.initialize();
            server.run(
                    "start the test database",
                    "pg_ctl",
                    "start",
                    "-D",
                    server.cluster().toString(),
                    "-l",
                    directory.resolve("postgresql.log").toString(),
                    "-w",
                    "-t",
                    "60",
                    "-o",
                    "-p " + server.port);
            return server;
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot start the test database", e);
        }
    }

    /** The URL of a database of this server. */
    public String jdbcUrl(String database) {
        return "jdbc:postgresql://127.0.0.1:" + port + "/" + database;
    }

    public int port() {
        return port;
    }

    /** Creates a database. */
    public String createDatabase(String name) {
        try (Connection connection = DriverManager.getConnection(jdbcUrl("postgres"), USER, PASSWORD);
                Statement statement = connection.createStatement()) {
            statement.execute("create database " + name);
            return jdbcUrl(name);
        } catch (SQLException e) {
            throw new IllegalStateException("Cannot create the test database " + name, e);
        }
    }

    @Override
    public void close() {
        try {
            run("stop the test database", "pg_ctl", "stop", "-D", cluster().toString(), "-m", "immediate", "-w");
        } finally {
            try (Stream<Path> paths = Files.walk(directory)) {
                paths.sorted(Comparator.reverseOrder())
                        .forEach(path -> path.toFile().delete());
            } catch (IOException _) {
                // A temporary directory: the system cleans it eventually.
            }
        }
    }

    private Path cluster() {
        return directory.resolve("data");
    }

    private void initialize() throws IOException {
        Path passwordFile = directory.resolve("password");
        Files.writeString(passwordFile, PASSWORD + "\n", UTF_8);
        run(
                "initialize the test database",
                "initdb",
                "-D",
                cluster().toString(),
                "-U",
                USER,
                "--pwfile=" + passwordFile,
                "-A",
                "trust",
                "-E",
                "UTF8",
                "--locale=C",
                "--no-instructions");
        Files.writeString(cluster().resolve("postgresql.conf"), """

                # Test database: local connections only, small footprint, no durability.
                listen_addresses = '127.0.0.1'
                unix_socket_directories = ''
                shared_buffers = 32MB
                max_connections = 100
                fsync = off
                synchronous_commit = off
                full_page_writes = off
                """, UTF_8, StandardOpenOption.APPEND);
    }

    private void run(String purpose, String tool, String... arguments) {
        List<String> command = new ArrayList<>();
        command.add(
                binaries.resolve("bin").resolve(WINDOWS ? tool + ".exe" : tool).toString());
        command.addAll(List.of(arguments));
        try {
            Process process = new ProcessBuilder(command)
                    .redirectErrorStream(true)
                    .redirectOutput(directory.resolve(tool + ".log").toFile())
                    .start();
            if (!process.waitFor(120, TimeUnit.SECONDS) || process.exitValue() != 0) {
                process.destroyForcibly();
                throw new IllegalStateException(
                        "Cannot " + purpose + ": " + Files.readString(directory.resolve(tool + ".log")));
            }
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot " + purpose, e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while trying to " + purpose, e);
        }
    }

    /**
     * The binaries for this machine: {@code test.postgres} if set, otherwise those of
     * {@code node_modules} at the root of the repository ({@code test.root}).
     */
    static Path binaries() {
        String configured = System.getProperty("test.postgres");
        if (configured != null && !configured.isBlank()) {
            return Path.of(configured);
        }
        Path root = Path.of(System.getProperty("test.root", ".."));
        Path installed = root.resolve("node_modules/@embedded-postgres")
                .resolve(platform())
                .resolve("native");
        if (!Files.isDirectory(installed.resolve("bin"))) {
            throw new IllegalStateException("No PostgreSQL binaries in " + installed.toAbsolutePath()
                    + ": run npm ci at the root of the repository");
        }
        return installed;
    }

    static String platform() {
        String os = System.getProperty("os.name").toLowerCase(Locale.ROOT);
        String arch = System.getProperty("os.arch").toLowerCase(Locale.ROOT);
        String cpu = arch.contains("aarch64") || arch.contains("arm64") ? "arm64" : "x64";
        if (os.contains("win")) {
            return "windows-" + cpu;
        }
        return (os.contains("mac") ? "darwin-" : "linux-") + cpu;
    }

    private static int freePort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }
}

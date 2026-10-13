// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.launcher;

import java.io.IOException;
import java.io.PrintStream;
import java.io.UncheckedIOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;

/**
 * The PostgreSQL server of the portable distribution (MK-016), started by the launcher before the
 * kernel and stopped after it. The cluster lives in {@code data/postgresql}, listens on
 * 127.0.0.1 only, and its password and the first administrator password are generated at the
 * first start and written to {@code config/database.properties}, which the scripts pass to the
 * kernel.
 *
 * <p>Installations without {@code pgsql/} (containers, servers) use their own database and this
 * class does nothing.
 */
final class PortableDatabase {

    /** Default port; {@code MOSAIKIT_DATABASE_PORT} changes it. */
    static final int DEFAULT_PORT = 54329;

    static final String USER = "mosaikit";
    static final String DATABASE = "mosaikit";
    static final String CONFIG_FILE = "database.properties";
    static final String ADMIN_PASSWORD_FILE = "initial-admin-password.txt";

    private static final boolean WINDOWS =
            FileSystems.getDefault().getSeparator().equals("\\");
    private static final String PG_CTL = "pg_ctl";
    private static final String PASSWORD = "password";
    private static final String ADMIN_PASSWORD = "admin-password";
    private static final String READABLE_CHARACTERS = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    /** Runs a PostgreSQL tool; the default one starts a process. */
    @FunctionalInterface
    interface Tools {
        /**
         * @param command the executable and its arguments
         * @param purpose what the command does, for the error message
         */
        void run(List<String> command, String purpose);
    }

    /** Creates the database of the kernel in the running server; the default one uses JDBC. */
    @FunctionalInterface
    interface DatabaseCreator {
        void create(String url, String user, String password);
    }

    private final Installation installation;
    private final PrintStream out;
    private final int port;
    private final Tools tools;
    private final DatabaseCreator creator;

    PortableDatabase(Installation installation, PrintStream out, int port) {
        this(installation, out, port, processes(installation), PortableDatabase::createWithJdbc);
    }

    PortableDatabase(Installation installation, PrintStream out, int port, Tools tools, DatabaseCreator creator) {
        this.installation = installation;
        this.out = out;
        this.port = port;
        this.tools = tools;
        this.creator = creator;
    }

    boolean isPortable() {
        return Files.isRegularFile(executable(PG_CTL));
    }

    Path cluster() {
        return installation.data().resolve("postgresql");
    }

    /** Initializes the cluster at the first start, then starts the server and waits for it. */
    void start() {
        if (!isPortable()) {
            return;
        }
        boolean firstStart = !Files.isRegularFile(cluster().resolve("PG_VERSION"));
        if (firstStart) {
            initialize();
        }
        restrictPermissions();
        if (!isFree(port)) {
            throw new IllegalStateException("Port " + port + " of the database is in use; set MOSAIKIT_DATABASE_PORT"
                    + " to another port, or stop the other program");
        }
        tools.run(
                List.of(
                        executable(PG_CTL).toString(),
                        "start",
                        "-D",
                        cluster().toString(),
                        "-l",
                        installation.data().resolve("postgresql.log").toString(),
                        "-w",
                        "-t",
                        "60",
                        "-o",
                        "-p " + port),
                "start the database");
        if (firstStart) {
            createDatabase();
            out.println("Mosaikit: first start. Sign in as \"admin\" with the password in data/" + ADMIN_PASSWORD_FILE
                    + "; delete that file once you have changed it.");
        }
        writeConfig();
    }

    /**
     * PostgreSQL refuses a cluster that other users can read. A backup copied back without its
     * permissions (for example with {@code cp -r}) would not start, so they are restored first.
     */
    private void restrictPermissions() {
        if (WINDOWS) {
            return;
        }
        try {
            Files.setPosixFilePermissions(cluster(), PosixFilePermissions.fromString("rwx------"));
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot restrict the permissions of " + cluster(), e);
        }
    }

    /** Stops the server if it runs. */
    void stop() {
        if (!isPortable() || !Files.exists(cluster().resolve("postmaster.pid"))) {
            return;
        }
        tools.run(
                List.of(
                        executable(PG_CTL).toString(),
                        "stop",
                        "-D",
                        cluster().toString(),
                        "-m",
                        "fast",
                        "-w",
                        "-t",
                        "60"),
                "stop the database");
    }

    private void initialize() {
        try {
            Files.createDirectories(installation.data());
            String password = randomSecret();
            Path passwordFile = Files.createTempFile(installation.data(), "pw", ".tmp");
            try {
                Files.writeString(passwordFile, password + "\n", StandardCharsets.UTF_8);
                tools.run(
                        List.of(
                                executable("initdb").toString(),
                                "-D",
                                cluster().toString(),
                                "-U",
                                USER,
                                "--pwfile=" + passwordFile,
                                "-A",
                                "scram-sha-256",
                                "-E",
                                "UTF8",
                                "--locale=C",
                                "--no-instructions"),
                        "initialize the database");
            } finally {
                Files.deleteIfExists(passwordFile);
            }
            Files.writeString(
                    cluster().resolve("postgresql.conf"),
                    """

                    # Mosaikit portable: local connections only, small footprint.
                    listen_addresses = '127.0.0.1'
                    unix_socket_directories = ''
                    shared_buffers = 64MB
                    max_connections = 30
                    """,
                    StandardCharsets.UTF_8,
                    java.nio.file.StandardOpenOption.APPEND);
            Properties secrets = new Properties();
            secrets.setProperty(PASSWORD, password);
            secrets.setProperty(ADMIN_PASSWORD, randomSecret());
            writePrivate(
                    installation.data().resolve("secrets.properties"),
                    secrets,
                    "Generated at the first start. Keep private.");
            Files.writeString(
                    installation.data().resolve(ADMIN_PASSWORD_FILE), secrets.getProperty(ADMIN_PASSWORD) + "\n");
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot initialize the database in " + cluster(), e);
        }
    }

    private void createDatabase() {
        creator.create(url("postgres"), USER, secrets().getProperty(PASSWORD));
    }

    private static void createWithJdbc(String url, String user, String password) {
        try (Connection connection = DriverManager.getConnection(url, user, password);
                Statement statement = connection.createStatement()) {
            statement.execute("create database " + DATABASE);
        } catch (SQLException e) {
            throw new IllegalStateException("Cannot create the database: " + e.getMessage(), e);
        }
    }

    /** The settings the kernel needs to reach this server, rewritten at each start (the port may change). */
    private void writeConfig() {
        Properties secrets = secrets();
        Properties config = new Properties();
        config.setProperty("quarkus.datasource.jdbc.url", url(DATABASE));
        config.setProperty("quarkus.datasource.username", USER);
        config.setProperty("quarkus.datasource.password", secrets.getProperty(PASSWORD));
        config.setProperty("mosaikit.bootstrap.admin-password", secrets.getProperty(ADMIN_PASSWORD));
        writePrivate(
                installation.config().resolve(CONFIG_FILE),
                config,
                "Written by the mosaikit launcher at each start. Do not edit.");
    }

    private Properties secrets() {
        Properties secrets = new Properties();
        try (var in = Files.newBufferedReader(installation.data().resolve("secrets.properties"))) {
            secrets.load(in);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read data/secrets.properties", e);
        }
        return secrets;
    }

    private String url(String database) {
        return "jdbc:postgresql://127.0.0.1:" + port + "/" + database;
    }

    private Path executable(String name) {
        return installation.pgsql().resolve("bin").resolve(WINDOWS ? name + ".exe" : name);
    }

    /** Runs the tools as processes in the installation, with their output in data/postgresql-tools.log. */
    static Tools processes(Installation installation) {
        return (command, purpose) -> {
            try {
                Process process = new ProcessBuilder(new ArrayList<>(command))
                        .directory(installation.home().toFile())
                        .redirectErrorStream(true)
                        .redirectOutput(ProcessBuilder.Redirect.appendTo(installation
                                .data()
                                .resolve("postgresql-tools.log")
                                .toFile()))
                        .start();
                int exitCode = process.waitFor();
                if (exitCode != 0) {
                    throw new IllegalStateException("Cannot " + purpose + " (exit code " + exitCode
                            + "); see data/postgresql-tools.log and data/postgresql.log");
                }
            } catch (IOException e) {
                throw new UncheckedIOException("Cannot " + purpose, e);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("Interrupted while trying to " + purpose, e);
            }
        };
    }

    private static void writePrivate(Path file, Properties properties, String comment) {
        try {
            Files.createDirectories(file.getParent());
            if (!WINDOWS && !Files.exists(file)) {
                Files.createFile(
                        file, PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")));
            }
            try (var writer = Files.newBufferedWriter(file, StandardCharsets.UTF_8)) {
                properties.store(writer, comment);
            }
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot write " + file, e);
        }
    }

    static boolean isFree(int port) {
        // Only probes whether the loopback port is free: no connection is accepted, nothing is sent.
        // nosemgrep: java.lang.security.audit.crypto.unencrypted-socket.unencrypted-socket
        try (var _ = new ServerSocket(port, 1, InetAddress.getLoopbackAddress())) {
            return true;
        } catch (IOException _) {
            return false;
        }
    }

    static String randomSecret() {
        StringBuilder secret = new StringBuilder();
        for (int i = 0; i < 24; i++) {
            secret.append(READABLE_CHARACTERS.charAt(RANDOM.nextInt(READABLE_CHARACTERS.length())));
        }
        return secret.toString();
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.launcher;

import dev.mosaikit.kernel.api.version.Version;
import dev.mosaikit.kernel.core.plugin.BackendCheck;
import dev.mosaikit.kernel.core.plugin.InstalledPlugin;
import dev.mosaikit.kernel.core.plugin.PackageTrust;
import dev.mosaikit.kernel.core.plugin.PluginCatalog;
import dev.mosaikit.kernel.core.plugin.ProviderState;
import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.function.UnaryOperator;
import java.util.stream.Collectors;

/**
 * Prepares an installation before the kernel starts.
 *
 * <ul>
 *   <li>{@code prepare <home>} before a start: reads the plugins with the same catalog as the
 *       kernel, copies the JARs of the Java plugins that can run into the providers directory and
 *       rebuilds the kernel (Quarkus re-augmentation) only when that set changed. The new JARs
 *       stay pending until the kernel has started with them.
 *   <li>{@code build <home>} while building a container image: the same, without the pending
 *       state, because the image is not started now; a broken image is rolled back by deploying
 *       the previous one.
 * </ul>
 *
 * <p>A plugin that breaks the kernel is rolled back automatically: if the rebuild fails, the
 * previous build is restored at once; if the kernel does not start with the new JARs, the next
 * {@code prepare} restores it. Rolled back JARs are rejected until a different version is
 * installed. The scripts in {@code bin/} run the launcher, then the kernel, and retry once after
 * a failed start.
 */
public final class Launcher {

    private final PrintStream out;
    private final KernelBuilder builder;
    private final PackageTrust trust;

    Launcher(PrintStream out, KernelBuilder builder) {
        this(out, builder, PackageTrust.none());
    }

    Launcher(PrintStream out, KernelBuilder builder, PackageTrust trust) {
        this.out = out;
        this.builder = builder;
        this.trust = trust;
    }

    /** Rebuilds the kernel of an installation. */
    @FunctionalInterface
    interface KernelBuilder {
        /** @return the exit code of the rebuild, 0 on success */
        int rebuild(Installation installation);
    }

    // A command-line tool run by the scripts: its messages are for the console, not for a log.
    @SuppressWarnings("java:S106")
    public static void main(String[] args) {
        System.exit(run(args, System.out, System.err, System::getenv));
    }

    /**
     * @param environment the environment variables, {@code System::getenv} outside tests
     * @return the exit code of the launcher
     */
    static int run(String[] args, PrintStream out, PrintStream err, UnaryOperator<String> environment) {
        if (args.length == 3
                && "database".equals(args[0])
                && List.of("start", "stop").contains(args[1])) {
            return database(args[1], new Installation(Path.of(args[2])), out, err, environment);
        }
        if (args.length != 2 || !List.of("prepare", "build").contains(args[0])) {
            err.println("usage: Launcher prepare|build <installation directory>");
            err.println("       Launcher database start|stop <installation directory>");
            return 2;
        }
        Installation installation = new Installation(Path.of(args[1]));
        if (!Files.isRegularFile(installation.kernelJar())) {
            err.println("Mosaikit: no kernel in " + installation.kernel());
            return 1;
        }
        try {
            return new Launcher(out, Launcher::reaugment, trust(installation, environment))
                    .prepare(installation, version(), "prepare".equals(args[0]));
        } catch (RuntimeException e) {
            err.println("Mosaikit: " + e.getMessage());
            return 1;
        }
    }

    /** Starts or stops the PostgreSQL server of a portable installation; does nothing elsewhere. */
    private static int database(
            String action,
            Installation installation,
            PrintStream out,
            PrintStream err,
            UnaryOperator<String> environment) {
        String configuredPort = environment.apply("MOSAIKIT_DATABASE_PORT");
        try {
            int port = configuredPort == null || configuredPort.isBlank()
                    ? PortableDatabase.DEFAULT_PORT
                    : Integer.parseInt(configuredPort.strip());
            PortableDatabase database = new PortableDatabase(installation, out, port);
            if ("start".equals(action)) {
                database.start();
            } else {
                database.stop();
            }
            return 0;
        } catch (NumberFormatException _) {
            err.println("Mosaikit: MOSAIKIT_DATABASE_PORT is not a port number: " + configuredPort);
            return 2;
        } catch (RuntimeException e) {
            err.println("Mosaikit: " + e.getMessage());
            return 1;
        }
    }

    /**
     * @param probation {@code true} when the kernel starts next and must confirm the new JARs
     * @return 0 when the kernel can start, otherwise the exit code of a rebuild that could not be
     *     rolled back
     */
    int prepare(Installation installation, Version kernelVersion, boolean probation) {
        Path providers = installation.providers();
        KernelSnapshot snapshot = new KernelSnapshot(installation);
        ProviderState rejected = ProviderState.read(providers, ProviderState.REJECTED_FILE);
        ProviderState pending = ProviderState.read(providers, ProviderState.PENDING_FILE);
        if (!pending.isEmpty()) {
            rejected = rejected.with(pending);
            rollBack(snapshot, providers, rejected, "the kernel did not start with " + describe(pending));
        }

        List<InstalledPlugin> plugins = new PluginCatalog(kernelVersion, BackendCheck.available(rejected), trust)
                .scan(installation.plugins(), installation.packages());
        ProviderSync sync = new ProviderSync(providers);
        ProviderSync.Plan plan = sync.plan(plugins);
        if (plan.upToDate()) {
            out.printf(
                    "Mosaikit: %d Java plugin(s), kernel up to date.%n",
                    plan.sources().size());
            return 0;
        }

        out.printf(
                "Mosaikit: Java plugins changed (%s), rebuilding the kernel...%n", String.join(", ", plan.changes()));
        long start = System.nanoTime();
        snapshot.save();
        sync.apply(plan);
        int exitCode = builder.rebuild(installation);
        if (exitCode != 0) {
            if (plan.added().isEmpty()) {
                snapshot.restore();
                out.printf(
                        "Mosaikit: the rebuild failed with exit code %d; the previous build is restored.%n", exitCode);
                return exitCode;
            }
            rollBack(
                    snapshot,
                    providers,
                    rejected.with(plan.added()),
                    "the kernel could not be rebuilt with " + describe(plan.added()) + " (exit code " + exitCode + ")");
            return 0;
        }
        if (probation) {
            sync.commit(plan);
        } else {
            plan.desired().write(providers);
            ProviderState.clear(providers, ProviderState.PENDING_FILE);
        }
        Duration elapsed = Duration.ofNanos(System.nanoTime() - start);
        out.printf(Locale.ROOT, "Mosaikit: kernel rebuilt in %.1f s.%n", elapsed.toMillis() / 1000.0);
        return 0;
    }

    private void rollBack(KernelSnapshot snapshot, Path providers, ProviderState rejected, String reason) {
        if (!snapshot.exists()) {
            throw new IllegalStateException(reason + ", and there is no previous build to restore");
        }
        snapshot.restore();
        ProviderState.clear(providers, ProviderState.PENDING_FILE);
        rejected.write(providers, ProviderState.REJECTED_FILE);
        out.printf(
                "Mosaikit: %s. Rolled back to the previous plugins; the plugin(s) stay disabled until a"
                        + " different version is installed.%n",
                reason);
    }

    private static String describe(ProviderState state) {
        return state.entries().stream().map(ProviderState.Entry::pluginId).collect(Collectors.joining(", "));
    }

    /** Runs the Quarkus re-augmentation of the mutable JAR, which exits once the kernel is rebuilt. */
    static int reaugment(Installation installation) {
        try {
            return rebuildProcess(installation).inheritIO().start().waitFor();
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot run the rebuild", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while rebuilding the kernel", e);
        }
    }

    /**
     * The re-augmentation, without the settings of the installation: Quarkus records every value it
     * sees while building as a default of the rebuilt kernel, so a password in {@code
     * config/application.properties} or in the environment would end up in its JARs, and a setting
     * removed later would still apply. The rebuild therefore runs in the kernel directory, where there
     * is no {@code config/}, and without the {@code QUARKUS_*} and {@code MOSAIKIT_*} variables; the
     * kernel reads the settings when it starts.
     */
    static ProcessBuilder rebuildProcess(Installation installation) {
        String java = Path.of(System.getProperty("java.home"), "bin", "java").toString();
        var builder = new ProcessBuilder(
                        java,
                        "-Dquarkus.launch.rebuild=true",
                        "-jar",
                        installation.kernelJar().toString())
                .directory(installation.kernel().toFile());
        builder.environment().keySet().removeIf(Launcher::isSetting);
        return builder;
    }

    private static boolean isSetting(String variable) {
        String name = variable.toUpperCase(Locale.ROOT);
        return name.startsWith("QUARKUS_") || name.startsWith("MOSAIKIT_");
    }

    /**
     * The trust of the installation, read like the kernel reads it: {@code
     * mosaikit.plugins.signatures} and {@code mosaikit.plugins.trusted-keys-directory} from the
     * environment ({@code MOSAIKIT_PLUGINS_SIGNATURES}, {@code MOSAIKIT_PLUGINS_TRUSTED_KEYS_DIRECTORY})
     * or from {@code config/application.properties}, relative to the installation.
     */
    static PackageTrust trust(Installation installation, UnaryOperator<String> environment) {
        Properties properties = new Properties();
        Path file = installation.config().resolve("application.properties");
        if (Files.isRegularFile(file)) {
            try (var reader = Files.newBufferedReader(file)) {
                properties.load(reader);
            } catch (IOException e) {
                throw new UncheckedIOException("Cannot read " + file, e);
            }
        }
        String signatures = setting(environment, properties, "mosaikit.plugins.signatures", "optional");
        String directory =
                setting(environment, properties, "mosaikit.plugins.trusted-keys-directory", "config/trusted-keys");
        return PackageTrust.read(installation.home().resolve(directory), signatures);
    }

    private static String setting(
            UnaryOperator<String> environment, Properties properties, String name, String defaultValue) {
        String variable = name.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "_");
        String value = environment.apply(variable);
        if (value == null || value.isBlank()) {
            value = properties.getProperty(name);
        }
        return value == null || value.isBlank() ? defaultValue : value.strip();
    }

    static Version version() {
        try (InputStream in = Launcher.class.getResourceAsStream("launcher.properties")) {
            Properties properties = new Properties();
            properties.load(in);
            return Version.parse(properties.getProperty("version"));
        } catch (IOException | RuntimeException e) {
            throw new IllegalStateException("The launcher does not know its version", e);
        }
    }
}

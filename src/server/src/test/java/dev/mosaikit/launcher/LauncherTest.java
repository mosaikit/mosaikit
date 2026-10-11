// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.launcher;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.api.signature.SigningKeys;
import dev.mosaikit.kernel.api.version.Version;
import dev.mosaikit.kernel.core.plugin.PackageTrust;
import dev.mosaikit.kernel.core.plugin.ProviderState;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.UnaryOperator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

@Tag("MK-011")
class LauncherTest {

    private static final Version KERNEL = Version.parse("0.1.0-SNAPSHOT");

    @TempDir
    Path home;

    private Installation installation;
    private final ByteArrayOutputStream output = new ByteArrayOutputStream();
    private final AtomicInteger rebuilds = new AtomicInteger();
    private int rebuildExitCode;

    @BeforeEach
    void createInstallation() throws IOException {
        installation = new Installation(home);
        Files.createDirectories(installation.providers());
        Files.createDirectories(installation.kernel().resolve("quarkus"));
        Files.writeString(installation.kernel().resolve("quarkus/generated-bytecode.jar"), "build 0");
        Files.writeString(installation.kernelJar(), "kernel");
        Files.createDirectories(installation.plugins());
    }

    /** Stands for the Quarkus re-augmentation: records which build it produced. */
    private int prepare(boolean probation) {
        var launcher = new Launcher(new PrintStream(output, true, UTF_8), ignored -> {
            int build = rebuilds.incrementAndGet();
            if (rebuildExitCode == 0) {
                try {
                    Files.writeString(
                            installation.kernel().resolve("quarkus/generated-bytecode.jar"), "build " + build);
                } catch (IOException e) {
                    throw new IllegalStateException(e);
                }
            }
            return rebuildExitCode;
        });
        return launcher.prepare(installation, KERNEL, probation);
    }

    private int prepare() {
        return prepare(true);
    }

    /** What the kernel does once it has started. */
    private void kernelStarted() throws IOException {
        Files.deleteIfExists(installation.providers().resolve(ProviderState.PENDING_FILE));
    }

    private String build() throws IOException {
        return Files.readString(installation.kernel().resolve("quarkus/generated-bytecode.jar"));
    }

    private ProviderState state(String file) {
        return ProviderState.read(installation.providers(), file);
    }

    private void installJavaPlugin(String directory, String id, String code) throws IOException {
        Path lib = Files.createDirectories(
                installation.plugins().resolve(directory).resolve("lib"));
        Files.writeString(lib.getParent().resolve("manifest.yaml"), """
                id: %s
                version: 1.0.0
                name: Test
                kind: [service]
                platform: ">=0.1"
                backend:
                  jar: lib/code.jar
                  api: %s
                """.formatted(id, directory));
        Files.writeString(lib.resolve("code.jar"), code);
    }

    @Test
    void doesNotRebuildAnInstallationWithoutJavaPlugins() {
        assertThat(prepare()).isZero();

        assertThat(rebuilds).hasValue(0);
        assertThat(output.toString(UTF_8)).contains("0 Java plugin(s), kernel up to date");
    }

    @Test
    void rebuildsOnceWhenAPluginIsAddedThenStaysUpToDate() throws IOException {
        installJavaPlugin("notes", "dev.example.notes", "v1");

        assertThat(prepare()).isZero();
        kernelStarted();
        assertThat(prepare()).isZero();

        assertThat(rebuilds).hasValue(1);
        assertThat(installation.providers().resolve("dev.example.notes.jar")).hasContent("v1");
        assertThat(state(ProviderState.FILE_NAME).entries())
                .singleElement()
                .satisfies(entry -> assertThat(entry.pluginId()).isEqualTo("dev.example.notes"));
        assertThat(output.toString(UTF_8)).contains("added dev.example.notes").contains("kernel up to date");
    }

    @Test
    void keepsNewJarsPendingUntilTheKernelHasStarted() throws IOException {
        installJavaPlugin("notes", "dev.example.notes", "v1");

        prepare();

        assertThat(state(ProviderState.PENDING_FILE).entries()).hasSize(1);
        kernelStarted();
        assertThat(state(ProviderState.PENDING_FILE).isEmpty()).isTrue();
    }

    @Test
    void rebuildsWhenAPluginIsUpdatedOrRemoved() throws IOException {
        installJavaPlugin("notes", "dev.example.notes", "v1");
        prepare();
        kernelStarted();

        installJavaPlugin("notes", "dev.example.notes", "v2");
        prepare();
        kernelStarted();
        assertThat(output.toString(UTF_8)).contains("updated dev.example.notes");
        assertThat(installation.providers().resolve("dev.example.notes.jar")).hasContent("v2");

        Files.writeString(installation.plugins().resolve("notes/manifest.yaml"), "id: Broken\n");
        prepare();
        assertThat(output.toString(UTF_8)).contains("removed dev.example.notes");
        assertThat(installation.providers().resolve("dev.example.notes.jar")).doesNotExist();
        assertThat(rebuilds).hasValue(3);
    }

    @Test
    void rebuildsAgainWhenSomeoneChangedTheProvidersDirectory() throws IOException {
        installJavaPlugin("notes", "dev.example.notes", "v1");
        prepare();
        kernelStarted();

        Files.writeString(installation.providers().resolve("dev.example.notes.jar"), "tampered");
        prepare();

        assertThat(rebuilds).hasValue(2);
        assertThat(installation.providers().resolve("dev.example.notes.jar")).hasContent("v1");
    }

    @Test
    void restoresThePreviousBuildWhenTheRebuildFails() throws IOException {
        installJavaPlugin("notes", "dev.example.notes", "v1");
        prepare();
        kernelStarted();
        installJavaPlugin("board", "dev.example.board", "broken");
        rebuildExitCode = 3;

        assertThat(prepare()).as("the previous kernel can start").isZero();

        assertThat(build()).isEqualTo("build 1");
        assertThat(state(ProviderState.FILE_NAME).contains("dev.example.notes", ProviderState.sha256(jar("notes"))))
                .isTrue();
        assertThat(state(ProviderState.REJECTED_FILE).entries())
                .singleElement()
                .satisfies(entry -> assertThat(entry.pluginId()).isEqualTo("dev.example.board"));
        assertThat(installation.providers().resolve("dev.example.board.jar")).doesNotExist();
        assertThat(output.toString(UTF_8)).contains("could not be rebuilt with dev.example.board");
    }

    @Test
    void rollsBackWhenTheKernelDidNotStartWithTheNewJars() throws IOException {
        installJavaPlugin("notes", "dev.example.notes", "v1");
        prepare();
        kernelStarted();
        installJavaPlugin("board", "dev.example.board", "fails at start");
        prepare();
        assertThat(build()).isEqualTo("build 2");

        // The kernel stopped before confirming; the next start rolls back without rebuilding.
        assertThat(prepare()).isZero();

        assertThat(rebuilds).hasValue(2);
        assertThat(build()).isEqualTo("build 1");
        assertThat(state(ProviderState.PENDING_FILE).isEmpty()).isTrue();
        assertThat(state(ProviderState.REJECTED_FILE).contains("dev.example.board", ProviderState.sha256(jar("board"))))
                .isTrue();
        assertThat(output.toString(UTF_8))
                .contains("did not start with dev.example.board")
                .contains("1 Java plugin(s), kernel up to date");
    }

    @Test
    void acceptsAFixedVersionOfARejectedPlugin() throws IOException {
        installJavaPlugin("board", "dev.example.board", "broken");
        rebuildExitCode = 1;
        prepare();

        rebuildExitCode = 0;
        installJavaPlugin("board", "dev.example.board", "fixed");
        prepare();

        assertThat(installation.providers().resolve("dev.example.board.jar")).hasContent("fixed");
        assertThat(state(ProviderState.FILE_NAME).entries()).hasSize(1);
    }

    @Test
    void leavesNothingPendingWhenBuildingAnImage() throws IOException {
        installJavaPlugin("notes", "dev.example.notes", "v1");

        assertThat(prepare(false)).isZero();

        assertThat(state(ProviderState.FILE_NAME).entries()).hasSize(1);
        assertThat(state(ProviderState.PENDING_FILE).isEmpty()).isTrue();
    }

    @Test
    void refusesToRunWithoutArgumentsOrKernel() {
        var err = new ByteArrayOutputStream();

        assertThat(run(err, NO_ENVIRONMENT)).isEqualTo(2);
        assertThat(run(err, NO_ENVIRONMENT, "prepare", home.resolve("missing").toString()))
                .isEqualTo(1);
        assertThat(err.toString(UTF_8)).contains("usage").contains("no kernel");
    }

    @Test
    void preparesAndBuildsFromTheCommandLine() {
        var err = new ByteArrayOutputStream();

        assertThat(run(err, NO_ENVIRONMENT, "prepare", home.toString())).isZero();
        assertThat(run(err, NO_ENVIRONMENT, "build", home.toString())).isZero();
        assertThat(err.toString(UTF_8)).isEmpty();
    }

    @Test
    void reportsAFailedPreparation() {
        new ProviderState(List.of(new ProviderState.Entry("abc", "dev.example.broken")))
                .write(installation.providers(), ProviderState.PENDING_FILE);
        var err = new ByteArrayOutputStream();

        assertThat(run(err, NO_ENVIRONMENT, "prepare", home.toString())).isEqualTo(1);
        assertThat(err.toString(UTF_8)).contains("no previous build to restore");
    }

    @Test
    void leavesTheDatabaseAloneOutsideThePortableDistribution() {
        var err = new ByteArrayOutputStream();

        assertThat(run(err, NO_ENVIRONMENT, "database", "start", home.toString()))
                .isZero();
        assertThat(run(err, name -> " ", "database", "stop", home.toString())).isZero();
        assertThat(run(err, name -> "54400", "database", "stop", home.toString()))
                .isZero();
        assertThat(err.toString(UTF_8)).isEmpty();
    }

    @Test
    void refusesADatabasePortThatIsNotANumber() {
        var err = new ByteArrayOutputStream();

        assertThat(run(err, name -> "port", "database", "start", home.toString()))
                .isEqualTo(2);
        assertThat(err.toString(UTF_8)).contains("MOSAIKIT_DATABASE_PORT is not a port number");
    }

    @Test
    void reportsADatabaseThatCannotStart() throws IOException {
        Path pgCtl = installation.pgsql().resolve("bin").resolve(windows() ? "pg_ctl.exe" : "pg_ctl");
        Files.createDirectories(pgCtl.getParent());
        Files.writeString(pgCtl, "not a program");
        var err = new ByteArrayOutputStream();

        assertThat(run(err, NO_ENVIRONMENT, "database", "start", home.toString()))
                .isEqualTo(1);
        assertThat(err.toString(UTF_8)).contains("initialize the database");
    }

    @Test
    void reportsTheExitCodeOfAFailedRebuild() {
        // The kernel of this test installation is not a JAR, so the re-augmentation fails at once.
        assertThat(Launcher.reaugment(installation)).isNotZero();
    }

    @Test
    void rebuildsWithoutTheSettingsOfTheInstallation() {
        // Quarkus records the values it sees while building as defaults of the rebuilt kernel: the
        // rebuild must not see config/application.properties nor QUARKUS_* and MOSAIKIT_* variables.
        ProcessBuilder rebuild = Launcher.rebuildProcess(installation);

        assertThat(rebuild.directory().toPath()).isEqualTo(installation.kernel());
        assertThat(rebuild.directory().toPath().resolve("config")).doesNotExist();
        assertThat(rebuild.environment().keySet())
                .noneMatch(name -> name.toUpperCase(Locale.ROOT).startsWith("QUARKUS_")
                        || name.toUpperCase(Locale.ROOT).startsWith("MOSAIKIT_"));
        assertThat(rebuild.command())
                .contains(
                        "-Dquarkus.launch.rebuild=true",
                        installation.kernelJar().toString());
    }

    @Test
    @Tag("MK-013")
    void readsTheTrustOfTheInstallationLikeTheKernel() throws IOException {
        Files.createDirectories(installation.config());
        Files.writeString(
                installation.config().resolve("application.properties"),
                "mosaikit.plugins.signatures=required\nmosaikit.plugins.trusted-keys-directory=keys\n");
        SigningKeys.write(SigningKeys.generate(), home.resolve("keys"), "publisher");

        assertThat(Launcher.trust(installation, NO_ENVIRONMENT))
                .satisfies(trust -> assertThat(trust.signaturesRequired()).isTrue())
                .satisfies(trust -> assertThat(trust.trustedKeys()).hasSize(1));
        assertThat(Launcher.trust(installation, name -> name.equals("MOSAIKIT_PLUGINS_SIGNATURES") ? "optional" : null)
                        .signaturesRequired())
                .isFalse();
        assertThat(Launcher.trust(new Installation(home.resolve("other")), NO_ENVIRONMENT))
                .isEqualTo(PackageTrust.none());
    }

    @Test
    @Tag("MK-013")
    void reportsAnInvalidSignaturePolicy() {
        var err = new ByteArrayOutputStream();

        assertThat(run(
                        err,
                        name -> name.equals("MOSAIKIT_PLUGINS_SIGNATURES") ? "maybe" : null,
                        "prepare",
                        home.toString()))
                .isEqualTo(1);
        assertThat(err.toString(UTF_8)).contains("'required' or 'optional'");
    }

    private static final UnaryOperator<String> NO_ENVIRONMENT = name -> null;

    private static int run(ByteArrayOutputStream err, UnaryOperator<String> environment, String... args) {
        return Launcher.run(
                args, new PrintStream(OutputStream.nullOutputStream()), new PrintStream(err, true, UTF_8), environment);
    }

    private static boolean windows() {
        return System.getProperty("os.name").startsWith("Windows");
    }

    @Test
    void knowsTheVersionOfTheKernelItWasBuiltWith() {
        assertThat(Launcher.version().core()).isEqualTo(Version.parse("0.1.0"));
    }

    private Path jar(String directory) {
        return installation.plugins().resolve(directory).resolve("lib/code.jar");
    }
}

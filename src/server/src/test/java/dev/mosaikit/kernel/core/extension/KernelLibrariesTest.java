// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import dev.mosaikit.kernel.api.extension.LibraryEntry;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The libraries the kernel provides to Java extensions (MK-131), listed by the build of the kernel, and
 * the two places generated from them: the managed dependencies of the parent POM of extensions, with
 * scope provided, so that an extension leaves them out of its package; and the page of the guide for
 * extension developers. When they are not up to date the test fails and names the command that
 * rewrites them, {@value #REWRITE}.
 */
@Tag("MK-131")
class KernelLibrariesTest {

    static final String REWRITE = "./mvnw -pl sdk/java,src/server test -Dskip.npm -Dtest=KernelLibrariesTest"
            + " -Dsurefire.failIfNoSpecifiedTests=false -Ddocs.write=true";

    private static final Path ROOT = Path.of("..", "..");
    private static final Path PARENT_POM = ROOT.resolve("sdk/extension-parent/pom.xml");
    private static final Path PAGE = ROOT.resolve("docs/development/kernel-libraries.md");

    private static final String POM_START =
            "<!-- kernel-libraries: written by KernelLibrariesTest from the build of the kernel (MK-131), do not edit -->";
    private static final String POM_END = "<!-- /kernel-libraries -->";
    private static final String PAGE_START = "<!-- kernel-libraries:start -->";
    private static final String PAGE_END = "<!-- kernel-libraries:end -->";

    /**
     * Libraries that exist for one operating system only, chosen by the build of the machine: left out
     * of the generated files, which must not depend on where the kernel was built.
     */
    private static final Pattern PLATFORM = Pattern.compile(
            "(linux|windows|osx|macos|darwin)[-_]?(x86[-_]?64|aarch[-_]?64|amd64|arm64|x86|ppc64le|s390x|riscv64)");

    @Test
    void theKernelListsTheLibrariesItProvides() {
        KernelLibraries kernel = KernelLibraries.ofKernel();

        assertThat(kernel.versions())
                .as("the build of the kernel lists its runtime dependencies into " + KernelLibraries.RESOURCE)
                .containsKeys(
                        "io.github.mosaikit:mosaikit-kernel-api",
                        "com.fasterxml.jackson.core:jackson-databind",
                        "io.quarkus:quarkus-rest-jackson",
                        "jakarta.data:jakarta.data-api")
                .doesNotContainKeys("org.junit.jupiter:junit-jupiter-api", "org.assertj:assertj-core");
        assertThat(kernel.provides(new LibraryEntry(
                        "lib/jackson-databind.jar",
                        "com.fasterxml.jackson.core",
                        "jackson-databind",
                        kernel.version("com.fasterxml.jackson.core:jackson-databind")
                                .orElseThrow(),
                        "",
                        "0".repeat(64))))
                .isTrue();
    }

    @Test
    void readsTheListOfTheBuild() {
        List<KernelLibraries.Library> libraries = KernelLibraries.parse("""
                The following files have been resolved:
                   org.example:parser:jar:1.2.0:compile\u001B[36m -- module org.example.parser\u001B[m
                   org.example:native:jar:linux-x86_64:4.1:runtime -- module native [auto]
                   org.example:bom:pom:1.0:compile
                   org.example:tests:jar:1.0:test
                """);

        assertThat(libraries)
                .containsExactly(
                        new KernelLibraries.Library("org.example", "native", "linux-x86_64", "4.1"),
                        new KernelLibraries.Library("org.example", "parser", "", "1.2.0"));
        assertThat(libraries.getFirst().key()).isEqualTo("org.example:native:linux-x86_64");
    }

    @Test
    void theParentPomOfExtensionsLeavesOutTheLibrariesOfTheKernel() throws IOException {
        StringBuilder managed = new StringBuilder();
        for (KernelLibraries.Library library : documented()) {
            managed.append("            <dependency><groupId>")
                    .append(library.groupId())
                    .append("</groupId><artifactId>")
                    .append(library.artifactId())
                    .append("</artifactId><version>")
                    .append(library.version())
                    .append("</version>")
                    .append(
                            library.classifier().isEmpty()
                                    ? ""
                                    : "<classifier>" + library.classifier() + "</classifier>")
                    .append("<scope>provided</scope></dependency>\n");
        }
        follow(PARENT_POM, POM_START, POM_END, managed.toString(), "            ");
    }

    @Test
    void theGuideListsTheLibrariesOfTheKernel() throws IOException {
        StringBuilder table = new StringBuilder("| Library | Version |\n|---|---|\n");
        for (KernelLibraries.Library library : documented()) {
            table.append("| `")
                    .append(library.key())
                    .append("` | ")
                    .append(library.version())
                    .append(" |\n");
        }
        follow(PAGE, PAGE_START, PAGE_END, table.toString(), "");
    }

    /** The libraries of the kernel in the generated files: not the extension API, not one platform's. */
    private static List<KernelLibraries.Library> documented() throws IOException {
        String list;
        try (var in = KernelLibraries.class.getResourceAsStream(KernelLibraries.RESOURCE)) {
            assertThat(in).as(KernelLibraries.RESOURCE).isNotNull();
            list = new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        }
        return KernelLibraries.parse(list).stream()
                .filter(library -> !library.groupId().equals("io.github.mosaikit"))
                .filter(library -> !PLATFORM.matcher(library.artifactId() + " " + library.classifier())
                        .find())
                .toList();
    }

    /** Checks the generated part of a file between its markers, or rewrites it with -Ddocs.write=true. */
    private static void follow(Path file, String start, String end, String generated, String indent)
            throws IOException {
        String text = Files.readString(file).replace("\r\n", "\n");
        int from = text.indexOf(start);
        int to = text.indexOf(end);
        assertThat(from).as("the start marker in " + file).isNotNegative();
        assertThat(to).as("the end marker in " + file).isGreaterThan(from);
        String expected = text.substring(0, from + start.length()) + "\n" + generated + indent + text.substring(to);
        if (expected.equals(text)) {
            return;
        }
        if (Boolean.getBoolean("docs.write")) {
            Files.writeString(file, expected);
            return;
        }
        fail(file.normalize() + " does not list the libraries of the kernel. Rewrite it with\n  " + REWRITE);
    }
}

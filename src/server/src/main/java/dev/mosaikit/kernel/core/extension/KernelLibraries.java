// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import dev.mosaikit.kernel.api.extension.LibraryEntry;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The libraries the kernel provides to Java extensions (MK-131), with their versions: its runtime
 * dependencies, listed by the build of the kernel ({@code dependency:list} of the Maven dependency
 * plugin) into {@value #RESOURCE} on its class path. The launcher and the kernel check the libraries of
 * extensions against it; the parent POM of extensions and the guide for extension developers are
 * generated from it.
 *
 * @param versions version of each library, by {@link LibraryEntry#key() key}
 */
public record KernelLibraries(Map<String, String> versions) {

    /** The list written by the build of the kernel, on its class path. */
    public static final String RESOURCE = "/dev/mosaikit/kernel/core/extension/kernel-libraries.txt";

    /** A line of {@code dependency:list}: {@code groupId:artifactId:type[:classifier]:version:scope}. */
    private static final Pattern DEPENDENCY = Pattern.compile(
            "^([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)(?::([A-Za-z0-9_.-]+))?:([A-Za-z0-9_.+-]+):(compile|runtime)$");

    private static final Pattern ANSI = Pattern.compile("\u001B\\[[0-9;]*m");

    /** A library of the kernel. */
    public record Library(String groupId, String artifactId, String classifier, String version) {

        /** See {@link LibraryEntry#key()}. */
        public String key() {
            return LibraryEntry.key(groupId, artifactId, classifier);
        }
    }

    public KernelLibraries {
        versions = Collections.unmodifiableMap(new TreeMap<>(versions));
    }

    /** No library: for tests and tools that do not check them. */
    public static KernelLibraries none() {
        return new KernelLibraries(Map.of());
    }

    /** The libraries of this kernel, from its class path; none when the build did not list them. */
    public static KernelLibraries ofKernel() {
        try (InputStream in = KernelLibraries.class.getResourceAsStream(RESOURCE)) {
            if (in == null) {
                return none();
            }
            return of(parse(new String(in.readAllBytes(), StandardCharsets.UTF_8)));
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read the libraries of the kernel", e);
        }
    }

    /** The libraries of a list. */
    public static KernelLibraries of(List<Library> libraries) {
        Map<String, String> versions = new TreeMap<>();
        libraries.forEach(library -> versions.put(library.key(), library.version()));
        return new KernelLibraries(versions);
    }

    /** Reads the output of {@code dependency:list}: the JARs with scope compile or runtime, sorted. */
    public static List<Library> parse(String list) {
        Map<String, Library> libraries = new TreeMap<>();
        for (String raw : list.split("\r?\n")) {
            String line = ANSI.matcher(raw).replaceAll("").strip();
            int space = line.indexOf(' ');
            Matcher matcher = DEPENDENCY.matcher(space < 0 ? line : line.substring(0, space));
            if (matcher.matches() && "jar".equals(matcher.group(3))) {
                Library library = new Library(
                        matcher.group(1),
                        matcher.group(2),
                        matcher.group(4) == null ? "" : matcher.group(4),
                        matcher.group(5));
                libraries.put(library.key(), library);
            }
        }
        return List.copyOf(libraries.values());
    }

    /** The version of a library that the kernel provides, if it does. */
    public Optional<String> version(String key) {
        return Optional.ofNullable(versions.get(key));
    }

    /** Whether the kernel provides this library in this version: the extension does not need its copy. */
    public boolean provides(LibraryEntry library) {
        return library.version().equals(versions.get(library.key()));
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.io.IOException;
import java.io.InputStream;
import java.io.PrintStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipFile;

/**
 * Writes the libraries of an extension into its manifest (MK-131). The parent POM of extensions runs it
 * at {@code mvn package}, after copying the runtime dependencies of the extension into {@code lib/}:
 *
 * <pre>
 * java -cp mosaikit-kernel-api.jar dev.mosaikit.kernel.api.extension.ExtensionLibrariesTool &lt;dependency list&gt; &lt;lib directory&gt; &lt;manifest.yaml&gt;
 * </pre>
 *
 * <p>The dependency list is the output of {@code dependency:list} of the Maven dependency plugin, with
 * the runtime dependencies only: the kernel's libraries have scope {@code provided} through the parent
 * POM and are not in it. The tool replaces the top-level {@code libraries} block of the manifest with
 * one entry per JAR, with its Maven coordinates and SHA-256 digest, removes the block when there are
 * no libraries, and leaves the rest of the file as it is. It refuses a library that is a Quarkus
 * extension, which only the kernel can bring, and deletes from the lib directory the JARs of
 * libraries that the previous block listed and the extension no longer uses.
 */
public final class ExtensionLibrariesTool {

    /** A line of {@code dependency:list}: {@code groupId:artifactId:type[:classifier]:version:scope}. */
    private static final Pattern DEPENDENCY = Pattern.compile(
            "^([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+)(?::([A-Za-z0-9_.-]+))?:([A-Za-z0-9_.+-]+):(compile|runtime)$");

    private static final Pattern ANSI = Pattern.compile("\u001B\\[[0-9;]*m");
    private static final Pattern BLOCK_START = Pattern.compile("^libraries:\\s*(#.*)?$");
    private static final Pattern LISTED_JAR = Pattern.compile("^\\s*-?\\s*jar:\\s*[\"']?([^\"'#\\s]+)[\"']?\\s*$");

    static final String QUARKUS_EXTENSION_FILE = "META-INF/quarkus-extension.properties";

    private ExtensionLibrariesTool() {}

    // A command-line tool run by the build: its messages are for the console.
    @SuppressWarnings("java:S106")
    public static void main(String[] args) {
        int code = run(args, System.out, System.err);
        if (code != 0) {
            // An exception rather than System.exit: the build may run the tool in its own JVM.
            throw new IllegalStateException("The libraries of the extension could not be written");
        }
    }

    /** Runs the tool; returns the exit code. */
    static int run(String[] args, PrintStream out, PrintStream err) {
        if (args.length != 3) {
            err.println("usage: ExtensionLibrariesTool <dependency list> <lib directory> <manifest.yaml>");
            return 2;
        }
        Path manifest = Path.of(args[2]);
        if (!Files.isRegularFile(manifest)) {
            out.println("Mosaikit: no " + manifest.getFileName() + ", no libraries to write.");
            return 0;
        }
        try {
            List<LibraryEntry> libraries = libraries(Path.of(args[0]), Path.of(args[1]), manifest.getParent());
            boolean changed = write(manifest, libraries);
            out.printf(
                    "Mosaikit: %d librar%s of the extension%s.%n",
                    libraries.size(),
                    libraries.size() == 1 ? "y" : "ies",
                    changed ? ", written into " + manifest.getFileName() : "");
            return 0;
        } catch (IOException | UncheckedIOException | IllegalArgumentException e) {
            err.println("Mosaikit: " + e.getMessage());
            return 1;
        }
    }

    /** The libraries of the dependency list, whose JARs the build copied into the lib directory. */
    static List<LibraryEntry> libraries(Path dependencyList, Path lib, Path root) throws IOException {
        List<LibraryEntry> libraries = new ArrayList<>();
        if (!Files.isRegularFile(dependencyList)) {
            return libraries;
        }
        for (String raw : Files.readAllLines(dependencyList, StandardCharsets.UTF_8)) {
            String line = ANSI.matcher(raw).replaceAll("").strip();
            int space = line.indexOf(' ');
            Matcher matcher = DEPENDENCY.matcher(space < 0 ? line : line.substring(0, space));
            if (!matcher.matches() || !"jar".equals(matcher.group(3))) {
                continue;
            }
            String groupId = matcher.group(1);
            String artifactId = matcher.group(2);
            String classifier = matcher.group(4) == null ? "" : matcher.group(4);
            String version = matcher.group(5);
            Path jar =
                    lib.resolve(artifactId + "-" + version + (classifier.isEmpty() ? "" : "-" + classifier) + ".jar");
            String coordinates =
                    groupId + ":" + artifactId + ":" + version + (classifier.isEmpty() ? "" : ":" + classifier);
            if (!Files.isRegularFile(jar)) {
                throw new IllegalArgumentException("the JAR of the library " + coordinates + " is not in " + lib);
            }
            if (isQuarkusExtension(jar)) {
                throw new IllegalArgumentException("the library " + coordinates + " is a Quarkus extension: an"
                        + " extension can use only the Quarkus extensions of the kernel, with scope provided");
            }
            String path = root.toAbsolutePath()
                    .normalize()
                    .relativize(jar.toAbsolutePath().normalize())
                    .toString()
                    .replace('\\', '/');
            libraries.add(new LibraryEntry(path, groupId, artifactId, version, classifier, sha256(jar)));
        }
        return libraries;
    }

    /**
     * Replaces the {@code libraries} block of the manifest; returns whether the file changed. JARs that
     * the previous block listed and the new one does not are deleted.
     */
    static boolean write(Path manifest, List<LibraryEntry> libraries) throws IOException {
        String text = Files.readString(manifest, StandardCharsets.UTF_8);
        String newline = text.contains("\r\n") ? "\r\n" : "\n";
        List<String> lines = new ArrayList<>(List.of(text.split("\r?\n", -1)));
        if (!lines.isEmpty() && lines.getLast().isEmpty()) {
            lines.removeLast();
        }
        int start = -1;
        for (int i = 0; i < lines.size(); i++) {
            if (BLOCK_START.matcher(lines.get(i)).matches()) {
                start = i;
                break;
            }
        }
        List<String> previous = new ArrayList<>();
        if (start >= 0) {
            int end = start + 1;
            for (int i = start + 1; i < lines.size(); i++) {
                String line = lines.get(i);
                if (line.isBlank()) {
                    continue;
                }
                if (!(line.startsWith(" ") || line.startsWith("\t") || line.startsWith("-"))) {
                    break;
                }
                end = i + 1;
            }
            for (String line : lines.subList(start + 1, end)) {
                Matcher jar = LISTED_JAR.matcher(line);
                if (jar.matches()) {
                    previous.add(jar.group(1));
                }
            }
            lines.subList(start, end).clear();
        }
        List<String> block = block(libraries);
        if (!block.isEmpty()) {
            if (start >= 0) {
                lines.addAll(start, block);
            } else {
                while (!lines.isEmpty() && lines.getLast().isBlank()) {
                    lines.removeLast();
                }
                lines.addAll(block);
            }
        }
        String updated = String.join(newline, lines) + newline;
        Path root = manifest.toAbsolutePath().getParent();
        List<String> kept = libraries.stream().map(LibraryEntry::jar).toList();
        for (String jar : previous) {
            if (!kept.contains(jar) && isInside(root, jar)) {
                Files.deleteIfExists(root.resolve(jar));
            }
        }
        if (updated.equals(text)) {
            return false;
        }
        Files.writeString(manifest, updated, StandardCharsets.UTF_8);
        return true;
    }

    private static List<String> block(List<LibraryEntry> libraries) {
        if (libraries.isEmpty()) {
            return List.of();
        }
        Map<String, LibraryEntry> unique = new LinkedHashMap<>();
        libraries.forEach(library -> unique.putIfAbsent(library.key(), library));
        List<String> block = new ArrayList<>();
        block.add("libraries:");
        block.add("  # Written by the build of the extension from its runtime dependencies (MK-131): do not edit.");
        for (LibraryEntry library : unique.values()) {
            // Quoted, so that a digest of digits only stays a string; single quotes, as Prettier writes them.
            block.add("  - jar: '" + library.jar() + "'");
            block.add("    coordinates: '" + library.coordinates() + "'");
            block.add("    sha256: '" + library.sha256() + "'");
        }
        return block;
    }

    /** Whether the JAR is a Quarkus extension (its runtime part), which only the kernel can bring. */
    static boolean isQuarkusExtension(Path jar) {
        try (ZipFile zip = new ZipFile(jar.toFile())) {
            return zip.getEntry(QUARKUS_EXTENSION_FILE) != null;
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read the library " + jar.getFileName(), e);
        }
    }

    private static String sha256(Path file) {
        try (InputStream in = Files.newInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            for (int read = in.read(buffer); read >= 0; read = in.read(buffer)) {
                digest.update(buffer, 0, read);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read " + file, e);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by every Java platform", e);
        }
    }

    /** Whether a path of the manifest is a JAR inside the extension. */
    private static boolean isInside(Path root, String relative) {
        Path resolved = root.resolve(relative).normalize();
        return resolved.startsWith(root.normalize()) && relative.endsWith(".jar");
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.signature;

import java.io.IOException;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.KeyPair;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;

/**
 * Command-line tool for extension publishers and administrators, in the JAR of the Java extension API:
 *
 * <pre>
 * java -cp mosaikit-kernel-api.jar dev.mosaikit.kernel.api.signature.PackageSigningTool keygen &lt;directory&gt; &lt;name&gt;
 * java -cp mosaikit-kernel-api.jar dev.mosaikit.kernel.api.signature.PackageSigningTool sign &lt;directory&gt;/&lt;name&gt; &lt;package&gt;...
 * java -cp mosaikit-kernel-api.jar dev.mosaikit.kernel.api.signature.PackageSigningTool verify &lt;trusted keys directory&gt; &lt;package&gt;...
 * java -cp mosaikit-kernel-api.jar dev.mosaikit.kernel.api.signature.PackageSigningTool trust &lt;directory&gt;/&lt;name&gt; &lt;trusted keys directory&gt;
 * java -cp mosaikit-kernel-api.jar dev.mosaikit.kernel.api.signature.PackageSigningTool index &lt;directory&gt;/&lt;name&gt; &lt;packages directory&gt;
 * </pre>
 *
 * <p>{@code keygen} writes {@code <name>.pub.pem}, to copy into the {@code config/trusted-keys}
 * directory of installations ({@code trust} does it), and {@code <name>.key.pem}, to keep secret.
 * A package argument that is a directory stands for every package ({@code *.zip}) in it. {@code
 * verify} exits with 0 only when every package is signed with a trusted key. {@code index} writes
 * the signed catalog of a directory of packages ({@link ExtensionIndex}), for a marketplace (MK-022).
 */
public final class PackageSigningTool {

    private PackageSigningTool() {}

    // A command-line tool: its messages are for the console.
    @SuppressWarnings("java:S106")
    public static void main(String[] args) {
        System.exit(run(args, System.out, System.err));
    }

    /** Runs a command; returns the exit code. */
    static int run(String[] args, PrintStream out, PrintStream err) {
        if (args.length < 3
                || !List.of("keygen", "sign", "verify", "trust", "index").contains(args[0])) {
            err.println("usage: PackageSigningTool keygen <directory> <name>");
            err.println("       PackageSigningTool sign <directory>/<name> <package>...");
            err.println("       PackageSigningTool verify <trusted keys directory> <package>...");
            err.println("       PackageSigningTool trust <directory>/<name> <trusted keys directory>");
            err.println("       PackageSigningTool index <directory>/<name> <packages directory>");
            return 2;
        }
        try {
            return switch (args[0]) {
                case "keygen" -> keygen(Path.of(args[1]), args[2], out);
                case "trust" -> trust(args[1], Path.of(args[2]), out);
                case "index" -> index(args[1], Path.of(args[2]), out);
                case "sign" -> sign(args[1], packages(args), out);
                default -> verify(Path.of(args[1]), packages(args), out);
            };
        } catch (IOException e) {
            err.println("Error: " + e.getMessage());
            return 1;
        }
    }

    /** The packages of the arguments after the second one, directories expanded to their packages. */
    private static List<Path> packages(String[] args) throws IOException {
        List<Path> packages = new ArrayList<>();
        for (String arg : Arrays.asList(args).subList(2, args.length)) {
            Path path = Path.of(arg);
            if (Files.isDirectory(path)) {
                try (Stream<Path> files = Files.list(path)) {
                    files.filter(file -> file.getFileName()
                                    .toString()
                                    .toLowerCase(Locale.ROOT)
                                    .endsWith(".zip"))
                            .sorted()
                            .forEach(packages::add);
                }
            } else {
                packages.add(path);
            }
        }
        return packages;
    }

    private static int trust(String key, Path trustedKeys, PrintStream out) throws IOException {
        Path publicKey = Path.of(key + SigningKeys.PUBLIC_SUFFIX);
        String keyId = SigningKeys.keyId(SigningKeys.readPublic(publicKey));
        Files.createDirectories(trustedKeys);
        Files.copy(publicKey, trustedKeys.resolve(publicKey.getFileName()), StandardCopyOption.REPLACE_EXISTING);
        out.printf("Key %s trusted in %s.%n", keyId, trustedKeys);
        return 0;
    }

    private static int index(String key, Path directory, PrintStream out) throws IOException {
        KeyPair pair = new KeyPair(
                SigningKeys.readPublic(Path.of(key + SigningKeys.PUBLIC_SUFFIX)),
                SigningKeys.readPrivate(Path.of(key + SigningKeys.PRIVATE_SUFFIX)));
        var entries = ExtensionIndex.write(directory, pair, Instant.now());
        out.printf(
                "Index of %d packages written to %s and signed with key %s.%n",
                entries.size(), directory.resolve(ExtensionIndex.INDEX_FILE), SigningKeys.keyId(pair.getPublic()));
        return 0;
    }

    private static int keygen(Path directory, String name, PrintStream out) throws IOException {
        KeyPair pair = SigningKeys.generate();
        SigningKeys.write(pair, directory, name);
        out.printf(
                "Key %s written to %s: give %s%s to installations, keep %s%s secret.%n",
                SigningKeys.keyId(pair.getPublic()),
                directory,
                name,
                SigningKeys.PUBLIC_SUFFIX,
                name,
                SigningKeys.PRIVATE_SUFFIX);
        return 0;
    }

    private static int sign(String key, List<Path> packages, PrintStream out) throws IOException {
        KeyPair pair = new KeyPair(
                SigningKeys.readPublic(Path.of(key + SigningKeys.PUBLIC_SUFFIX)),
                SigningKeys.readPrivate(Path.of(key + SigningKeys.PRIVATE_SUFFIX)));
        for (Path file : packages) {
            PackageSignatures.sign(file, pair);
            out.printf("Signed %s with key %s.%n", file, SigningKeys.keyId(pair.getPublic()));
        }
        return 0;
    }

    private static int verify(Path trustedKeys, List<Path> packages, PrintStream out) throws IOException {
        var keys = SigningKeys.readTrusted(trustedKeys);
        int exitCode = 0;
        for (Path file : packages) {
            String status;
            try {
                PackageVerification verification = PackageSignatures.verify(file, keys);
                status = switch (verification) {
                    case PackageVerification.Verified(String keyId) -> "verified, key " + keyId;
                    case PackageVerification.UnknownKey(String keyId) -> "signed with the unknown key " + keyId;
                    case PackageVerification.Unsigned() -> "not signed";
                };
                if (!verification.isVerified()) {
                    exitCode = 1;
                }
            } catch (PackageSignatureException e) {
                status = "REFUSED, " + e.getMessage();
                exitCode = 1;
            }
            out.printf("%s: %s%n", file, status);
        }
        return exitCode;
    }
}

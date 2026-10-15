// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import dev.mosaikit.kernel.api.extension.BackendEntry;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ExtensionManifests;
import dev.mosaikit.kernel.api.extension.LibraryEntry;
import dev.mosaikit.kernel.api.extension.ManifestParseResult;
import dev.mosaikit.kernel.api.extension.ManifestViolation;
import dev.mosaikit.kernel.api.signature.PackageSignatureException;
import dev.mosaikit.kernel.api.signature.PackageSignatures;
import dev.mosaikit.kernel.api.signature.PackageVerification;
import dev.mosaikit.kernel.api.version.Version;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Stream;
import java.util.zip.ZipFile;

/**
 * Reads the extensions of an installation directory and decides which ones can be activated.
 *
 * <p>Each extension lives in its own sub-directory with a {@code manifest.yaml} at its root, or in a
 * package ({@code <name>.zip}, see {@link ExtensionPackages}) with the same content. A
 * extension is active when its manifest is valid, its platform range includes the kernel version and
 * every extension it requires is active in an accepted version. Requirements are resolved until no
 * status changes, so that an extension missing a requirement also disables the extensions that require
 * it.
 *
 * <p>An extension that brings Java code is active only when its {@link BackendCheck} accepts the
 * declared JAR: the kernel accepts the JARs loaded by the launcher, the launcher every JAR that
 * exists. Both use this class, so that they always agree on which extensions can run.
 *
 * <p>The libraries that a Java extension brings (MK-131) must be in its directory with the digest of
 * the manifest, must not be Quarkus extensions, and must not exist in another version in the kernel
 * or in another active extension: the kernel holds one copy of each library. Between two extensions
 * that bring a library in different versions, the one the kernel already runs wins, otherwise the
 * first by id.
 *
 * <p>The class has no framework dependency and is safe to use from tests and tools.
 */
public final class ExtensionCatalog {

    /** File name of the manifest at the root of each extension. */
    public static final String MANIFEST_FILE = "manifest.yaml";

    private static final TypeReference<Map<String, Object>> TREE = new TypeReference<>() {};

    private final ObjectMapper yaml = new ObjectMapper(new YAMLFactory());
    private final Version kernelVersion;
    private final BackendCheck backendCheck;
    private final PackageTrust trust;
    private final KernelLibraries kernelLibraries;
    private final Set<String> loaded;

    /**
     * Creates a catalog that accepts every declared backend JAR that exists.
     *
     * @param kernelVersion version of the running kernel; pre-release and build metadata are
     *     ignored when checking platform ranges, so that snapshots behave like their release
     */
    public ExtensionCatalog(Version kernelVersion) {
        this(kernelVersion, BackendCheck.jarExists());
    }

    /**
     * @param kernelVersion version of the running kernel, see {@link #ExtensionCatalog(Version)}
     * @param backendCheck decides whether the Java code of an extension can be used
     */
    public ExtensionCatalog(Version kernelVersion, BackendCheck backendCheck) {
        this(kernelVersion, backendCheck, PackageTrust.none());
    }

    /**
     * @param kernelVersion version of the running kernel, see {@link #ExtensionCatalog(Version)}
     * @param backendCheck decides whether the Java code of an extension can be used
     * @param trust the keys of trusted publishers and whether signatures are required (MK-013)
     */
    public ExtensionCatalog(Version kernelVersion, BackendCheck backendCheck, PackageTrust trust) {
        this(kernelVersion, backendCheck, trust, KernelLibraries.ofKernel(), Set.of());
    }

    /**
     * @param kernelVersion version of the running kernel, see {@link #ExtensionCatalog(Version)}
     * @param backendCheck decides whether the Java code of an extension can be used
     * @param trust the keys of trusted publishers and whether signatures are required (MK-013)
     * @param kernelLibraries the libraries the kernel provides (MK-131)
     * @param loaded the extensions whose Java code the kernel runs: they keep their libraries when
     *     another extension brings one of them in another version
     */
    public ExtensionCatalog(
            Version kernelVersion,
            BackendCheck backendCheck,
            PackageTrust trust,
            KernelLibraries kernelLibraries,
            Set<String> loaded) {
        this.kernelVersion =
                Objects.requireNonNull(kernelVersion, "kernelVersion").core();
        this.backendCheck = Objects.requireNonNull(backendCheck, "backendCheck");
        this.trust = Objects.requireNonNull(trust, "trust");
        this.kernelLibraries = Objects.requireNonNull(kernelLibraries, "kernelLibraries");
        this.loaded = Set.copyOf(loaded);
    }

    /**
     * Scans a directory and returns every extension found, sorted by key. Packages ({@code *.zip}) are
     * unpacked into {@code <directory>/.packages}; see {@link #scan(Path, Path)}.
     */
    public List<InstalledExtension> scan(Path directory) {
        return scan(directory, directory.resolve(".packages"));
    }

    /**
     * Scans a directory and returns every extension found, sorted by key: each sub-directory is a
     * extension, and so is each package ({@code *.zip}), unpacked into the work directory.
     * Directories whose name starts with a dot are ignored.
     */
    public List<InstalledExtension> scan(Path directory, Path packagesDirectory) {
        if (!Files.isDirectory(directory)) {
            return List.of();
        }
        List<InstalledExtension> found = new ArrayList<>();
        try (Stream<Path> children = Files.list(directory)) {
            children.filter(child -> !child.getFileName().toString().startsWith("."))
                    .sorted()
                    .forEach(child -> {
                        if (Files.isDirectory(child)) {
                            found.add(readDirectory(child));
                        } else if (ExtensionPackages.isPackage(child)) {
                            found.add(readPackage(child, packagesDirectory));
                        }
                    });
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot list extensions in " + directory, e);
        }
        return resolve(checkSharedLibraries(resolve(markDuplicates(found))));
    }

    private InstalledExtension readDirectory(Path directory) {
        if (trust.signaturesRequired()) {
            return invalid(
                    directory.getFileName().toString(),
                    directory,
                    List.of(
                            "Only signed packages are accepted (mosaikit.extensions.signatures=required), not directories"));
        }
        return read(directory);
    }

    private InstalledExtension readPackage(Path zip, Path packagesDirectory) {
        String name = zip.getFileName().toString();
        PackageVerification verification;
        try {
            verification = PackageSignatures.verify(zip, trust.trustedKeys());
        } catch (PackageSignatureException e) {
            return invalid(name, zip, List.of("Refused package: " + e.getMessage()));
        } catch (IOException | UncheckedIOException e) {
            return invalid(name, zip, List.of("Unreadable package: " + firstLine(e.getMessage())));
        }
        if (trust.signaturesRequired() && !verification.isVerified()) {
            String reason = verification instanceof PackageVerification.UnknownKey(String keyId)
                    ? "signed with the key " + keyId + ", which is not trusted"
                    : "not signed";
            return invalid(
                    name, zip, List.of("Refused package: " + reason + " (mosaikit.extensions.signatures=required)"));
        }
        InstalledExtension extension;
        try {
            extension = read(ExtensionPackages.unpack(zip, packagesDirectory));
        } catch (IOException | UncheckedIOException e) {
            return invalid(name, zip, List.of("Unreadable package: " + firstLine(e.getMessage())));
        }
        return verification instanceof PackageVerification.Verified(String keyId)
                ? extension.verifiedBy(keyId)
                : extension;
    }

    private InstalledExtension read(Path directory) {
        String fallbackKey = directory.getFileName().toString();
        Path manifestFile = directory.resolve(MANIFEST_FILE);
        if (!Files.isRegularFile(manifestFile)) {
            return invalid(fallbackKey, directory, List.of("Missing " + MANIFEST_FILE));
        }
        Map<String, Object> tree;
        try {
            tree = Objects.requireNonNullElse(yaml.readValue(manifestFile.toFile(), TREE), Map.of());
        } catch (IOException e) {
            return invalid(
                    fallbackKey, directory, List.of("Unreadable " + MANIFEST_FILE + ": " + firstLine(e.getMessage())));
        }
        return switch (ExtensionManifests.parse(tree)) {
            case ManifestParseResult.Valid(ExtensionManifest manifest) -> checkPlatform(manifest, directory);
            case ManifestParseResult.Invalid(List<ManifestViolation> violations) ->
                invalid(
                        fallbackKey,
                        directory,
                        violations.stream()
                                .map(violation -> violation.field() + ": " + violation.message())
                                .toList());
        };
    }

    private InstalledExtension checkPlatform(ExtensionManifest manifest, Path directory) {
        if (!manifest.supportsPlatform(kernelVersion)) {
            return new InstalledExtension(
                    manifest.id(),
                    directory,
                    Optional.of(manifest),
                    ExtensionStatus.INCOMPATIBLE,
                    List.of("Requires kernel " + manifest.platform() + ", running " + kernelVersion));
        }
        List<String> libraryProblems = new ArrayList<>();
        ExtensionStatus libraryStatus = checkLibraries(manifest, directory, libraryProblems);
        if (!libraryProblems.isEmpty()) {
            return new InstalledExtension(
                    manifest.id(), directory, Optional.of(manifest), libraryStatus, libraryProblems);
        }
        Optional<BackendCheck.Problem> backendProblem =
                manifest.backend().flatMap(backend -> backendCheck.check(manifest, directory.resolve(backend.jar())));
        if (backendProblem.isPresent()) {
            return new InstalledExtension(
                    manifest.id(),
                    directory,
                    Optional.of(manifest),
                    backendProblem.get().status(),
                    List.of(backendProblem.get().message()));
        }
        return new InstalledExtension(
                manifest.id(), directory, Optional.of(manifest), ExtensionStatus.ACTIVE, List.of());
    }

    /**
     * Checks the libraries of an extension alone (MK-131): present with the digest of the manifest, not
     * Quarkus extensions, and in the version of the kernel when the kernel has them.
     *
     * @return {@link ExtensionStatus#INVALID} when the package itself is wrong, {@link
     *     ExtensionStatus#INCOMPATIBLE} when only the kernel has another version
     */
    private ExtensionStatus checkLibraries(ExtensionManifest manifest, Path directory, List<String> problems) {
        ExtensionStatus status = ExtensionStatus.INCOMPATIBLE;
        for (LibraryEntry library : manifest.libraries()) {
            Path jar = directory.resolve(library.jar()).normalize();
            if (!jar.startsWith(directory.normalize()) || !Files.isRegularFile(jar)) {
                problems.add(
                        "Library " + library.coordinates() + ": its JAR " + library.jar() + " is not in the package");
                status = ExtensionStatus.INVALID;
            } else if (!ProviderState.sha256(jar).equals(library.sha256())) {
                problems.add("Library " + library.coordinates() + ": the SHA-256 digest of " + library.jar()
                        + " is not the one of the manifest");
                status = ExtensionStatus.INVALID;
            } else if (isQuarkusExtension(jar)) {
                problems.add(
                        "Library " + library.coordinates()
                                + " is a Quarkus extension: a Java extension can use only the Quarkus extensions of the kernel");
                status = ExtensionStatus.INVALID;
            } else {
                kernelLibraries
                        .version(library.key())
                        .filter(version -> !version.equals(library.version()))
                        .ifPresent(version -> problems.add(conflictWithKernel(library, version)));
            }
        }
        return status;
    }

    /** Why the kernel refuses a library it has in another version. */
    public static String conflictWithKernel(LibraryEntry library, String kernelVersion) {
        return "Library " + library.key() + " " + library.version() + " conflicts with the kernel, which provides"
                + " version " + kernelVersion + ": use the version of the kernel or relocate the library";
    }

    /** Why the kernel refuses a library that another extension brings in another version or content. */
    public static String conflictWithExtension(LibraryEntry library, LibraryEntry other, String extensionId) {
        if (other.version().equals(library.version())) {
            return "Library " + library.coordinates() + " is not the same JAR as the one brought by extension "
                    + extensionId + " (another SHA-256 digest)";
        }
        return "Library " + library.key() + " " + library.version() + " conflicts with version " + other.version()
                + " brought by extension " + extensionId + ": align the versions or relocate the library";
    }

    /** Whether a JAR is a Quarkus extension, which only the kernel can bring. */
    static boolean isQuarkusExtension(Path jar) {
        try (ZipFile zip = new ZipFile(jar.toFile())) {
            return zip.getEntry("META-INF/quarkus-extension.properties") != null;
        } catch (IOException _) {
            return false;
        }
    }

    /**
     * Disables the active extensions that bring a library another active extension has in another
     * version (MK-131). The extensions the kernel runs claim their libraries first, then the others by
     * id; a library the kernel provides in the same version is not claimed.
     */
    private List<InstalledExtension> checkSharedLibraries(List<InstalledExtension> extensions) {
        record Claim(LibraryEntry library, String extensionId, boolean api) {}
        Map<String, Claim> claims = new HashMap<>();
        Map<String, InstalledExtension> refused = new HashMap<>();
        extensions.stream()
                .filter(InstalledExtension::isActive)
                .sorted(Comparator.comparing((InstalledExtension extension) -> !loaded.contains(extension.key()))
                        .thenComparing(InstalledExtension::key))
                .forEach(extension -> {
                    List<LibraryEntry> libraries = extension.manifest().orElseThrow().libraries().stream()
                            .filter(library -> !kernelLibraries.provides(library))
                            .toList();
                    ExtensionManifest manifest = extension.manifest().orElseThrow();
                    List<String> problems = new ArrayList<>();
                    for (LibraryEntry library : libraries) {
                        Claim claim = claims.get(library.key());
                        // The API of a contract is compatible in the same major version (MK-134).
                        boolean api = claim != null && (claim.api() || manifest.isContractApi(library));
                        if (claim != null && !ContractApis.compatible(library, claim.library(), api)) {
                            problems.add(ContractApis.conflict(library, claim.library(), claim.extensionId(), api));
                        }
                    }
                    if (problems.isEmpty()) {
                        libraries.forEach(library -> claims.merge(
                                library.key(),
                                new Claim(library, extension.key(), manifest.isContractApi(library)),
                                (claimed, other) -> new Claim(
                                        ContractApis.highest(claimed.library(), other.library()),
                                        claimed.extensionId(),
                                        claimed.api() || other.api())));
                    } else {
                        refused.put(
                                extension.key(),
                                new InstalledExtension(
                                        extension.key(),
                                        extension.directory(),
                                        extension.manifest(),
                                        ExtensionStatus.INCOMPATIBLE,
                                        problems,
                                        extension.publisherKey()));
                    }
                });
        return extensions.stream()
                .map(extension -> extension.isActive() ? refused.getOrDefault(extension.key(), extension) : extension)
                .toList();
    }

    /** Keeps the first of two extensions with the same id or the same API name. */
    private static List<InstalledExtension> markDuplicates(List<InstalledExtension> extensions) {
        Set<String> seen = new HashSet<>();
        Map<String, String> apis = new HashMap<>();
        List<InstalledExtension> result = new ArrayList<>();
        for (InstalledExtension extension : extensions) {
            Optional<String> api =
                    extension.manifest().flatMap(ExtensionManifest::backend).map(BackendEntry::api);
            if (extension.manifest().isPresent() && !seen.add(extension.key())) {
                result.add(invalid(
                        extension.key(),
                        extension.directory(),
                        List.of("Duplicate extension id, already installed in another directory")));
            } else if (api.isPresent() && apis.containsKey(api.get())) {
                result.add(invalid(
                        extension.key(),
                        extension.directory(),
                        List.of("API name '" + api.get() + "' is already used by " + apis.get(api.get()))));
            } else {
                api.ifPresent(name -> apis.put(name, extension.key()));
                result.add(extension);
            }
        }
        return result;
    }

    /** Disables extensions whose requirements are not active, until a fixed point is reached. */
    private static List<InstalledExtension> resolve(List<InstalledExtension> extensions) {
        Set<String> installed = new HashSet<>();
        extensions.stream()
                .filter(extension -> extension.status() != ExtensionStatus.INVALID)
                .forEach(extension -> installed.add(extension.key()));
        List<InstalledExtension> current = extensions;
        boolean changed = true;
        while (changed) {
            Map<String, ExtensionManifest> active = new HashMap<>();
            current.stream()
                    .filter(InstalledExtension::isActive)
                    .forEach(extension ->
                            active.put(extension.key(), extension.manifest().orElseThrow()));
            List<InstalledExtension> next = current.stream()
                    .map(extension -> checkRequirements(extension, active, installed))
                    .toList();
            changed = !next.equals(current);
            current = next;
        }
        return current.stream()
                .sorted(Comparator.comparing(InstalledExtension::key))
                .toList();
    }

    /**
     * Leaves inactive an extension whose required dependencies are not active, with the explanation
     * that the marketplace gives when it refuses to install it (MK-132). Optional dependencies are not
     * checked: the extension runs without them.
     */
    private static InstalledExtension checkRequirements(
            InstalledExtension extension, Map<String, ExtensionManifest> active, Set<String> installed) {
        if (!extension.isActive()) {
            return extension;
        }
        List<String> problems =
                ExtensionDependencies.unmet(extension.manifest().orElseThrow(), active, installed).stream()
                        .map(ExtensionDependencies.Unmet::toString)
                        .toList();
        if (problems.isEmpty()) {
            return extension;
        }
        return new InstalledExtension(
                extension.key(),
                extension.directory(),
                extension.manifest(),
                ExtensionStatus.INCOMPATIBLE,
                problems,
                extension.publisherKey());
    }

    private static String firstLine(String message) {
        if (message == null) {
            return "unknown error";
        }
        int newline = message.indexOf('\n');
        return newline < 0 ? message : message.substring(0, newline);
    }

    private static InstalledExtension invalid(String key, Path directory, List<String> problems) {
        return new InstalledExtension(key, directory, Optional.empty(), ExtensionStatus.INVALID, problems);
    }
}

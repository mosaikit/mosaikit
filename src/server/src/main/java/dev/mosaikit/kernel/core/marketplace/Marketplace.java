// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.marketplace;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.signature.ExtensionIndex;
import dev.mosaikit.kernel.api.signature.PackageSignatureException;
import dev.mosaikit.kernel.api.signature.PackageSignatures;
import dev.mosaikit.kernel.api.signature.PackageVerification;
import dev.mosaikit.kernel.api.version.Version;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import dev.mosaikit.kernel.core.extension.BackendCheck;
import dev.mosaikit.kernel.core.extension.ContractChecks;
import dev.mosaikit.kernel.core.extension.ExtensionCatalog;
import dev.mosaikit.kernel.core.extension.ExtensionDependencies;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.ExtensionStatus;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.extension.KernelLibraries;
import dev.mosaikit.kernel.core.extension.LibraryConflicts;
import dev.mosaikit.kernel.core.extension.PackageTrust;
import dev.mosaikit.kernel.core.sharing.SharingLevels;
import jakarta.enterprise.context.ApplicationScoped;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.jboss.logging.Logger;

/**
 * The marketplace of the installation (MK-022, ADR-0021): the catalogs it reads, whose index must
 * be signed by a trusted key, and the installation of their packages, or of a package uploaded by
 * an administrator, into the extensions directory. Every package must be signed by a trusted
 * publisher; it takes effect at the next start.
 */
@ApplicationScoped
public class Marketplace {

    private static final Logger LOG = Logger.getLogger(Marketplace.class);

    /** Where replaced packages are kept, ignored by the scan of extensions. */
    static final String PREVIOUS = ".previous";

    /**
     * Prefix of the directory where a package is inspected: in the extensions directory, which belongs
     * to the kernel, rather than in the temporary directory that other users share; ignored by the
     * scan of extensions.
     */
    private static final String INSTALLING = ".installing-";

    private static final Pattern SAFE_NAME = Pattern.compile("[^A-Za-z0-9._-]");

    private final ExtensionRegistry registry;
    private final CatalogSources sources;
    private final ObjectMapper json;
    private final List<URI> catalogs;
    private final long maxBytes;
    private final SharingLevels sharing;

    public Marketplace(
            ExtensionRegistry registry,
            CatalogSources sources,
            ObjectMapper json,
            KernelConfig config,
            SharingLevels sharing) {
        this.registry = registry;
        this.sharing = sharing;
        this.sources = sources;
        this.json = json;
        this.catalogs = config.marketplace().sources().orElse(List.of()).stream()
                .map(Marketplace::located)
                .toList();
        this.maxBytes = config.marketplace().maxPackageBytes();
    }

    /** A catalog whose index was read, verified or not. */
    private record Catalog(CatalogView.Source source, List<ExtensionIndex.Entry> entries) {}

    /** What the catalogs offer, compared with what is installed. */
    public CatalogView catalog() {
        Map<String, String> installed = installedVersions();
        List<CatalogView.Source> views = new ArrayList<>();
        List<CatalogView.Offer> offers = new ArrayList<>();
        for (URI uri : catalogs) {
            Catalog catalog = read(uri);
            views.add(catalog.source());
            for (ExtensionIndex.Entry entry : catalog.entries()) {
                String current = installed.get(entry.id());
                boolean placed = !entry.version().equals(current)
                        && Files.isRegularFile(registry.directory().resolve(packageFile(entry.id(), entry.version())));
                offers.add(new CatalogView.Offer(
                        uri.toString(),
                        entry.id(),
                        entry.version(),
                        entry.name(),
                        entry.size(),
                        entry.publisherKey(),
                        current,
                        placed ? "restart" : state(entry.version(), current)));
            }
        }
        offers.sort(Comparator.comparing(CatalogView.Offer::id).thenComparing(CatalogView.Offer::source));
        return new CatalogView(views, offers);
    }

    /** A package of a catalog to install, in an operation of one or more packages. */
    public record Request(String source, String id, String version) {}

    /**
     * Downloads a package of a catalog and places it in the extensions directory.
     *
     * @throws ResourceNotFoundException when the catalog does not offer that version
     * @throws ConflictException when a required dependency is missing or the update breaks a dependent
     */
    public Installation install(String source, String id, String version) {
        return install(List.of(new Request(source, id, version))).getFirst();
    }

    /**
     * Downloads packages of the catalogs and places them together in the extensions directory, so
     * that an extension and the extensions it requires, or an update and the dependents that need
     * it, are installed in one operation (MK-132). Nothing is placed unless every package can be.
     *
     * @throws ResourceNotFoundException when a catalog does not offer a version
     * @throws ConflictException when a required dependency is missing or an update breaks a dependent
     */
    public List<Installation> install(List<Request> requests) {
        if (requests.isEmpty()) {
            throw new InvalidInputException(List.of("installations is empty"));
        }
        List<Prepared> prepared = new ArrayList<>();
        try {
            for (Request request : requests) {
                URI uri = catalogUri(request.source());
                ExtensionIndex.Entry entry = offered(uri, request);
                prepared.add(prepare(download(uri, request, entry), Optional.of(entry)));
            }
            List<Installation> installations = place(prepared);
            for (int i = 0; i < requests.size(); i++) {
                Installation installation = installations.get(i);
                LOG.infof(
                        "Extension %s %s installed from %s%s",
                        installation.id(),
                        installation.version(),
                        requests.get(i).source(),
                        installation.restartRequired() ? "; restart to use it" : "");
            }
            return installations;
        } finally {
            prepared.forEach(candidate -> delete(candidate.work()));
        }
    }

    private URI catalogUri(String source) {
        return catalogs.stream()
                .filter(catalog -> catalog.toString().equals(source))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("No catalog " + source + " is configured."));
    }

    private ExtensionIndex.Entry offered(URI uri, Request request) {
        Catalog catalog = read(uri);
        if (catalog.source().keyId() == null) {
            throw new ServiceUnavailableException("The catalog " + request.source() + " cannot be used: "
                    + catalog.source().error());
        }
        return catalog.entries().stream()
                .filter(candidate -> candidate.id().equals(request.id())
                        && candidate.version().equals(request.version()))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("The catalog " + request.source() + " does not offer "
                        + request.id() + " " + request.version() + "."));
    }

    private byte[] download(URI uri, Request request, ExtensionIndex.Entry entry) {
        byte[] bytes;
        try {
            bytes = sources.read(uri, entry.file(), maxBytes);
        } catch (IOException e) {
            throw new ServiceUnavailableException("The package cannot be downloaded: " + e.getMessage());
        }
        if (bytes.length != entry.size() || !sha256(bytes).equals(entry.sha256())) {
            throw new ForbiddenOperationException("The package of " + entry.id() + " " + entry.version()
                    + " does not match the signed index of " + request.source() + ".");
        }
        return bytes;
    }

    /** Places a package uploaded by an administrator, for an installation without network. */
    public Installation upload(byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            throw new InvalidInputException(List.of("package is empty"));
        }
        if (bytes.length > maxBytes) {
            throw new InvalidInputException(List.of("package is larger than " + maxBytes + " bytes"));
        }
        Prepared prepared = prepare(bytes, Optional.empty());
        try {
            return place(List.of(prepared)).getFirst();
        } finally {
            delete(prepared.work());
        }
    }

    /** A package verified and read in its scratch directory, ready to be placed. */
    private record Prepared(Path work, Path candidate, String keyId, InstalledExtension extension) {

        ExtensionManifest manifest() {
            return extension.manifest().orElseThrow();
        }
    }

    private Prepared prepare(byte[] bytes, Optional<ExtensionIndex.Entry> expected) {
        Path work = null;
        try {
            // An installation may have lost its empty extensions directory (an archive, a copy).
            work = Files.createTempDirectory(Files.createDirectories(registry.directory()), INSTALLING);
            Path candidate = Files.write(work.resolve("candidate.zip"), bytes);
            PackageTrust trust = registry.trust();
            String keyId = verified(candidate, trust);
            InstalledExtension extension = inspect(candidate, work, trust);
            String version = extension.manifest().orElseThrow().version().toString();
            expected.ifPresent(entry -> {
                if (!entry.id().equals(extension.key()) || !entry.version().equals(version)) {
                    throw new ForbiddenOperationException("The package is " + extension.key() + " " + version + ", not "
                            + entry.id() + " " + entry.version() + " as the index says.");
                }
            });
            Prepared prepared = new Prepared(work, candidate, keyId, extension);
            work = null;
            return prepared;
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot install the package", e);
        } finally {
            delete(work);
        }
    }

    private List<Installation> place(List<Prepared> prepared) {
        List<ExtensionManifest> manifests =
                prepared.stream().map(Prepared::manifest).toList();
        Set<String> ids = new HashSet<>();
        for (ExtensionManifest manifest : manifests) {
            if (!ids.add(manifest.id())) {
                throw new InvalidInputException(List.of("installations name " + manifest.id() + " more than once"));
            }
        }
        // A required dependency missing or out of its range, or an update that leaves a dependent
        // out of its range, is refused before anything is placed (MK-132).
        // The directory as it is now: packages placed before a restart count as installed.
        List<InstalledExtension> found = registry.scan();
        List<String> unmet = ExtensionDependencies.installed(found).refuseInstallation(manifests);
        if (!unmet.isEmpty()) {
            throw new ConflictException("Cannot install: " + String.join("; ", unmet) + ".");
        }
        // The installation holds one version of each library (MK-131): a library that the kernel, an
        // extension that stays or another extension of the operation has in another version is
        // refused, naming the library and both versions.
        List<String> conflicts = LibraryConflicts.of(manifests, found, KernelLibraries.ofKernel());
        if (!conflicts.isEmpty()) {
            throw new ConflictException("Cannot install: " + String.join("; ", conflicts) + ".");
        }
        // A contribution that does not match the schema of the point it targets, or an implementation
        // of a version of a contract that its owner does not serve, is refused (MK-134).
        List<String> broken = ContractChecks.refuseInstallation(
                manifests,
                found.stream()
                        .filter(extension -> extension.status() != ExtensionStatus.INVALID)
                        .flatMap(extension -> extension.manifest().stream())
                        .toList());
        if (!broken.isEmpty()) {
            throw new ConflictException("Cannot install: " + String.join("; ", broken) + ".");
        }
        // An update that removes a resource type or a level on which grants exist is refused,
        // naming them (MK-055, ADR-0037).
        for (ExtensionManifest manifest : manifests) {
            installedManifest(manifest.id()).ifPresent(current -> sharing.refuseRemovals(current, manifest));
        }
        try {
            List<String> replaced = new ArrayList<>();
            List<String> files = new ArrayList<>();
            for (Prepared candidate : prepared) {
                ExtensionManifest manifest = candidate.manifest();
                replaced.add(setAside(manifest.id(), found));
                String file = packageFile(manifest.id(), manifest.version().toString());
                Files.copy(
                        candidate.candidate(), registry.directory().resolve(file), StandardCopyOption.REPLACE_EXISTING);
                files.add(file);
            }
            // Without Java code nor a schema, nothing has to be built or migrated (ADR-0031): the
            // extension takes effect at once.
            if (prepared.stream().anyMatch(candidate -> !needsRestart(candidate.extension()))) {
                registry.reload();
                sharing.refresh(registry.active());
            }
            List<Installation> installations = new ArrayList<>();
            for (int i = 0; i < prepared.size(); i++) {
                Prepared candidate = prepared.get(i);
                boolean restart = needsRestart(candidate.extension());
                installations.add(new Installation(
                        candidate.extension().key(),
                        candidate.manifest().version().toString(),
                        files.get(i),
                        replaced.get(i),
                        candidate.keyId(),
                        restart ? problemsAtInspection(candidate.extension()) : problemsAfterReload(candidate),
                        restart));
            }
            return installations;
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot install the package", e);
        }
    }

    /**
     * What the kernel will report at start, as read alone in its scratch directory: without the
     * requirements, which were checked against the installation and are met.
     */
    private static List<String> problemsAtInspection(InstalledExtension extension) {
        if (extension.status() == ExtensionStatus.ACTIVE) {
            return List.of();
        }
        Set<String> alone = ExtensionDependencies.of(List.of())
                .unmet(extension.manifest().orElseThrow())
                .stream()
                .map(ExtensionDependencies.Unmet::toString)
                .collect(Collectors.toSet());
        return extension.problems().stream()
                .filter(problem -> !alone.contains(problem))
                .toList();
    }

    /** What the kernel found for an extension it read again, rather than an activation that did not happen. */
    private List<String> problemsAfterReload(Prepared candidate) {
        String id = candidate.extension().key();
        String version = candidate.manifest().version().toString();
        if (registry.findActive(id).isPresent()) {
            LOG.infof("Extension %s %s is active without a restart", id, version);
            return List.of();
        }
        List<String> problems = registry.all().stream()
                .filter(found -> found.key().equals(id))
                .flatMap(found -> found.problems().stream())
                .toList();
        if (problems.isEmpty()) {
            problems = List.of("the kernel did not activate it: see the Extensions page");
        }
        LOG.warnf("Extension %s %s is installed but not active: %s", id, version, problems);
        return problems;
    }

    private Optional<ExtensionManifest> installedManifest(String id) {
        return registry.all().stream()
                .filter(installed -> installed.key().equals(id))
                .flatMap(installed -> installed.manifest().stream())
                .findFirst();
    }

    /**
     * Removes an installed extension: its package goes to {@code extensions/.previous}, and the
     * extension stops at once when it has neither Java code nor a schema, otherwise at the next
     * start. Its database schema and its data are kept. Refused while an extension that runs requires
     * it, naming those extensions; those that use it optionally stay active (MK-132).
     *
     * @throws ResourceNotFoundException when no extension with that id is installed
     * @throws ConflictException when an extension requires it, or it is installed as a directory
     */
    public Removal remove(String id) {
        List<InstalledExtension> found = registry.scan();
        InstalledExtension current = found.stream()
                .filter(extension ->
                        extension.key().equals(id) && extension.manifest().isPresent())
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("No extension " + id + " is installed."));
        List<String> problems = ExtensionDependencies.running(found).refuseRemoval(List.of(id));
        if (!problems.isEmpty()) {
            throw new ConflictException(
                    "Cannot remove " + id + ": " + String.join("; ", problems) + ". Remove or update them first.");
        }
        String file;
        try {
            file = setAside(id, found);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot remove the package", e);
        }
        boolean restart = needsRestart(current);
        if (!restart) {
            registry.reload();
            sharing.refresh(registry.active());
        }
        String version = current.manifest().orElseThrow().version().toString();
        LOG.infof("Extension %s %s removed%s", id, version, restart ? "; restart to stop it" : "");
        return new Removal(id, version, file, restart);
    }

    private static String verified(Path candidate, PackageTrust trust) throws IOException {
        try {
            PackageVerification verification = PackageSignatures.verify(candidate, trust.trustedKeys());
            if (verification instanceof PackageVerification.Verified(String keyId)) {
                return keyId;
            }
            throw new ForbiddenOperationException(
                    "Only packages signed by a trusted publisher can be installed from the marketplace: "
                            + (verification instanceof PackageVerification.UnknownKey(String keyId)
                                    ? "the key " + keyId + " is not trusted"
                                    : "the package is not signed")
                            + ".");
        } catch (PackageSignatureException e) {
            throw new ForbiddenOperationException("Refused package: " + e.getMessage());
        }
    }

    /** Reads the package like the kernel at start, alone in a scratch directory. */
    private InstalledExtension inspect(Path candidate, Path work, PackageTrust trust) throws IOException {
        Path extensions = Files.createDirectories(work.resolve("extensions"));
        Files.copy(candidate, extensions.resolve("candidate.zip"));
        List<InstalledExtension> found = new ExtensionCatalog(registry.kernelVersion(), BackendCheck.jarExists(), trust)
                .scan(extensions, work.resolve("packages"));
        InstalledExtension extension = found.getFirst();
        if (extension.status() == ExtensionStatus.INVALID
                || extension.manifest().isEmpty()) {
            throw new InvalidInputException(extension.problems().stream()
                    .map(problem -> "package " + problem)
                    .toList());
        }
        return extension;
    }

    /** Moves the package of an installed extension to {@code extensions/.previous}; returns its name. */
    private String setAside(String id, List<InstalledExtension> installed) throws IOException {
        Optional<InstalledExtension> current = installed.stream()
                .filter(extension -> extension.key().equals(id))
                .findFirst();
        if (current.isEmpty()) {
            return null;
        }
        Path directory = current.get().directory();
        if (!directory.startsWith(registry.packagesDirectory())) {
            throw new ConflictException(
                    id
                            + " is installed as a directory, not as a package: replace it by hand in the extensions directory.");
        }
        Path zip = registry.directory().resolve(directory.getFileName() + ".zip");
        if (!Files.isRegularFile(zip)) {
            return null;
        }
        Path previous = Files.createDirectories(registry.directory().resolve(PREVIOUS));
        Files.move(zip, previous.resolve(zip.getFileName()), StandardCopyOption.REPLACE_EXISTING);
        return zip.getFileName().toString();
    }

    private Catalog read(URI uri) {
        try {
            byte[] index = sources.read(uri, ExtensionIndex.INDEX_FILE, maxBytes);
            byte[] signature = sources.read(uri, ExtensionIndex.SIGNATURE_FILE, 64L * 1024);
            String keyId =
                    ExtensionIndex.verify(index, signature, registry.trust().trustedKeys());
            return new Catalog(new CatalogView.Source(uri.toString(), "verified", keyId, null), entries(index));
        } catch (IOException | PackageSignatureException | IllegalArgumentException e) {
            return new Catalog(new CatalogView.Source(uri.toString(), "refused", null, e.getMessage()), List.of());
        }
    }

    private List<ExtensionIndex.Entry> entries(byte[] index) throws IOException {
        JsonNode tree = json.readTree(index);
        if (tree.path("format").asInt() != ExtensionIndex.FORMAT) {
            throw new IOException("Unsupported index format " + tree.path("format"));
        }
        return tree.path("extensions")
                .valueStream()
                .map(extension -> new ExtensionIndex.Entry(
                        extension.path("id").asText(),
                        extension.path("version").asText(),
                        extension.path("name").asText(null),
                        extension.path("file").asText(),
                        extension.path("sha256").asText(),
                        extension.path("size").asLong(),
                        extension.path("publisherKey").asText("")))
                .toList();
    }

    private Map<String, String> installedVersions() {
        return registry.all().stream()
                .filter(extension -> extension.manifest().isPresent())
                .collect(Collectors.toMap(
                        InstalledExtension::key,
                        extension ->
                                extension.manifest().orElseThrow().version().toString(),
                        (first, second) -> first));
    }

    /**
     * A catalog directory as an absolute URI: a relative path ({@code catalog/} or {@code
     * file:catalog/}) is a directory of the installation, the working directory of the kernel, as for
     * {@code mosaikit.extensions.directory}; other URIs stay as they are.
     */
    static URI located(URI source) {
        String scheme = source.getScheme();
        String path = scheme == null
                ? source.getPath()
                : "file".equalsIgnoreCase(scheme) && source.isOpaque() ? source.getSchemeSpecificPart() : null;
        if (path == null) {
            return source;
        }
        URI absolute = Path.of(path).toAbsolutePath().normalize().toUri();
        return absolute.toString().endsWith("/") ? absolute : URI.create(absolute + "/");
    }

    /** Whether an extension needs the restart of the kernel: Java code to build or a schema to migrate. */
    static boolean needsRestart(InstalledExtension extension) {
        return extension
                .manifest()
                .map(manifest ->
                        manifest.backend().isPresent() || manifest.database().isPresent())
                .orElse(true);
    }

    /** The name of the package of an extension version in the extensions directory. */
    static String packageFile(String id, String version) {
        return SAFE_NAME.matcher(id + "-" + version).replaceAll("_") + ".zip";
    }

    /** How an offered version compares with the installed one. */
    static String state(String offered, String installed) {
        if (installed == null) {
            return "available";
        }
        try {
            int comparison = Version.parse(offered).compareTo(Version.parse(installed));
            if (comparison == 0) {
                return "installed";
            }
            return comparison > 0 ? "update" : "older";
        } catch (IllegalArgumentException _) {
            return offered.equals(installed) ? "installed" : "update";
        }
    }

    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is part of every Java platform", e);
        }
    }

    private static void delete(Path directory) {
        if (directory == null) {
            return;
        }
        try (Stream<Path> files = Files.walk(directory)) {
            files.sorted(Comparator.reverseOrder()).forEach(Marketplace::deleteFile);
        } catch (IOException e) {
            LOG.debugf("Cannot delete %s: %s", directory, e.getMessage());
        }
    }

    static void deleteFile(Path path) {
        try {
            Files.delete(path);
        } catch (IOException e) {
            LOG.debugf("Cannot delete %s: %s", path, e.getMessage());
        }
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import dev.mosaikit.kernel.api.plugin.BackendEntry;
import dev.mosaikit.kernel.api.plugin.ManifestParseResult;
import dev.mosaikit.kernel.api.plugin.ManifestViolation;
import dev.mosaikit.kernel.api.plugin.PluginManifest;
import dev.mosaikit.kernel.api.plugin.PluginManifests;
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

/**
 * Reads the plugins of an installation directory and decides which ones can be activated.
 *
 * <p>Each plugin lives in its own sub-directory with a {@code manifest.yaml} at its root, or in a
 * package ({@code <name>.zip}, see {@link PluginPackages}) with the same content. A
 * plugin is active when its manifest is valid, its platform range includes the kernel version and
 * every plugin it requires is active in an accepted version. Requirements are resolved until no
 * status changes, so that a plugin missing a requirement also disables the plugins that require
 * it.
 *
 * <p>A plugin that brings Java code is active only when its {@link BackendCheck} accepts the
 * declared JAR: the kernel accepts the JARs loaded by the launcher, the launcher every JAR that
 * exists. Both use this class, so that they always agree on which plugins can run.
 *
 * <p>The class has no framework dependency and is safe to use from tests and tools.
 */
public final class PluginCatalog {

    /** File name of the manifest at the root of each plugin. */
    public static final String MANIFEST_FILE = "manifest.yaml";

    private static final TypeReference<Map<String, Object>> TREE = new TypeReference<>() {};

    private final ObjectMapper yaml = new ObjectMapper(new YAMLFactory());
    private final Version kernelVersion;
    private final BackendCheck backendCheck;
    private final PackageTrust trust;

    /**
     * Creates a catalog that accepts every declared backend JAR that exists.
     *
     * @param kernelVersion version of the running kernel; pre-release and build metadata are
     *     ignored when checking platform ranges, so that snapshots behave like their release
     */
    public PluginCatalog(Version kernelVersion) {
        this(kernelVersion, BackendCheck.jarExists());
    }

    /**
     * @param kernelVersion version of the running kernel, see {@link #PluginCatalog(Version)}
     * @param backendCheck decides whether the Java code of a plugin can be used
     */
    public PluginCatalog(Version kernelVersion, BackendCheck backendCheck) {
        this(kernelVersion, backendCheck, PackageTrust.none());
    }

    /**
     * @param kernelVersion version of the running kernel, see {@link #PluginCatalog(Version)}
     * @param backendCheck decides whether the Java code of a plugin can be used
     * @param trust the keys of trusted publishers and whether signatures are required (MK-013)
     */
    public PluginCatalog(Version kernelVersion, BackendCheck backendCheck, PackageTrust trust) {
        this.kernelVersion =
                Objects.requireNonNull(kernelVersion, "kernelVersion").core();
        this.backendCheck = Objects.requireNonNull(backendCheck, "backendCheck");
        this.trust = Objects.requireNonNull(trust, "trust");
    }

    /**
     * Scans a directory and returns every plugin found, sorted by key. Packages ({@code *.zip}) are
     * unpacked into {@code <directory>/.packages}; see {@link #scan(Path, Path)}.
     */
    public List<InstalledPlugin> scan(Path directory) {
        return scan(directory, directory.resolve(".packages"));
    }

    /**
     * Scans a directory and returns every plugin found, sorted by key: each sub-directory is a
     * plugin, and so is each package ({@code *.zip}), unpacked into the work directory.
     * Directories whose name starts with a dot are ignored.
     */
    public List<InstalledPlugin> scan(Path directory, Path packagesDirectory) {
        if (!Files.isDirectory(directory)) {
            return List.of();
        }
        List<InstalledPlugin> found = new ArrayList<>();
        try (Stream<Path> children = Files.list(directory)) {
            children.filter(child -> !child.getFileName().toString().startsWith("."))
                    .sorted()
                    .forEach(child -> {
                        if (Files.isDirectory(child)) {
                            found.add(readDirectory(child));
                        } else if (PluginPackages.isPackage(child)) {
                            found.add(readPackage(child, packagesDirectory));
                        }
                    });
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot list plugins in " + directory, e);
        }
        return resolve(markDuplicates(found));
    }

    private InstalledPlugin readDirectory(Path directory) {
        if (trust.signaturesRequired()) {
            return invalid(
                    directory.getFileName().toString(),
                    directory,
                    List.of(
                            "Only signed packages are accepted (mosaikit.plugins.signatures=required), not directories"));
        }
        return read(directory);
    }

    private InstalledPlugin readPackage(Path zip, Path packagesDirectory) {
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
                    name, zip, List.of("Refused package: " + reason + " (mosaikit.plugins.signatures=required)"));
        }
        InstalledPlugin plugin;
        try {
            plugin = read(PluginPackages.unpack(zip, packagesDirectory));
        } catch (IOException | UncheckedIOException e) {
            return invalid(name, zip, List.of("Unreadable package: " + firstLine(e.getMessage())));
        }
        return verification instanceof PackageVerification.Verified(String keyId) ? plugin.verifiedBy(keyId) : plugin;
    }

    private InstalledPlugin read(Path directory) {
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
        return switch (PluginManifests.parse(tree)) {
            case ManifestParseResult.Valid(PluginManifest manifest) -> checkPlatform(manifest, directory);
            case ManifestParseResult.Invalid(List<ManifestViolation> violations) ->
                invalid(
                        fallbackKey,
                        directory,
                        violations.stream()
                                .map(violation -> violation.field() + ": " + violation.message())
                                .toList());
        };
    }

    private InstalledPlugin checkPlatform(PluginManifest manifest, Path directory) {
        if (!manifest.supportsPlatform(kernelVersion)) {
            return new InstalledPlugin(
                    manifest.id(),
                    directory,
                    Optional.of(manifest),
                    PluginStatus.INCOMPATIBLE,
                    List.of("Requires kernel " + manifest.platform() + ", running " + kernelVersion));
        }
        Optional<BackendCheck.Problem> backendProblem =
                manifest.backend().flatMap(backend -> backendCheck.check(manifest, directory.resolve(backend.jar())));
        if (backendProblem.isPresent()) {
            return new InstalledPlugin(
                    manifest.id(),
                    directory,
                    Optional.of(manifest),
                    backendProblem.get().status(),
                    List.of(backendProblem.get().message()));
        }
        return new InstalledPlugin(manifest.id(), directory, Optional.of(manifest), PluginStatus.ACTIVE, List.of());
    }

    /** Keeps the first of two plugins with the same id or the same API name. */
    private static List<InstalledPlugin> markDuplicates(List<InstalledPlugin> plugins) {
        Set<String> seen = new HashSet<>();
        Map<String, String> apis = new HashMap<>();
        List<InstalledPlugin> result = new ArrayList<>();
        for (InstalledPlugin plugin : plugins) {
            Optional<String> api =
                    plugin.manifest().flatMap(PluginManifest::backend).map(BackendEntry::api);
            if (plugin.manifest().isPresent() && !seen.add(plugin.key())) {
                result.add(invalid(
                        plugin.key(),
                        plugin.directory(),
                        List.of("Duplicate plugin id, already installed in another directory")));
            } else if (api.isPresent() && apis.containsKey(api.get())) {
                result.add(invalid(
                        plugin.key(),
                        plugin.directory(),
                        List.of("API name '" + api.get() + "' is already used by " + apis.get(api.get()))));
            } else {
                api.ifPresent(name -> apis.put(name, plugin.key()));
                result.add(plugin);
            }
        }
        return result;
    }

    /** Disables plugins whose requirements are not active, until a fixed point is reached. */
    private static List<InstalledPlugin> resolve(List<InstalledPlugin> plugins) {
        List<InstalledPlugin> current = plugins;
        boolean changed = true;
        while (changed) {
            Map<String, PluginManifest> active = new HashMap<>();
            current.stream()
                    .filter(InstalledPlugin::isActive)
                    .forEach(
                            plugin -> active.put(plugin.key(), plugin.manifest().orElseThrow()));
            List<InstalledPlugin> next = current.stream()
                    .map(plugin -> checkRequirements(plugin, active))
                    .toList();
            changed = !next.equals(current);
            current = next;
        }
        return current.stream()
                .sorted(Comparator.comparing(InstalledPlugin::key))
                .toList();
    }

    private static InstalledPlugin checkRequirements(InstalledPlugin plugin, Map<String, PluginManifest> active) {
        if (!plugin.isActive()) {
            return plugin;
        }
        PluginManifest manifest = plugin.manifest().orElseThrow();
        List<String> problems = new ArrayList<>();
        manifest.requires().forEach((required, range) -> {
            PluginManifest provider = active.get(required);
            if (provider == null) {
                problems.add("Requires plugin " + required + " " + range + ", which is not active");
            } else if (!range.contains(provider.version())) {
                problems.add("Requires plugin " + required + " " + range + ", found " + provider.version());
            }
        });
        if (problems.isEmpty()) {
            return plugin;
        }
        return new InstalledPlugin(
                plugin.key(),
                plugin.directory(),
                plugin.manifest(),
                PluginStatus.INCOMPATIBLE,
                problems,
                plugin.publisherKey());
    }

    private static String firstLine(String message) {
        if (message == null) {
            return "unknown error";
        }
        int newline = message.indexOf('\n');
        return newline < 0 ? message : message.substring(0, newline);
    }

    private static InstalledPlugin invalid(String key, Path directory, List<String> problems) {
        return new InstalledPlugin(key, directory, Optional.empty(), PluginStatus.INVALID, problems);
    }
}

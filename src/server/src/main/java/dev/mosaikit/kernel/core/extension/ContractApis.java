// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import dev.mosaikit.kernel.api.extension.LibraryEntry;
import dev.mosaikit.kernel.api.version.InvalidVersionException;
import dev.mosaikit.kernel.api.version.Version;
import java.util.Optional;

/**
 * The rule for the API artifacts of contracts between extensions (MK-134), next to the one for
 * libraries (MK-131). The kernel holds one copy of each library, in one version; the API artifact of a
 * contract follows semantic versions, so the copies that several extensions bring in the same major
 * version are compatible, and the highest one is loaded. Different major versions still conflict: a
 * contract publishes a breaking change as a new interface next to the old one, and the major version
 * of its artifact changes only when an old interface is retired.
 */
public final class ContractApis {

    private ContractApis() {}

    /**
     * Whether two copies of a library can be held as one.
     *
     * @param api whether either extension declares the library as the API artifact of a contract
     */
    public static boolean compatible(LibraryEntry library, LibraryEntry other, boolean api) {
        if (library.version().equals(other.version())) {
            return library.sha256().equals(other.sha256());
        }
        if (!api) {
            return false;
        }
        Optional<Version> version = version(library);
        Optional<Version> otherVersion = version(other);
        return version.isPresent()
                && otherVersion.isPresent()
                && version.get().major() == otherVersion.get().major();
    }

    /** Whether {@code loaded} stands for {@code wanted}: the same JAR, or a higher compatible version of an API. */
    public static boolean satisfies(LibraryEntry loaded, LibraryEntry wanted, boolean api) {
        if (!loaded.key().equals(wanted.key()) || !compatible(loaded, wanted, api)) {
            return false;
        }
        return loaded.version().equals(wanted.version()) || highest(wanted, loaded) == loaded;
    }

    /** The higher of two compatible copies, the one the kernel loads; the first when they are equal. */
    public static LibraryEntry highest(LibraryEntry library, LibraryEntry other) {
        Optional<Version> version = version(library);
        Optional<Version> otherVersion = version(other);
        if (version.isEmpty() || otherVersion.isEmpty()) {
            return library;
        }
        return otherVersion.get().compareTo(version.get()) > 0 ? other : library;
    }

    /** Why the kernel refuses an API artifact that another extension brings in another major version. */
    public static String conflict(LibraryEntry library, LibraryEntry other, String extensionId) {
        return "API artifact " + library.key() + " " + library.version() + " conflicts with version "
                + other.version() + " brought by extension " + extensionId
                + ": the major version of an API artifact changes only when its contract retires an old"
                + " version, so update the extensions that bring it together";
    }

    /** Why two copies of a library cannot be held as one, as an API artifact or as a plain library. */
    public static String conflict(LibraryEntry library, LibraryEntry other, String extensionId, boolean api) {
        return api && !library.version().equals(other.version())
                ? conflict(library, other, extensionId)
                : ExtensionCatalog.conflictWithExtension(library, other, extensionId);
    }

    private static Optional<Version> version(LibraryEntry library) {
        try {
            return Optional.of(Version.parse(library.version()));
        } catch (InvalidVersionException _) {
            return Optional.empty();
        }
    }
}

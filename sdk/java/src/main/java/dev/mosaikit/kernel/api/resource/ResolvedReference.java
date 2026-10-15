// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.resource;

import java.util.Objects;

/**
 * What a reference to a resource resolves to (MK-135): the resource, or why it is not available to
 * the person of the request. The reference itself is never changed.
 *
 * @param target the referred resource, as the referring extension keeps it
 * @param availability whether the resource is available, or why not
 * @param resource the entry of the resource when it is {@link Availability#AVAILABLE available},
 *     otherwise {@code null}: of a resource the person may not read the kernel tells nothing more
 */
public record ResolvedReference(ResourceRef target, Availability availability, Resource resource) {

    /** Whether the referred resource is available, or why not. */
    public enum Availability {
        /** The person may read the resource, and {@link ResolvedReference#resource()} is its entry. */
        AVAILABLE,
        /**
         * The extension of the resource is not active in the organization: not installed, not
         * compatible, or turned off by the organization. The reference works again when it comes
         * back.
         */
        EXTENSION_ABSENT,
        /** The extension is active, but the resource is not registered: it was deleted. */
        DELETED,
        /** The resource exists, but the person has no level on it. */
        FORBIDDEN
    }

    /**
     * Checks the parts.
     *
     * @throws IllegalArgumentException when the entry is missing for an available resource, given
     *     for another availability, or of another resource
     */
    public ResolvedReference {
        Objects.requireNonNull(target, "target");
        Objects.requireNonNull(availability, "availability");
        if ((availability == Availability.AVAILABLE) != (resource != null)) {
            throw new IllegalArgumentException("only an available reference carries its resource");
        }
        if (resource != null && !resource.ref().equals(target)) {
            throw new IllegalArgumentException("the resource is not the one referred to");
        }
    }

    /** An available resource. */
    public static ResolvedReference available(Resource resource) {
        Objects.requireNonNull(resource, "resource");
        return new ResolvedReference(resource.ref(), Availability.AVAILABLE, resource);
    }

    /** A resource that is not available, and why. */
    public static ResolvedReference unavailable(ResourceRef target, Availability why) {
        return new ResolvedReference(target, why, null);
    }

    /** Whether the person may read the referred resource. */
    public boolean isAvailable() {
        return availability == Availability.AVAILABLE;
    }
}

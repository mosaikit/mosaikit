// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.resource;

import java.util.Objects;
import java.util.UUID;

/**
 * A resource as the kernel knows it (MK-054): its reference, the organization it belongs to, the
 * person who owns it, and what the generic features of the kernel (sharing, favorites, trash,
 * search) need to show it and open it. The data of the resource stay in the extension.
 *
 * <p>A resource registered without a person, by a job, an import or a migration, is owned by the
 * <strong>organization</strong>: it has no {@link #owner()}, and the administrators of the
 * organization manage it, as they manage every resource of their organization.
 *
 * @param ref the extension, type and identifier of the resource
 * @param organization the organization the resource belongs to; it never changes
 * @param owner the account of the person who owns the resource, who has every level on it, or
 *     {@code null} when the organization owns it
 * @param title what people see in the lists and dialogs of the kernel
 * @param link where the resource opens, a path of the shell such as {@code /app/dashboards/42}
 * @param parent the resource that contains this one, such as a folder or a project, or {@code null};
 *     grants on the parent do not extend to it
 */
public record Resource(ResourceRef ref, UUID organization, UUID owner, String title, String link, ResourceRef parent) {

    /** The longest title of a resource. */
    public static final int MAX_TITLE = 200;

    /** The longest link of a resource. */
    public static final int MAX_LINK = 2000;

    /**
     * Checks the entry.
     *
     * @throws IllegalArgumentException when the title or the link are not valid, or the resource is
     *     its own parent
     */
    public Resource {
        Objects.requireNonNull(ref, "ref");
        Objects.requireNonNull(organization, "organization");
        title = checkTitle(title);
        checkLink(link);
        checkParent(ref, parent);
    }

    /** Whether the organization owns the resource, which then has no person as its owner. */
    public boolean ownedByOrganization() {
        return owner == null;
    }

    static String checkTitle(String title) {
        Objects.requireNonNull(title, "title");
        String trimmed = title.strip();
        if (trimmed.isEmpty() || trimmed.length() > MAX_TITLE) {
            throw new IllegalArgumentException("title must have 1 to " + MAX_TITLE + " characters");
        }
        return trimmed;
    }

    static void checkLink(String link) {
        Objects.requireNonNull(link, "link");
        if (!link.startsWith("/")
                || link.startsWith("//")
                || link.length() > MAX_LINK
                || link.chars().anyMatch(c -> c <= ' ' || c == '\\')) {
            throw new IllegalArgumentException("link must be a path of the shell, such as /app/dashboards/42");
        }
    }

    static void checkParent(ResourceRef ref, ResourceRef parent) {
        if (ref.equals(parent)) {
            throw new IllegalArgumentException("a resource cannot be its own parent");
        }
    }
}

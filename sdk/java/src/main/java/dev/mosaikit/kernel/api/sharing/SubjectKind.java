// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.sharing;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/**
 * The kinds of {@link Subject} a resource can be shared with (MK-055). A resource type lists in its
 * manifest the kinds it accepts, in {@code subjects}; without it, {@link #DEFAULT}.
 */
public enum SubjectKind {
    /** One person of the organization. */
    PERSON,
    /** A group of the organization: a team and its people (MK-032). */
    GROUP,
    /** Every member of the organization, guests excluded. */
    ORGANIZATION,
    /** Anyone who has a link, until it expires or is revoked. */
    LINK,
    /** Anyone, also without an account. */
    PUBLIC;

    /**
     * The kinds a resource type accepts when its manifest does not say: people, groups and the
     * organization. Links and the public are opt-in, as they reach people outside the organization.
     */
    public static final Set<SubjectKind> DEFAULT = Set.of(PERSON, GROUP, ORGANIZATION);

    /** Value as written in manifests. */
    public String value() {
        return name().toLowerCase(Locale.ROOT);
    }

    /** The kind written in a manifest as {@code value}, if any. */
    public static Optional<SubjectKind> fromValue(String value) {
        return Arrays.stream(values())
                .filter(kind -> kind.value().equals(value))
                .findFirst();
    }
}

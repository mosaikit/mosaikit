// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * A personal access key in the settings of its person (MK-060); never its secret, except once in
 * the answer to its creation.
 *
 * @param prefix the first characters of the key, to tell it apart
 * @param organization the slug of the organization the key acts on
 * @param write whether the key may change anything, or only read
 * @param lastUsedAt when it was last used, to the minute, or {@code null}
 * @param expired whether it is past its expiry
 * @param secret the whole key, only in the answer to its creation
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AccessKeyView(
        UUID id,
        String name,
        String prefix,
        UUID organizationId,
        String organization,
        boolean write,
        Instant createdAt,
        @JsonInclude(JsonInclude.Include.ALWAYS) Instant lastUsedAt,
        Instant expiresAt,
        boolean expired,
        String secret) {

    static AccessKeyView of(AccessKey key, String slug, Instant now, String secret) {
        return new AccessKeyView(
                key.getId(),
                key.getName(),
                key.getPrefix(),
                key.getOrganizationId(),
                slug,
                key.canWrite(),
                key.getCreatedAt(),
                key.getLastUsedAt().orElse(null),
                key.getExpiresAt(),
                !key.getExpiresAt().isAfter(now),
                secret);
    }

    @Override
    public String toString() {
        return "AccessKeyView[id=" + id + ", prefix=" + prefix + "]";
    }

    /**
     * The keys of a person, with the longest a new key may last.
     *
     * @param maxValidityDays the longest a new key may last, in days
     */
    public record Keys(long maxValidityDays, List<AccessKeyView> keys) {}

    /**
     * What a person asks for when they create a key.
     *
     * @param organization the slug of the organization the key acts on; that of the request when
     *     absent
     * @param expiresAt when the key stops working; the longest the installation allows when absent
     * @param write whether the key may change anything; it only reads when absent
     */
    public record Request(String name, String organization, Instant expiresAt, Boolean write) {}

    /**
     * What a service learns of a key it received (MK-060).
     *
     * @param account the person the key acts for
     * @param organization the organization it acts on
     * @param roles the roles of the person in that organization now
     */
    public record Validation(
            UUID id,
            String name,
            String prefix,
            boolean write,
            Instant expiresAt,
            Person account,
            Place organization,
            List<String> roles) {}

    /** The person of a key. */
    public record Person(UUID id, String username, String displayName) {}

    /** The organization of a key. */
    public record Place(UUID id, String slug) {}

    static List<String> sorted(Set<String> roles) {
        return roles.stream().sorted().toList();
    }
}

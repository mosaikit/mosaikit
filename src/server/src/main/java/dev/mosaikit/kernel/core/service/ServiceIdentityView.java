// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.service;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A service identity as platform administrators see it (MK-124); never the secret of a key, except
 * once in the answer to its creation.
 *
 * @param apis the names of the APIs of extensions it may call
 * @param endpoints the endpoints of the kernel meant for services it may call
 * @param organizations the slugs of the organizations it may name with {@code X-Mosaikit-Organization}
 * @param keys its live keys, the newest first
 */
public record ServiceIdentityView(
        UUID id,
        String name,
        String description,
        List<String> apis,
        List<String> endpoints,
        List<String> organizations,
        Instant createdAt,
        String createdBy,
        List<Key> keys) {

    /**
     * A live key of a service identity.
     *
     * @param prefix the first characters of the key, to tell it apart
     * @param lastUsedAt when it was last used, to the hour, or {@code null}
     * @param secret the whole key, only in the answer to its creation
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Key(
            UUID id,
            String prefix,
            Instant createdAt,
            @JsonInclude(JsonInclude.Include.ALWAYS) Instant lastUsedAt,
            String secret) {

        static Key of(ServiceKey key, String secret) {
            return new Key(
                    key.getId(),
                    key.getPrefix(),
                    key.getCreatedAt(),
                    key.getLastUsedAt().orElse(null),
                    secret);
        }

        @Override
        public String toString() {
            return "Key[id=" + id + ", prefix=" + prefix + "]";
        }
    }

    /**
     * The service identities, with what they may be given.
     *
     * @param endpoints the endpoints of the kernel meant for services
     * @param maxKeys the live keys an identity may have
     */
    public record Identities(List<ServiceIdentityView> identities, List<String> endpoints, int maxKeys) {}

    /**
     * What a platform administrator asks for when creating an identity or changing what it may do.
     *
     * @param name the name, unique; only when creating
     * @param apis the names of the APIs of extensions, as in {@code /api/v1/ext/<api>/}
     * @param endpoints {@code check-session} and {@code check-key}, for {@code POST /api/v1/services/check}
     * @param organizations the slugs of the organizations it may name; none when absent
     */
    public record Request(
            String name, String description, List<String> apis, List<String> endpoints, List<String> organizations) {}

    /**
     * What a service asks the kernel to check (MK-124): one of the value of the session cookie of the
     * shell and a personal access key.
     *
     * @param organization the slug of the organization the session acts on, as the shell names it;
     *     ignored for a key, which acts on its own
     */
    public record Check(String session, String key, String organization) {

        @Override
        public String toString() {
            return "Check[organization=" + organization + "]";
        }
    }

    /**
     * What a service learns of the credentials of a person.
     *
     * @param kind {@code session} or {@code key}
     * @param organization the organization the person acts on with them, or {@code null}
     * @param roles the roles of the person there now, and those of the platform for a session
     * @param key the key, when a key was checked
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Checked(
            String kind,
            Person account,
            @JsonInclude(JsonInclude.Include.ALWAYS) Place organization,
            List<String> roles,
            CheckedKey key) {}

    /** The person of checked credentials. */
    public record Person(UUID id, String username, String displayName) {}

    /** The organization of checked credentials. */
    public record Place(UUID id, String slug) {}

    /** A personal access key checked. */
    public record CheckedKey(UUID id, String name, String prefix, boolean write, Instant expiresAt) {}
}

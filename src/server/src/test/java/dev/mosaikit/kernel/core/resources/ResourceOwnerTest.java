// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.resources;

import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ExtensionManifests;
import dev.mosaikit.kernel.api.extension.ManifestParseResult;
import dev.mosaikit.kernel.api.resource.Resource;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.Resources;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Who owns a registered resource (MK-054, ADR-0037): the person of the request, or the organization
 * when the request has no person, as for a job, an import or a migration. The rest of the registry is
 * tested against the database in {@code ResourceRegistryTest}; a request without a person cannot be
 * made over HTTP.
 */
@Tag("MK-054")
class ResourceOwnerTest {

    static final String EXTENSION = "dev.example.notes";
    static final UUID ORGANIZATION = UUID.randomUUID();
    static final ResourceRef NOTE = new ResourceRef(EXTENSION, "note", "n1");

    private final AtomicReference<UUID> person = new AtomicReference<>();
    private final InMemoryEntries entries = new InMemoryEntries();
    private final ResourceRegistry registry = new ResourceRegistry(
            entries,
            id -> id.equals(EXTENSION) ? Optional.of(manifest()) : Optional.empty(),
            List::of,
            organization(),
            () -> Optional.ofNullable(person.get()),
            Clock.fixed(Instant.parse("2026-10-13T10:00:00Z"), ZoneOffset.UTC));

    @Test
    void thePersonOfTheRequestOwnsWhatTheyRegister() {
        UUID ada = UUID.randomUUID();
        person.set(ada);

        Resource note = registry.register(NOTE, Resources.Details.of("Garden", "/app/notes/n1"));

        assertThat(note.owner()).isEqualTo(ada);
        assertThat(note.ownedByOrganization()).isFalse();
        assertThat(note.organization()).isEqualTo(ORGANIZATION);
    }

    @Test
    void theOrganizationOwnsWhatIsRegisteredWithoutAPerson() {
        Resource note = registry.register(NOTE, Resources.Details.of("Imported", "/app/notes/n1"));

        assertThat(note.owner()).isNull();
        assertThat(note.ownedByOrganization()).isTrue();
        assertThat(registry.list(EXTENSION, "note", null))
                .extracting(Resource::title)
                .containsExactly("Imported");
    }

    @Test
    void registeringAgainWithoutAPersonKeepsTheOwner() {
        UUID ada = UUID.randomUUID();
        person.set(ada);
        registry.register(NOTE, Resources.Details.of("Garden", "/app/notes/n1"));
        person.set(null);

        Resource again = registry.register(NOTE, Resources.Details.of("Garden (migrated)", "/app/notes/n1"));

        assertThat(again.owner()).isEqualTo(ada);
        assertThat(again.title()).isEqualTo("Garden (migrated)");
        assertThat(entries.rows).hasSize(1);
    }

    @Test
    void anInstallationWhereNoExtensionIsFoundKeepsItsEntries() {
        registry.register(NOTE, Resources.Details.of("Garden", "/app/notes/n1"));

        // A missing or misconfigured extensions directory must not wipe the registry.
        assertThat(registry.forgetUninstalled(List.of())).isZero();
        assertThat(entries.rows).hasSize(1);
    }

    private static ExtensionManifest manifest() {
        Map<String, Object> tree = new HashMap<>(Map.of(
                "id",
                EXTENSION,
                "version",
                "1.0.0",
                "name",
                "Notes",
                "kind",
                List.of("service"),
                "platform",
                ">=0.1 <1"));
        tree.put(
                "resources",
                List.of(Map.of(
                        "type", "note", "title", "Note", "levels", List.of(Map.of("name", "view", "title", "View")))));
        return ((ManifestParseResult.Valid) ExtensionManifests.parse(tree)).manifest();
    }

    private static CurrentOrganization organization() {
        return new CurrentOrganization() {
            @Override
            public Optional<UUID> id() {
                return Optional.of(ORGANIZATION);
            }

            @Override
            public Optional<String> slug() {
                return Optional.of("acme");
            }
        };
    }

    /** The registry of one organization, in memory. */
    static final class InMemoryEntries implements RegisteredResources {

        final List<RegisteredResource> rows = new ArrayList<>();

        @Override
        public Optional<RegisteredResource> findById(UUID id) {
            return rows.stream().filter(row -> row.getId().equals(id)).findFirst();
        }

        @Override
        public Optional<RegisteredResource> find(UUID organizationId, String extensionId, String type, String refId) {
            return rows.stream()
                    .filter(row -> row.getOrganizationId().equals(organizationId)
                            && row.ref().equals(new ResourceRef(extensionId, type, refId)))
                    .findFirst();
        }

        @Override
        public List<RegisteredResource> list(UUID organizationId, String extensionId, String type) {
            return rows.stream()
                    .filter(row -> row.getOrganizationId().equals(organizationId)
                            && row.getExtensionId().equals(extensionId)
                            && row.getResourceType().equals(type))
                    .toList();
        }

        @Override
        public List<RegisteredResource> listOwnedBy(
                UUID organizationId, String extensionId, String type, UUID ownerId) {
            return list(organizationId, extensionId, type).stream()
                    .filter(row -> ownerId.equals(row.getOwnerId()))
                    .toList();
        }

        @Override
        public List<RegisteredResource> findByIds(UUID organizationId, List<UUID> ids) {
            return rows.stream().filter(row -> ids.contains(row.getId())).toList();
        }

        @Override
        public long reachableBy(UUID organizationId, String extensionId, UUID accountId) {
            throw new UnsupportedOperationException("not used by the registry");
        }

        @Override
        public void insert(RegisteredResource resource) {
            rows.add(resource);
        }

        @Override
        public void update(RegisteredResource resource) {
            // The rows are the entities themselves.
        }

        @Override
        public void delete(RegisteredResource resource) {
            rows.remove(resource);
        }

        @Override
        public int deleteAllExcept(List<String> installed) {
            int before = rows.size();
            rows.removeIf(row -> !installed.contains(row.getExtensionId()));
            return before - rows.size();
        }
    }
}

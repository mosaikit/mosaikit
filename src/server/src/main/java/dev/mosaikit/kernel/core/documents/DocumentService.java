// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.documents;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.live.LiveBus;
import dev.mosaikit.kernel.core.live.LiveEvent;
import dev.mosaikit.kernel.core.teams.TeamService;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.data.Limit;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The collections of documents of extensions without a backend (ADR-0031, MK-046): only an active
 * extension that declares a collection in its manifest has it, and a request reads and writes only the
 * documents of its organization.
 */
@ApplicationScoped
@Transactional
public class DocumentService {

    /** Largest document, as JSON. */
    static final int MAX_BYTES = 256 * 1024;

    /** Most documents of one collection of an organization. */
    static final long MAX_DOCUMENTS = 10_000;

    /** Most documents of one page. */
    static final int MAX_PAGE = 500;

    private final ExtensionDocuments documents;
    private final ExtensionRegistry registry;
    private final RequestOrganization organization;
    private final TeamService teams;
    private final SecurityIdentity identity;
    private final ObjectMapper json;
    private final Clock clock;
    private final LiveBus live;

    @Inject
    public DocumentService(
            ExtensionDocuments documents,
            ExtensionRegistry registry,
            RequestOrganization organization,
            SecurityIdentity identity,
            ObjectMapper json,
            LiveBus live,
            TeamService teams) {
        this(documents, registry, organization, identity, json, live, teams, Clock.systemUTC());
    }

    DocumentService(
            ExtensionDocuments documents,
            ExtensionRegistry registry,
            RequestOrganization organization,
            SecurityIdentity identity,
            ObjectMapper json,
            LiveBus live,
            TeamService teams,
            Clock clock) {
        this.live = live;
        this.teams = teams;
        this.documents = documents;
        this.registry = registry;
        this.organization = organization;
        this.identity = identity;
        this.json = json;
        this.clock = clock;
    }

    /**
     * The documents of a collection, newest first: those of the whole organization, or those shared
     * with a team of the person (MK-032). A guest of the organization has only those of its teams.
     */
    public List<DocumentView> list(String extension, String collection, UUID team, int offset, int limit) {
        UUID org = organization.require();
        declared(extension, collection);
        int size = Math.clamp(limit, 1, MAX_PAGE);
        int start = Math.max(offset, 0);
        Limit page = Limit.range(start + 1L, start + (long) size);
        if (team != null) {
            teams.requireIn(team);
            return documents.listOfTeam(org, extension, collection, team, page).stream()
                    .map(this::view)
                    .toList();
        }
        if (organization.guest()) {
            return List.of();
        }
        return documents.list(org, extension, collection, page).stream()
                .map(this::view)
                .toList();
    }

    public DocumentView get(String extension, String collection, UUID id) {
        return view(find(extension, collection, id));
    }

    /** Adds a document for the whole organization, or shared with a team of the person (MK-032). */
    public DocumentView create(String extension, String collection, UUID team, JsonNode data) {
        UUID org = organization.require();
        declared(extension, collection);
        if (team != null) {
            teams.requireIn(team);
        } else if (organization.guest()) {
            throw new ForbiddenOperationException("A guest shares documents only with their teams.");
        }
        String text = checked(data);
        if (documents.count(org, extension, collection) >= MAX_DOCUMENTS) {
            throw new ConflictException("The collection " + collection + " has " + MAX_DOCUMENTS
                    + " documents already, the most it can hold.");
        }
        ExtensionDocument document =
                new ExtensionDocument(org, extension, collection, team, text, author(), clock.instant());
        documents.insert(document);
        changed(document, "created");
        return view(document);
    }

    /**
     * Replaces a document.
     *
     * @param expectedVersion the version the caller read, or {@code null} to overwrite any version
     */
    public DocumentView replace(String extension, String collection, UUID id, JsonNode data, Integer expectedVersion) {
        ExtensionDocument document = find(extension, collection, id);
        if (expectedVersion != null && expectedVersion != document.getVersion()) {
            throw new ConflictException("The document changed since version " + expectedVersion
                    + ": read it again, it is at version " + document.getVersion() + ".");
        }
        document.replace(checked(data), author(), clock.instant());
        documents.update(document);
        changed(document, "replaced");
        return view(document);
    }

    public void delete(String extension, String collection, UUID id) {
        ExtensionDocument document = find(extension, collection, id);
        documents.delete(document);
        changed(document, "deleted");
    }

    /**
     * Tells the pages that subscribed to the collection, when the transaction commits (MK-031): only
     * which document changed, so that each page reads it again with its own rights; for a document
     * of a team, only to its members (MK-032).
     */
    private void changed(ExtensionDocument document, String action) {
        Map<String, Object> data = new HashMap<>();
        data.put("id", document.getId().toString());
        data.put("action", action);
        if (document.getTeamId() != null) {
            data.put("team", document.getTeamId().toString());
        }
        live.publish(new LiveEvent(
                "documents." + document.getExtensionId() + "." + document.getCollection(),
                organization.require(),
                null,
                document.getTeamId(),
                data));
    }

    private ExtensionDocument find(String extension, String collection, UUID id) {
        UUID org = organization.require();
        declared(extension, collection);
        return documents
                .findById(id)
                .filter(document -> document.getOrganizationId().equals(org)
                        && document.getExtensionId().equals(extension)
                        && document.getCollection().equals(collection)
                        && readable(document))
                .orElseThrow(() -> new ResourceNotFoundException("No document " + id + " in " + collection + "."));
    }

    /**
     * Whether the person reads a document, as the row-level security decides too: one of the whole
     * organization unless a guest, one of a team if in the team (MK-032).
     */
    private boolean readable(ExtensionDocument document) {
        if (document.getTeamId() == null) {
            return !organization.guest();
        }
        return RequestOrganization.account(identity)
                .filter(account -> teams.isMember(document.getTeamId(), account))
                .isPresent();
    }

    /** The collection must be declared by an active extension; otherwise it does not exist. */
    private void declared(String extension, String collection) {
        boolean declared = registry.findActive(extension)
                .flatMap(InstalledExtension::manifest)
                .flatMap(ExtensionManifest::data)
                .filter(data -> data.declares(collection))
                .isPresent();
        if (!declared) {
            throw new ResourceNotFoundException(
                    "No active extension " + extension + " declares the collection " + collection + ".");
        }
    }

    private String checked(JsonNode data) {
        if (data == null || !data.isObject()) {
            throw new InvalidInputException(List.of("document must be a JSON object"));
        }
        try {
            String text = json.writeValueAsString(data);
            if (text.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
                throw new InvalidInputException(List.of("document is larger than " + MAX_BYTES + " bytes"));
            }
            return text;
        } catch (JsonProcessingException e) {
            throw new InvalidInputException(List.of("document is not valid JSON"));
        }
    }

    private String author() {
        return identity.getPrincipal().getName();
    }

    private DocumentView view(ExtensionDocument document) {
        try {
            return new DocumentView(
                    document.getId(),
                    document.getTeamId(),
                    json.readTree(document.getData()),
                    document.getVersion(),
                    document.getCreatedAt(),
                    document.getCreatedBy(),
                    document.getUpdatedAt(),
                    document.getUpdatedBy());
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("The document " + document.getId() + " is not valid JSON", e);
        }
    }
}

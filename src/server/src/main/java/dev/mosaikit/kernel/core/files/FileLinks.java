// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import io.agroal.api.AgroalDataSource;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.jboss.logging.Logger;

/**
 * Signed, expiring links to the files of extensions (MK-093). A person, or the code of an extension,
 * asks for a link to a file they read, or to every file under a prefix of names in a scope they
 * read; anyone who holds the link then downloads those files without a session until it expires.
 *
 * <p>A link is stateless: it carries the organization, the extension, the file or the prefix (with
 * its team), and its expiry, signed with HMAC-SHA256 by a key of {@link LinkKeys}. An expired, altered
 * or unknown link, a file that no longer exists or is outside the link, and an extension no longer
 * active all answer the same not found, so that a link never tells whether a file exists. Making a
 * link is audited; its use at most once an hour for each link and each node, as access keys are
 * (MK-060), so that a viewer that fetches many tiles does not fill the audit log.
 */
@ApplicationScoped
public class FileLinks {

    private static final Logger LOG = Logger.getLogger(FileLinks.class);

    static final String CREATED = "file.link.created";
    static final String USED = "file.link.used";

    /** How often the use of one link is audited, at most. */
    static final Duration AUDIT_EVERY = Duration.ofHours(1);

    /** How many links the memory of uses keeps before it forgets the old ones. */
    static final int REMEMBERED = 10_000;

    private static final String COLUMNS = "select id, extension_id, owner_id, team_id, name, content_type, size,"
            + " checksum, storage_key, resource_id, created_at, updated_at from ";
    private static final String BY_ID = COLUMNS + "mk_kernel.signed_file(?, ?, ?)";
    private static final String BY_NAME = COLUMNS + "mk_kernel.signed_file_named(?, ?, ?, ?)";

    /** A link made: what it grants, its signature, and its path with its query. */
    public record Made(FileLink link, String signature) {

        /** The path up to the identifier or the name of a file. */
        public String base() {
            return link.base();
        }

        /** The query of the link, with its signature. */
        public String query() {
            return link.query(signature);
        }

        /**
         * The path and query of the link: to the file, or to the prefix itself. A file under a prefix
         * is at {@code base() + name + "?" + query()}.
         */
        public String path() {
            return base() + link.target() + "?" + query();
        }
    }

    private final FileService files;
    private final LinkKeys keys;
    private final ExtensionRegistry extensions;
    private final RequestOrganization organization;
    private final SecurityIdentity identity;
    private final AuditLog audit;
    private final AgroalDataSource dataSource;
    private final Duration maxValidity;
    private final Map<String, Instant> audited = new ConcurrentHashMap<>();
    private final Clock clock;

    @SuppressWarnings("java:S107") // the beans it needs
    public FileLinks(
            FileService files,
            LinkKeys keys,
            ExtensionRegistry extensions,
            RequestOrganization organization,
            SecurityIdentity identity,
            AuditLog audit,
            AgroalDataSource dataSource,
            KernelConfig config) {
        this.files = files;
        this.keys = keys;
        this.extensions = extensions;
        this.organization = organization;
        this.identity = identity;
        this.audit = audit;
        this.dataSource = dataSource;
        this.maxValidity = config.files().linkMaxValidity();
        this.clock = Clock.systemUTC();
    }

    /** The longest validity of a link ({@code mosaikit.files.link-max-validity}). */
    public Duration maxValidity() {
        return maxValidity;
    }

    /**
     * A link to a file of an extension that the person of the request reads.
     *
     * @param expires when it stops working: at most {@code mosaikit.files.link-max-validity} from now;
     *     {@code null} for the longest
     * @throws ResourceNotFoundException when there is no such file, or the person may not read it
     * @throws InvalidInputException when the expiry is past or too far
     */
    public Made toFile(String extension, UUID id, Instant expires) {
        Instant until = expiry(expires);
        FileView file = files.metadata(extension, id);
        Made made = sign(new FileLink(organization.require(), extension, file.id(), null, null, until));
        created(made, Map.of("file", file.id().toString(), "name", file.name()));
        return made;
    }

    /**
     * A link to every file of an extension whose name starts with a prefix: those of one team of the
     * person, or, with no team, those of the organization (not a guest).
     *
     * @param prefix the start of the names, such as {@code tiles/}; empty for every file
     * @param expires as for {@link #toFile}
     */
    public Made toPrefix(String extension, String prefix, UUID team, Instant expires) {
        Instant until = expiry(expires);
        String start = FileService.prefix(prefix);
        files.permitsPrefix(extension, team);
        Made made = sign(new FileLink(organization.require(), extension, null, start, team, until));
        Map<String, String> detail = new LinkedHashMap<>();
        detail.put("prefix", start);
        if (team != null) {
            detail.put("team", team.toString());
        }
        created(made, detail);
        return made;
    }

    /**
     * The file of a link to one file.
     *
     * @throws ResourceNotFoundException when the link is not valid, or the file is not there
     */
    public FileService.Content open(UUID org, String extension, UUID id, String expires, String signature) {
        FileLink link = verified(() -> new FileLink(org, extension, id, null, null, instant(expires)), signature);
        Found found = lookup(BY_ID, statement -> {
                    statement.setObject(1, org);
                    statement.setString(2, extension);
                    statement.setObject(3, id);
                })
                .orElseThrow(FileLinks::refused);
        return used(link, signature, found);
    }

    /**
     * A file under a link to a prefix, by its name.
     *
     * @throws ResourceNotFoundException when the link is not valid, or no file of that name is under it
     */
    public FileService.Content openNamed(
            UUID org, String extension, String prefix, UUID team, String name, String expires, String signature) {
        FileLink link = verified(
                () -> new FileLink(org, extension, null, prefix == null ? "" : prefix, team, instant(expires)),
                signature);
        if (name == null || !name.startsWith(link.prefix())) {
            throw refused();
        }
        Found found = lookup(BY_NAME, statement -> {
                    statement.setObject(1, org);
                    statement.setString(2, extension);
                    statement.setObject(3, team);
                    statement.setString(4, name);
                })
                .orElseThrow(FileLinks::refused);
        return used(link, signature, found);
    }

    private Made sign(FileLink link) {
        return new Made(link, link.signature(keys.current()));
    }

    /** The expiry of a new link, to the second: in the future, and not beyond the longest validity. */
    private Instant expiry(Instant requested) {
        Instant now = Instant.now(clock);
        Instant longest = now.plus(maxValidity).truncatedTo(ChronoUnit.SECONDS);
        if (requested == null) {
            keys.current();
            return longest;
        }
        Instant until = requested.truncatedTo(ChronoUnit.SECONDS);
        if (!until.isAfter(now)) {
            throw new InvalidInputException(List.of("expires must be in the future"));
        }
        if (until.isAfter(longest)) {
            throw new InvalidInputException(List.of("expires must be at most " + maxValidity.toDays()
                    + " days from now (mosaikit.files.link-max-validity)"));
        }
        keys.current();
        return until;
    }

    /** What a link says, if its signature is valid and it did not expire; otherwise not found. */
    private FileLink verified(LinkParts parts, String signature) {
        if (signature == null || signature.isBlank() || signature.length() > 100 || !keys.enabled()) {
            throw refused();
        }
        FileLink link;
        try {
            link = parts.get();
        } catch (IllegalArgumentException | NullPointerException _) {
            throw refused();
        }
        if (!link.verifies(signature, keys.all())) {
            LOG.debugf("A link to files of %s with a wrong signature was refused", link.extension());
            throw refused();
        }
        if (!Instant.now(clock).isBefore(link.expires())) {
            throw refused();
        }
        if (extensions.findActive(link.extension()).isEmpty()) {
            throw refused();
        }
        return link;
    }

    /** The parts of a link read from a request; any of them may be malformed. */
    @FunctionalInterface
    private interface LinkParts {
        FileLink get();
    }

    private static Instant instant(String epochSeconds) {
        if (epochSeconds == null || epochSeconds.length() > 12) {
            throw new IllegalArgumentException("expires");
        }
        try {
            return Instant.ofEpochSecond(Long.parseLong(epochSeconds));
        } catch (NumberFormatException _) {
            throw new IllegalArgumentException("expires");
        }
    }

    /** The same answer for every refusal: it never tells whether the file exists. */
    static ResourceNotFoundException refused() {
        return new ResourceNotFoundException("No such file, or the link is not valid.");
    }

    private FileService.Content used(FileLink link, String signature, Found found) {
        String id = FileLink.id(signature);
        Instant now = Instant.now(clock);
        Instant last = audited.get(id);
        if (last == null || !now.isBefore(last.plus(AUDIT_EVERY))) {
            if (audited.size() >= REMEMBERED) {
                audited.values().removeIf(at -> !now.isBefore(at.plus(AUDIT_EVERY)));
                if (audited.size() >= REMEMBERED) {
                    audited.clear();
                }
            }
            audited.put(id, now);
            Map<String, String> detail = new LinkedHashMap<>();
            detail.put("extension", link.extension());
            detail.put("link", id);
            detail.put("name", found.file().name());
            audit.append(
                    identity.isAnonymous()
                            ? "anonymous"
                            : identity.getPrincipal().getName(),
                    Optional.of(link.organization()),
                    USED,
                    found.file().id().toString(),
                    AuditEvent.Outcome.SUCCEEDED,
                    detail);
        }
        return files.new Content(found.file(), found.key());
    }

    private void created(Made made, Map<String, String> what) {
        FileLink link = made.link();
        Map<String, String> detail = new LinkedHashMap<>();
        detail.put("extension", link.extension());
        detail.put("link", FileLink.id(made.signature()));
        detail.putAll(what);
        detail.put("expires", link.expires().toString());
        audit.append(
                identity.isAnonymous()
                        ? link.extension()
                        : identity.getPrincipal().getName(),
                Optional.of(link.organization()),
                CREATED,
                link.file() != null ? link.file().toString() : link.extension() + ":" + link.prefix(),
                AuditEvent.Outcome.SUCCEEDED,
                detail);
    }

    /** A file found for a link, with the key of its content in the store. */
    private record Found(FileView file, String key) {}

    @FunctionalInterface
    private interface Binder {
        void bind(PreparedStatement statement) throws SQLException;
    }

    private Optional<Found> lookup(String query, Binder binder) {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(query)) {
            binder.bind(statement);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) {
                    return Optional.empty();
                }
                FileView file = new FileView(
                        result.getObject(1, UUID.class),
                        result.getString(2),
                        result.getString(5),
                        result.getString(6),
                        result.getLong(7),
                        result.getString(8),
                        result.getObject(3, UUID.class),
                        result.getObject(4, UUID.class),
                        result.getObject(10, UUID.class),
                        result.getObject(11, OffsetDateTime.class).toInstant(),
                        result.getObject(12, OffsetDateTime.class).toInstant());
                return Optional.of(new Found(file, result.getString(9)));
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Cannot read the file of a link", e);
        }
    }
}

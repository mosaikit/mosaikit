// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.extension.SubjectKind;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.audit.FirstUses;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.security.PasswordHasher;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * The secrets of links (MK-055): makes them, keeps only their SHA-256, and resolves a secret into
 * the resource it opens, for requests without an account and so without an organization. Every
 * refused use of a link is in the audit log, and the first use that works of each hour, for each link
 * and each node, as for access keys (MK-060): a map read through a link asks for every tile with it.
 */
@ApplicationScoped
public class SharedLinks {

    /** The path of the installation that opens a link, followed by its secret. */
    public static final String PATH = "/shared/";

    /** Audit action of the use of a link. */
    static final String USED = "sharing.link.used";

    /** How often a use of one link that works is audited, at most. */
    static final Duration AUDIT_EVERY = Duration.ofHours(1);

    /** How many links the memory of uses keeps before it forgets the old ones. */
    static final int REMEMBERED = 10_000;

    private static final int SECRET_BYTES = 32;
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String LOOKUP = "select grant_id, organization_id, resource_id, extension_id, type, ref_id,"
            + " title, link, level, expires_at, password_hash, revoked_at from mk_kernel.shared_link(?)";

    /**
     * A link that works, resolved from its secret.
     *
     * @param grant the grant of the link
     * @param level the level it gives, capped at the link level of the type as it is now
     */
    public record Opened(
            UUID grant,
            UUID organization,
            UUID resourceId,
            ResourceRef resource,
            String title,
            String link,
            String level,
            Instant expires) {}

    /** Why a link does not open. */
    public enum Refusal {
        /**
         * Unknown, expired, revoked, of a type no longer declared, or of an organization deleted
         * (MK-130): the link answers not found.
         */
        NOT_FOUND,
        /** The link has a password and none was given. */
        PASSWORD_REQUIRED,
        /** The password is wrong. */
        WRONG_PASSWORD
    }

    /** A link that does not open. */
    public static final class RefusedException extends RuntimeException {
        private static final long serialVersionUID = 1L;
        private final Refusal refusal;

        RefusedException(Refusal refusal) {
            super(refusal.name());
            this.refusal = refusal;
        }

        public Refusal refusal() {
            return refusal;
        }
    }

    private final AgroalDataSource dataSource;
    private final ExtensionRegistry extensions;
    private final PasswordHasher hasher;
    private final AuditLog audit;
    private final Clock clock;
    private final FirstUses audited = new FirstUses(AUDIT_EVERY, REMEMBERED);

    public SharedLinks(
            AgroalDataSource dataSource,
            ExtensionRegistry extensions,
            PasswordHasher hasher,
            AuditLog audit,
            Clock clock) {
        this.dataSource = dataSource;
        this.extensions = extensions;
        this.hasher = hasher;
        this.audit = audit;
        this.clock = clock;
    }

    /** A new secret: 256 random bits, URL-safe. */
    static String secret() {
        byte[] bytes = new byte[SECRET_BYTES];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** The SHA-256 of a secret, in hexadecimal: all the kernel keeps of it. */
    static String digest(String secret) {
        try {
            return HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256").digest(secret.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The address to give to people. */
    static String address(String secret) {
        return PATH + secret;
    }

    /**
     * Opens a link with its secret and, when it has one, its password, and writes the use in the
     * audit log: always when it is refused, the first time of each hour when it works.
     *
     * @param actor who opens it, {@code anonymous} without an account
     * @throws RefusedException when the link does not open
     */
    public Opened open(String secret, String password, String actor) {
        if (secret == null || secret.isBlank() || secret.length() > 200) {
            throw refused(actor, null, Refusal.NOT_FOUND, Map.of());
        }
        Optional<Row> found = lookup(digest(secret.strip()));
        if (found.isEmpty()) {
            throw refused(actor, null, Refusal.NOT_FOUND, Map.of());
        }
        Row row = found.get();
        Instant now = Instant.now(clock);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("link", row.grant().toString());
        if (row.revoked() != null) {
            detail.put("reason", "revoked");
            throw refused(actor, row, Refusal.NOT_FOUND, detail);
        }
        if (!now.isBefore(row.expires())) {
            detail.put("reason", "expired");
            throw refused(actor, row, Refusal.NOT_FOUND, detail);
        }
        Optional<ResourceTypeEntry> type = extensions
                .findActive(row.resource().extension())
                .flatMap(InstalledExtension::manifest)
                .flatMap((ExtensionManifest manifest) ->
                        ResourceTypes.of(manifest, row.resource().type()));
        if (type.isEmpty() || !type.get().declares(row.level()) || !type.get().accepts(SubjectKind.LINK)) {
            detail.put("reason", "type no longer shared by links");
            throw refused(actor, row, Refusal.NOT_FOUND, detail);
        }
        if (row.passwordHash() != null) {
            if (password == null || password.isEmpty()) {
                detail.put("reason", "password required");
                throw refused(actor, row, Refusal.PASSWORD_REQUIRED, detail);
            }
            if (!hasher.verify(password.toCharArray(), row.passwordHash())) {
                detail.put("reason", "wrong password");
                throw refused(actor, row, Refusal.WRONG_PASSWORD, detail);
            }
        }
        ResourceTypeEntry entry = type.get();
        String level = entry.includes(entry.linkLevel(), row.level()) ? row.level() : entry.linkLevel();
        detail.put("level", level);
        if (audited.first(row.grant().toString(), now)) {
            audit.append(
                    actor,
                    Optional.of(row.organization()),
                    USED,
                    row.resource().toString(),
                    AuditEvent.Outcome.SUCCEEDED,
                    detail);
        }
        return new Opened(
                row.grant(),
                row.organization(),
                row.resourceId(),
                row.resource(),
                row.title(),
                row.link(),
                level,
                row.expires());
    }

    private RefusedException refused(String actor, Row row, Refusal refusal, Map<String, Object> detail) {
        audit.append(
                actor,
                row == null ? Optional.empty() : Optional.of(row.organization()),
                USED,
                row == null ? "unknown link" : row.resource().toString(),
                refusal == Refusal.NOT_FOUND ? AuditEvent.Outcome.FAILED : AuditEvent.Outcome.DENIED,
                detail);
        return new RefusedException(refusal);
    }

    private record Row(
            UUID grant,
            UUID organization,
            UUID resourceId,
            ResourceRef resource,
            String title,
            String link,
            String level,
            Instant expires,
            String passwordHash,
            Instant revoked) {}

    private Optional<Row> lookup(String digest) {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(LOOKUP)) {
            statement.setString(1, digest);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) {
                    return Optional.empty();
                }
                return Optional.of(new Row(
                        result.getObject(1, UUID.class),
                        result.getObject(2, UUID.class),
                        result.getObject(3, UUID.class),
                        new ResourceRef(result.getString(4), result.getString(5), result.getString(6)),
                        result.getString(7),
                        result.getString(8),
                        result.getString(9),
                        instant(result, 10),
                        result.getString(11),
                        instant(result, 12)));
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Cannot read the link", e);
        }
    }

    private static Instant instant(ResultSet result, int column) throws SQLException {
        java.time.OffsetDateTime value = result.getObject(column, java.time.OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}

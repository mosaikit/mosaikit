// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.secrets.SecretKeys.MasterKey;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.jboss.logging.Logger;

/**
 * The store of credentials of organizations (MK-062): what their administrators do with them, and
 * the rotation of the master key for platform administrators. A value goes in once, is sealed at
 * once, and never comes back through here: the views carry a masked hint at most. The calls of an
 * organization act on the organization given, which the caller has checked is the one of the
 * request; every change is in the audit log, without the value.
 */
@ApplicationScoped
@Transactional
public class SecretAdministration {

    private static final Logger LOG = Logger.getLogger(SecretAdministration.class);

    static final Pattern NAME = Pattern.compile("[a-z0-9][a-z0-9._-]{0,99}");
    static final Pattern EXTENSION = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,254}");
    static final Set<String> KINDS = Set.of("password", "token", "key", "other");
    static final int MAX_VALUE = 16_384;
    static final int MAX_DESCRIPTION = 500;

    /** Shorter values show no characters in their hint. */
    static final int HINT_MIN_LENGTH = 20;

    static final String MASK = "••••";

    /**
     * What people see of a credential: never its value.
     *
     * @param extension the extension it is meant for, the only one that reads it, or {@code null} for
     *     any extension of the organization
     * @param hint the value masked: {@code ••••}, or for a long token or key its last four characters
     *     after the mask
     */
    public record SecretView(
            String name,
            String kind,
            String description,
            String extension,
            String hint,
            Instant createdAt,
            Instant updatedAt,
            String updatedBy) {

        static SecretView of(StoredSecret secret) {
            return new SecretView(
                    secret.getName(),
                    secret.getKind(),
                    secret.getDescription(),
                    secret.getExtensionId(),
                    secret.getHint(),
                    secret.getCreatedAt(),
                    secret.getUpdatedAt(),
                    secret.getUpdatedBy());
        }
    }

    /**
     * A credential to store or replace. Its {@code toString} masks the value, so that the request
     * never shows it in a log or a message.
     *
     * @param name only to store one; a replacement takes the name from the path
     * @param value required to store; to replace, absent or {@code null} keeps the value
     */
    public record SecretRequest(String name, String kind, String value, String description, String extension) {

        @Override
        public String toString() {
            return "SecretRequest[name=" + name + ", kind=" + kind + ", value=" + (value == null ? "absent" : MASK)
                    + ", extension=" + extension + "]";
        }
    }

    /** The state of the master keys: for platform administrators, during a rotation. */
    public record KeysView(
            boolean enabled,
            String problem,
            String currentKey,
            List<String> previousKeys,
            Map<String, Long> credentials) {}

    /** What a re-encryption did: credentials moved to the current key, and those it could not read. */
    public record ReEncryption(int reEncrypted, int unreadable, String currentKey) {}

    private final StoredSecrets secrets;
    private final SecretKeys keys;
    private final AuditLog audit;
    private final EntityManager entityManager;
    private final Clock clock;

    public SecretAdministration(
            StoredSecrets secrets, SecretKeys keys, AuditLog audit, EntityManager entityManager, Clock clock) {
        this.secrets = secrets;
        this.keys = keys;
        this.audit = audit;
        this.entityManager = entityManager;
        this.clock = clock;
    }

    /** The credentials of the organization, by name. */
    public List<SecretView> list(UUID organization) {
        keys.current();
        return secrets.list(organization).stream().map(SecretView::of).toList();
    }

    /** One credential of the organization. */
    public SecretView get(UUID organization, String name) {
        keys.current();
        return SecretView.of(require(organization, name));
    }

    /** Stores a new credential. */
    public SecretView store(UUID organization, SecretRequest request, String actor) {
        MasterKey master = keys.current();
        if (request == null) {
            throw new InvalidInputException(List.of("name, kind and value are required"));
        }
        List<String> problems = new ArrayList<>();
        String name = request.name() == null ? null : request.name().trim();
        if (name == null || !NAME.matcher(name).matches()) {
            problems.add("name must be 1 to 100 lowercase letters, digits, '.', '_' or '-', starting with a"
                    + " letter or a digit");
        }
        Checked checked = check(request, true, problems);
        if (secrets.find(organization, name).isPresent()) {
            throw new ConflictException("A credential named " + name + " already exists: replace it instead.");
        }
        Instant now = Instant.now(clock);
        StoredSecret secret = new StoredSecret(organization, name, now);
        secret.describe(checked.kind(), checked.description(), checked.extension(), actor, now);
        seal(master, secret, request.value(), checked.kind());
        secrets.insert(secret);
        record(organization, actor, "secrets.stored", secret, true);
        return SecretView.of(secret);
    }

    /** Replaces a credential: its value when one is given, and what people see of it. */
    public SecretView replace(UUID organization, String name, SecretRequest request, String actor) {
        MasterKey master = keys.current();
        StoredSecret secret = require(organization, name);
        if (request == null) {
            throw new InvalidInputException(List.of("kind is required"));
        }
        if (request.name() != null && !request.name().trim().equals(name)) {
            throw new InvalidInputException(List.of("name cannot change: store a new credential and delete this one"));
        }
        Checked checked = check(request, false, new ArrayList<>());
        boolean valueChanged = request.value() != null;
        secret.describe(checked.kind(), checked.description(), checked.extension(), actor, Instant.now(clock));
        if (valueChanged) {
            seal(master, secret, request.value(), checked.kind());
        }
        secrets.update(secret);
        record(organization, actor, "secrets.replaced", secret, valueChanged);
        return SecretView.of(secret);
    }

    /** Deletes a credential. */
    public void delete(UUID organization, String name, String actor) {
        keys.current();
        StoredSecret secret = require(organization, name);
        secrets.delete(secret);
        record(organization, actor, "secrets.deleted", secret, false);
    }

    /** The master keys, and how many credentials each one holds, in every organization. */
    public KeysView keys() {
        asOwner();
        Map<String, Long> counts = new LinkedHashMap<>();
        entityManager
                .createQuery(
                        "select s.keyId, count(s) from StoredSecret s group by s.keyId order by s.keyId",
                        Object[].class)
                .getResultList()
                .forEach(row -> counts.put((String) row[0], ((Number) row[1]).longValue()));
        return new KeysView(
                keys.enabled(),
                keys.problem().orElse(null),
                keys.enabled() ? keys.current().id() : null,
                keys.previousIds(),
                counts);
    }

    /**
     * Puts the data keys of every credential, in every organization, under the current master key,
     * after a rotation. Values are not decrypted. A credential whose key is not configured, or that
     * does not decrypt, is left as it is and counted as unreadable.
     */
    public ReEncryption reEncrypt(String actor) {
        MasterKey current = keys.current();
        asOwner();
        List<StoredSecret> stale = entityManager
                .createQuery("from StoredSecret s where s.keyId <> :current order by s.id", StoredSecret.class)
                .setParameter("current", current.id())
                .getResultList();
        int moved = 0;
        int unreadable = 0;
        for (StoredSecret secret : stale) {
            Optional<MasterKey> former = keys.find(secret.getKeyId());
            if (former.isEmpty()) {
                unreadable++;
                continue;
            }
            try {
                byte[] wrapped = SecretCipher.rewrap(
                        former.get(),
                        current,
                        SecretCipher.binding(secret.getOrganizationId(), secret.getName()),
                        secret.getWrappedKey());
                secret.rewrap(current.id(), wrapped);
                moved++;
            } catch (SecretCipher.UnreadableException _) {
                unreadable++;
            }
        }
        if (unreadable > 0) {
            LOG.warnf(
                    "%d credentials could not be encrypted again with the master key %s: their key is"
                            + " missing from mosaikit.secrets.previous-keys, or they were altered",
                    unreadable, current.id());
        }
        audit.append(
                actor,
                Optional.empty(),
                "secrets.re-encrypted",
                "platform",
                AuditEvent.Outcome.SUCCEEDED,
                Map.of("currentKey", current.id(), "reEncrypted", moved, "unreadable", unreadable));
        return new ReEncryption(moved, unreadable, current.id());
    }

    private StoredSecret require(UUID organization, String name) {
        return secrets.find(organization, name == null ? "" : name)
                .orElseThrow(
                        () -> new ResourceNotFoundException("No credential named " + name + " in the organization."));
    }

    private record Checked(String kind, String description, String extension) {}

    private static Checked check(SecretRequest request, boolean valueRequired, List<String> problems) {
        String kind = request.kind() == null ? "" : request.kind().trim();
        if (!KINDS.contains(kind)) {
            problems.add("kind must be one of password, token, key, other");
        }
        String value = request.value();
        if (value == null ? valueRequired : value.isEmpty() || value.length() > MAX_VALUE) {
            // Never the value, nor its length, in the message.
            problems.add("value is required, at most " + MAX_VALUE + " characters");
        }
        String description =
                request.description() == null ? "" : request.description().trim();
        if (description.length() > MAX_DESCRIPTION) {
            problems.add("description must be at most " + MAX_DESCRIPTION + " characters");
        }
        String extension = request.extension() == null || request.extension().isBlank()
                ? null
                : request.extension().trim();
        if (extension != null && !EXTENSION.matcher(extension).matches()) {
            problems.add("extension must be the identifier of an extension, such as org.example.reports");
        }
        if (!problems.isEmpty()) {
            throw new InvalidInputException(problems);
        }
        return new Checked(kind, description, extension);
    }

    private static void seal(MasterKey master, StoredSecret secret, String value, String kind) {
        ByteBuffer encoded = StandardCharsets.UTF_8.encode(CharBuffer.wrap(value));
        byte[] bytes = new byte[encoded.remaining()];
        encoded.get(bytes);
        if (encoded.hasArray()) {
            Arrays.fill(encoded.array(), (byte) 0);
        }
        try {
            secret.seal(
                    SecretCipher.seal(
                            master, SecretCipher.binding(secret.getOrganizationId(), secret.getName()), bytes),
                    hint(kind, value));
        } finally {
            Arrays.fill(bytes, (byte) 0);
        }
    }

    /** The masked value: the last four characters of a long token or key only, never of a password. */
    static String hint(String kind, String value) {
        boolean shows = ("token".equals(kind) || "key".equals(kind)) && value.length() >= HINT_MIN_LENGTH;
        return shows ? MASK + value.substring(value.length() - 4) : MASK;
    }

    private void record(UUID organization, String actor, String action, StoredSecret secret, boolean valueChanged) {
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("kind", secret.getKind());
        detail.put("extension", secret.getExtensionId() == null ? "" : secret.getExtensionId());
        if (!"secrets.deleted".equals(action)) {
            detail.put("valueChanged", valueChanged);
        }
        audit.append(
                actor,
                Optional.of(organization),
                action,
                "secret/" + secret.getName(),
                AuditEvent.Outcome.SUCCEEDED,
                detail);
    }

    /**
     * Runs the rest of the transaction as the owner of the tables, not as the member role of the
     * request (ADR-0018): the rotation is of the installation, and reaches the credentials of every
     * organization.
     */
    private void asOwner() {
        entityManager
                .createNativeQuery("select set_config('role', 'none', true)")
                .getSingleResult();
    }
}

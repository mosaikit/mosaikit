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
 * The store of credentials of organizations (MK-062): what their administrators do with them, the
 * credentials of the installation (MK-127) that platform administrators keep for every organization,
 * and the rotation of the master key for platform administrators. A value goes in once, is sealed at
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

        static SecretView of(SealedCredential secret) {
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
    private final InstallationSecrets installationSecrets;
    private final SecretKeys keys;
    private final AuditLog audit;
    private final EntityManager entityManager;
    private final Clock clock;

    public SecretAdministration(
            StoredSecrets secrets,
            InstallationSecrets installationSecrets,
            SecretKeys keys,
            AuditLog audit,
            EntityManager entityManager,
            Clock clock) {
        this.secrets = secrets;
        this.installationSecrets = installationSecrets;
        this.keys = keys;
        this.audit = audit;
        this.entityManager = entityManager;
        this.clock = clock;
    }

    /** The credentials of the organization, by name. */
    public List<SecretView> list(UUID organization) {
        return list(of(organization));
    }

    /** One credential of the organization. */
    public SecretView get(UUID organization, String name) {
        return get(of(organization), name);
    }

    /** Stores a new credential of the organization. */
    public SecretView store(UUID organization, SecretRequest request, String actor) {
        return store(of(organization), request, actor);
    }

    /** Replaces a credential of the organization: its value when one is given, and what people see of it. */
    public SecretView replace(UUID organization, String name, SecretRequest request, String actor) {
        return replace(of(organization), name, request, actor);
    }

    /** Deletes a credential of the organization. */
    public void delete(UUID organization, String name, String actor) {
        delete(of(organization), name, actor);
    }

    /** The credentials of the installation (MK-127), by name. */
    public List<SecretView> listInstallation() {
        return list(installation);
    }

    /** One credential of the installation. */
    public SecretView getInstallation(String name) {
        return get(installation, name);
    }

    /** Stores a new credential of the installation. */
    public SecretView storeInstallation(SecretRequest request, String actor) {
        return store(installation, request, actor);
    }

    /** Replaces a credential of the installation: its value when one is given, and what people see of it. */
    public SecretView replaceInstallation(String name, SecretRequest request, String actor) {
        return replace(installation, name, request, actor);
    }

    /** Deletes a credential of the installation. */
    public void deleteInstallation(String name, String actor) {
        delete(installation, name, actor);
    }

    /**
     * The master keys, and how many credentials each one holds, in every organization and in the
     * installation.
     */
    public KeysView keys() {
        asOwner();
        Map<String, Long> counts = new LinkedHashMap<>();
        entityManager
                .createQuery(
                        "select s.keyId, count(s) from StoredSecret s group by s.keyId order by s.keyId",
                        Object[].class)
                .getResultList()
                .forEach(row -> counts.put((String) row[0], ((Number) row[1]).longValue()));
        entityManager
                .createQuery(
                        "select s.keyId, count(s) from InstallationSecret s group by s.keyId order by s.keyId",
                        Object[].class)
                .getResultList()
                .forEach(row -> counts.merge((String) row[0], ((Number) row[1]).longValue(), Long::sum));
        return new KeysView(
                keys.enabled(),
                keys.problem().orElse(null),
                keys.enabled() ? keys.current().id() : null,
                keys.previousIds(),
                counts);
    }

    /**
     * Puts the data keys of every credential, in every organization and of the installation, under
     * the current master key, after a rotation. Values are not decrypted. A credential whose key is
     * not configured, or that does not decrypt, is left as it is and counted as unreadable.
     */
    public ReEncryption reEncrypt(String actor) {
        MasterKey current = keys.current();
        asOwner();
        List<SealedCredential> stale = new ArrayList<>(entityManager
                .createQuery("from StoredSecret s where s.keyId <> :current order by s.id", StoredSecret.class)
                .setParameter("current", current.id())
                .getResultList());
        stale.addAll(entityManager
                .createQuery(
                        "from InstallationSecret s where s.keyId <> :current order by s.id", InstallationSecret.class)
                .setParameter("current", current.id())
                .getResultList());
        int moved = 0;
        int unreadable = 0;
        for (SealedCredential secret : stale) {
            Optional<MasterKey> former = keys.find(secret.getKeyId());
            if (former.isEmpty()) {
                unreadable++;
                continue;
            }
            try {
                byte[] wrapped = SecretCipher.rewrap(former.get(), current, secret.binding(), secret.getWrappedKey());
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

    private <T extends SealedCredential> List<SecretView> list(Scope<T> scope) {
        keys.current();
        return scope.list().stream().map(SecretView::of).toList();
    }

    private <T extends SealedCredential> SecretView get(Scope<T> scope, String name) {
        keys.current();
        return SecretView.of(require(scope, name));
    }

    private <T extends SealedCredential> SecretView store(Scope<T> scope, SecretRequest request, String actor) {
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
        if (scope.find(name).isPresent()) {
            throw new ConflictException("A credential named " + name + " already exists: replace it instead.");
        }
        Instant now = Instant.now(clock);
        T secret = scope.create(name, now);
        secret.describe(checked.kind(), checked.description(), checked.extension(), actor, now);
        seal(master, secret, request.value(), checked.kind());
        scope.insert(secret);
        record(scope, actor, "secrets.stored", secret, true);
        return SecretView.of(secret);
    }

    private <T extends SealedCredential> SecretView replace(
            Scope<T> scope, String name, SecretRequest request, String actor) {
        MasterKey master = keys.current();
        T secret = require(scope, name);
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
        scope.update(secret);
        record(scope, actor, "secrets.replaced", secret, valueChanged);
        return SecretView.of(secret);
    }

    private <T extends SealedCredential> void delete(Scope<T> scope, String name, String actor) {
        keys.current();
        T secret = require(scope, name);
        scope.delete(secret);
        record(scope, actor, "secrets.deleted", secret, false);
    }

    private static <T extends SealedCredential> T require(Scope<T> scope, String name) {
        return scope.find(name == null ? "" : name)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "No credential named " + name + " in the " + scope.label() + "."));
    }

    /**
     * Where credentials are kept: an organization, under row-level security, or the installation,
     * whose table only the owner of the tables reaches.
     */
    private interface Scope<T extends SealedCredential> {

        List<T> list();

        Optional<T> find(String name);

        T create(String name, Instant now);

        void insert(T secret);

        void update(T secret);

        void delete(T secret);

        /** The organization of the audit log; empty for the log of the platform. */
        Optional<UUID> organization();

        /** {@code organization} or {@code installation}, for messages. */
        String label();
    }

    private Scope<StoredSecret> of(UUID organization) {
        return new Scope<>() {
            @Override
            public List<StoredSecret> list() {
                return secrets.list(organization);
            }

            @Override
            public Optional<StoredSecret> find(String name) {
                return secrets.find(organization, name);
            }

            @Override
            public StoredSecret create(String name, Instant now) {
                return new StoredSecret(organization, name, now);
            }

            @Override
            public void insert(StoredSecret secret) {
                secrets.insert(secret);
            }

            @Override
            public void update(StoredSecret secret) {
                secrets.update(secret);
            }

            @Override
            public void delete(StoredSecret secret) {
                secrets.delete(secret);
            }

            @Override
            public Optional<UUID> organization() {
                return Optional.of(organization);
            }

            @Override
            public String label() {
                return "organization";
            }
        };
    }

    /** The credentials of the installation: every call runs as the owner of the tables first. */
    private final Scope<InstallationSecret> installation = new Scope<>() {
        @Override
        public List<InstallationSecret> list() {
            asOwner();
            return installationSecrets.list();
        }

        @Override
        public Optional<InstallationSecret> find(String name) {
            asOwner();
            return installationSecrets.find(name);
        }

        @Override
        public InstallationSecret create(String name, Instant now) {
            return new InstallationSecret(name, now);
        }

        @Override
        public void insert(InstallationSecret secret) {
            asOwner();
            installationSecrets.insert(secret);
        }

        @Override
        public void update(InstallationSecret secret) {
            asOwner();
            installationSecrets.update(secret);
        }

        @Override
        public void delete(InstallationSecret secret) {
            asOwner();
            installationSecrets.delete(secret);
        }

        @Override
        public Optional<UUID> organization() {
            return Optional.empty();
        }

        @Override
        public String label() {
            return "installation";
        }
    };

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

    private static void seal(MasterKey master, SealedCredential secret, String value, String kind) {
        ByteBuffer encoded = StandardCharsets.UTF_8.encode(CharBuffer.wrap(value));
        byte[] bytes = new byte[encoded.remaining()];
        encoded.get(bytes);
        if (encoded.hasArray()) {
            Arrays.fill(encoded.array(), (byte) 0);
        }
        try {
            secret.seal(SecretCipher.seal(master, secret.binding(), bytes), hint(kind, value));
        } finally {
            Arrays.fill(bytes, (byte) 0);
        }
    }

    /** The masked value: the last four characters of a long token or key only, never of a password. */
    static String hint(String kind, String value) {
        boolean shows = ("token".equals(kind) || "key".equals(kind)) && value.length() >= HINT_MIN_LENGTH;
        return shows ? MASK + value.substring(value.length() - 4) : MASK;
    }

    private void record(Scope<?> scope, String actor, String action, SealedCredential secret, boolean valueChanged) {
        Map<String, Object> detail = new LinkedHashMap<>();
        if (scope.organization().isEmpty()) {
            detail.put("scope", "installation");
        }
        detail.put("kind", secret.getKind());
        detail.put("extension", secret.getExtensionId() == null ? "" : secret.getExtensionId());
        if (!"secrets.deleted".equals(action)) {
            detail.put("valueChanged", valueChanged);
        }
        audit.append(
                actor,
                scope.organization(),
                action,
                "secret/" + secret.getName(),
                AuditEvent.Outcome.SUCCEEDED,
                detail);
    }

    /**
     * Runs the rest of the transaction as the owner of the tables, not as the member role of the
     * request (ADR-0018): the rotation is of the installation, and reaches the credentials of every
     * organization; the credentials of the installation (MK-127) are on a table that the member role
     * cannot reach at all.
     */
    private void asOwner() {
        entityManager
                .createNativeQuery("select set_config('role', 'none', true)")
                .getSingleResult();
    }
}

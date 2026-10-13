// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.secrets.SecretValue;
import dev.mosaikit.kernel.api.secrets.Secrets;
import dev.mosaikit.kernel.api.secrets.SecretsUnavailableException;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.secrets.SecretKeys.MasterKey;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.Arrays;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.function.Supplier;
import org.jboss.logging.Logger;

/**
 * The kernel's {@link Secrets} bean (MK-062): extension backends read the credentials of the
 * organization of the request, decrypted on the server at the moment of the call. A credential meant
 * for one extension is read by that extension only. Every read, and every refusal to decrypt, is in
 * the audit log through the channel {@code EXTENSION}, without the value.
 */
@ApplicationScoped
@Transactional
public class SecretVault implements Secrets {

    private static final Logger LOG = Logger.getLogger(SecretVault.class);

    private final StoredSecrets secrets;
    private final SecretKeys keys;
    private final Predicate<String> active;
    private final CurrentOrganization organization;
    private final Supplier<Optional<String>> person;
    private final AuditLog audit;

    @Inject
    public SecretVault(
            StoredSecrets secrets,
            SecretKeys keys,
            ExtensionRegistry extensions,
            CurrentOrganization organization,
            SecurityIdentity identity,
            AuditLog audit) {
        this(
                secrets,
                keys,
                id -> extensions.findActive(id).isPresent(),
                organization,
                () -> identity.isAnonymous()
                        ? Optional.empty()
                        : Optional.of(identity.getPrincipal().getName()),
                audit);
    }

    SecretVault(
            StoredSecrets secrets,
            SecretKeys keys,
            Predicate<String> active,
            CurrentOrganization organization,
            Supplier<Optional<String>> person,
            AuditLog audit) {
        this.secrets = secrets;
        this.keys = keys;
        this.active = active;
        this.organization = organization;
        this.person = person;
        this.audit = audit;
    }

    @Override
    public Optional<SecretValue> find(String extension, String name) {
        Objects.requireNonNull(extension, "extension");
        Objects.requireNonNull(name, "name");
        if (!active.test(extension)) {
            throw new IllegalArgumentException(extension + " is not an active extension.");
        }
        if (!keys.enabled()) {
            throw new SecretsUnavailableException(keys.disabled().getMessage());
        }
        UUID org = organization.require();
        Optional<StoredSecret> found = secrets.find(org, name)
                .filter(secret -> secret.getExtensionId() == null
                        || secret.getExtensionId().equals(extension));
        if (found.isEmpty()) {
            return Optional.empty();
        }
        StoredSecret secret = found.get();
        Optional<MasterKey> master = keys.find(secret.getKeyId());
        byte[] plain = null;
        try {
            if (master.isEmpty()) {
                throw new SecretCipher.UnreadableException();
            }
            plain = SecretCipher.open(
                    master.get(),
                    SecretCipher.binding(org, secret.getName()),
                    secret.getWrappedKey(),
                    secret.getCiphertext());
            record(org, extension, secret, AuditEvent.Outcome.SUCCEEDED);
            return Optional.of(SecretValue.ofUtf8(plain));
        } catch (SecretCipher.UnreadableException _) {
            LOG.warnf(
                    "The credential %s of the organization %s does not decrypt with the master keys of the"
                            + " installation: its key %s is missing from mosaikit.secrets.previous-keys, or the row"
                            + " was altered",
                    secret.getName(), org, secret.getKeyId());
            record(org, extension, secret, AuditEvent.Outcome.FAILED);
            throw new SecretsUnavailableException("The credential " + secret.getName()
                    + " cannot be decrypted with the master keys of the installation.");
        } finally {
            if (plain != null) {
                Arrays.fill(plain, (byte) 0);
            }
        }
    }

    private void record(UUID org, String extension, StoredSecret secret, AuditEvent.Outcome outcome) {
        audit.append(
                AuditEvent.Channel.EXTENSION,
                person.get().orElse(extension),
                Optional.of(org),
                "secrets.read",
                "secret/" + secret.getName(),
                outcome,
                Map.of("extension", extension));
    }
}

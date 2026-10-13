// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.context.NoOrganizationException;
import dev.mosaikit.kernel.api.secrets.SecretValue;
import dev.mosaikit.kernel.api.secrets.Secrets;
import dev.mosaikit.kernel.api.secrets.SecretsUnavailableException;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.secrets.SecretKeys.MasterKey;
import io.quarkus.arc.Arc;
import io.quarkus.arc.ArcContainer;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;
import org.jboss.logging.Logger;

/**
 * The kernel's {@link Secrets} bean (MK-062, MK-127): extension backends read the credentials of the
 * organization of the request, and of the installation, decrypted on the server at the moment of the
 * call. A credential meant for one extension is read by that extension only. Every read, and every
 * refusal to decrypt, is in the audit log through the channel {@code EXTENSION}, without the value: a
 * credential of an organization in the log of that organization, one of the installation in the log
 * of the platform.
 */
@ApplicationScoped
@Transactional
public class SecretVault implements Secrets {

    private static final Logger LOG = Logger.getLogger(SecretVault.class);

    private final StoredSecrets secrets;
    private final Function<String, Optional<InstallationSecret>> installation;
    private final SecretKeys keys;
    private final Predicate<String> active;
    private final Supplier<Optional<UUID>> organization;
    private final Supplier<Optional<String>> person;
    private final AuditLog audit;

    @Inject
    public SecretVault(
            StoredSecrets secrets,
            InstallationSecretReader installation,
            SecretKeys keys,
            ExtensionRegistry extensions,
            CurrentOrganization organization,
            SecurityIdentity identity,
            AuditLog audit) {
        this(
                secrets,
                installation::find,
                keys,
                id -> extensions.findActive(id).isPresent(),
                () -> inRequest() ? organization.id() : Optional.empty(),
                () -> inRequest() && !identity.isAnonymous()
                        ? Optional.of(identity.getPrincipal().getName())
                        : Optional.empty(),
                audit);
    }

    SecretVault(
            StoredSecrets secrets,
            Function<String, Optional<InstallationSecret>> installation,
            SecretKeys keys,
            Predicate<String> active,
            Supplier<Optional<UUID>> organization,
            Supplier<Optional<String>> person,
            AuditLog audit) {
        this.secrets = secrets;
        this.installation = installation;
        this.keys = keys;
        this.active = active;
        this.organization = organization;
        this.person = person;
        this.audit = audit;
    }

    @Override
    public Optional<SecretValue> find(String extension, String name) {
        check(extension, name);
        UUID org = organization.get().orElseThrow(NoOrganizationException::new);
        return ofOrganization(org, extension, name).map(secret -> open(secret, Optional.of(org), extension));
    }

    /**
     * The credential of the organization of the request that the extension may read, otherwise the
     * one of the installation (MK-127); outside any organization, the one of the installation.
     */
    @Override
    public Optional<SecretValue> resolve(String extension, String name) {
        check(extension, name);
        Optional<UUID> org = organization.get();
        if (org.isPresent()) {
            Optional<StoredSecret> own = ofOrganization(org.get(), extension, name);
            if (own.isPresent()) {
                return Optional.of(open(own.get(), org, extension));
            }
        }
        return installation
                .apply(name)
                .filter(secret -> secret.readableBy(extension))
                .map(secret -> open(secret, org, extension));
    }

    private void check(String extension, String name) {
        Objects.requireNonNull(extension, "extension");
        Objects.requireNonNull(name, "name");
        if (!active.test(extension)) {
            throw new IllegalArgumentException(extension + " is not an active extension.");
        }
        if (!keys.enabled()) {
            throw new SecretsUnavailableException(keys.disabled().getMessage());
        }
    }

    private Optional<StoredSecret> ofOrganization(UUID org, String extension, String name) {
        return secrets.find(org, name).filter(secret -> secret.readableBy(extension));
    }

    /**
     * Decrypts a credential and records the read: in the log of its organization for a credential
     * of an organization, in the log of the platform, naming the organization of the request if any,
     * for one of the installation.
     */
    private SecretValue open(SealedCredential secret, Optional<UUID> requestOrganization, String extension) {
        boolean ofInstallation = secret instanceof InstallationSecret;
        Optional<UUID> log = ofInstallation ? Optional.empty() : requestOrganization;
        Optional<MasterKey> master = keys.find(secret.getKeyId());
        byte[] plain = null;
        try {
            if (master.isEmpty()) {
                throw new SecretCipher.UnreadableException();
            }
            plain = SecretCipher.open(master.get(), secret.binding(), secret.getWrappedKey(), secret.getCiphertext());
            record(log, requestOrganization, extension, secret, AuditEvent.Outcome.SUCCEEDED);
            return SecretValue.ofUtf8(plain);
        } catch (SecretCipher.UnreadableException _) {
            LOG.warnf(
                    "The credential %s of %s does not decrypt with the master keys of the installation: its key"
                            + " %s is missing from mosaikit.secrets.previous-keys, or the row was altered",
                    secret.getName(),
                    ofInstallation ? "the installation" : "the organization " + requestOrganization.orElse(null),
                    secret.getKeyId());
            record(log, requestOrganization, extension, secret, AuditEvent.Outcome.FAILED);
            throw new SecretsUnavailableException("The credential " + secret.getName()
                    + " cannot be decrypted with the master keys of the installation.");
        } finally {
            if (plain != null) {
                Arrays.fill(plain, (byte) 0);
            }
        }
    }

    private void record(
            Optional<UUID> log,
            Optional<UUID> requestOrganization,
            String extension,
            SealedCredential secret,
            AuditEvent.Outcome outcome) {
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("extension", extension);
        if (log.isEmpty()) {
            detail.put("scope", "installation");
            requestOrganization.ifPresent(org -> detail.put("organization", org.toString()));
        }
        audit.append(
                AuditEvent.Channel.EXTENSION,
                person.get().orElse(extension),
                log,
                "secrets.read",
                "secret/" + secret.getName(),
                outcome,
                detail);
    }

    /** Whether a request is active: outside one, such as in a scheduled job, there is no organization. */
    private static boolean inRequest() {
        ArcContainer container = Arc.container();
        return container != null && container.requestContext().isActive();
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.identity.OrganizationAccess;
import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.identity.IdentityProviderManager;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Optional;
import java.util.UUID;

/**
 * Checks the credentials of a person on behalf of a service (MK-124), such as a gateway that received
 * them: the value of the session cookie of the shell (MK-125) or a personal access key (MK-060). The
 * same rules apply as when the person calls the kernel with them: an ended or expired session, a
 * revoked or expired key, a suspended person, open nothing.
 */
@ApplicationScoped
public class CredentialCheck {

    /**
     * A person whose credentials were valid.
     *
     * @param identity what the kernel would see in a request of the person with those credentials
     * @param key the key checked, when a key was checked
     */
    public record Person(UserAccount account, SecurityIdentity identity, Optional<AccessKey> key) {}

    private final SessionRegistry sessions;
    private final AccountService accounts;
    private final LocalIdentityProvider local;
    private final AccessKeyRegistry keys;
    private final IdentityProviderManager identities;

    public CredentialCheck(
            SessionRegistry sessions,
            AccountService accounts,
            LocalIdentityProvider local,
            AccessKeyRegistry keys,
            IdentityProviderManager identities) {
        this.sessions = sessions;
        this.accounts = accounts;
        this.local = local;
        this.keys = keys;
        this.identities = identities;
    }

    /**
     * The person of a session cookie, acting on an organization as the shell would.
     *
     * @param organization the slug of the organization, as the shell names it with {@code
     *     X-Mosaikit-Organization}, or {@code null}
     */
    public Optional<Person> session(String cookie, String organization) {
        Optional<SessionRegistry.Active> session = sessions.byCookie(cookie);
        if (session.isEmpty()) {
            return Optional.empty();
        }
        return accounts.findForAuthentication(session.get().accountId())
                .filter(account -> account.getPasswordHash().isPresent())
                .filter(UserAccount::isEmailConfirmed)
                .filter(account -> !account.isSuspended())
                .map(account -> {
                    SecurityIdentity identity = local.identityOf(
                            account, organization, null, session.get().id());
                    sessions.seen(session.get(), null);
                    return new Person(account, identity, Optional.empty());
                });
    }

    /** The person of a personal access key, on the organization of the key. */
    public Optional<Person> key(String key) {
        if (key == null || !AccessKeyRegistry.looksLikeKey(key)) {
            return Optional.empty();
        }
        SecurityIdentity identity;
        try {
            identity = identities.authenticateBlocking(new AccessKeyAuthenticationRequest(key));
        } catch (AuthenticationFailedException _) {
            return Optional.empty();
        }
        UUID account = UUID.fromString(identity.getAttribute(OrganizationAccess.ACCOUNT_ATTRIBUTE));
        UUID id = UUID.fromString(identity.getAttribute(AccessKeyRegistry.ATTRIBUTE));
        return accounts.findForAuthentication(account).map(found -> new Person(found, identity, keys.byId(id)));
    }
}

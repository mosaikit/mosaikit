// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import dev.mosaikit.kernel.core.account.UserAccount;
import dev.mosaikit.kernel.core.account.UserAccounts;
import dev.mosaikit.kernel.core.organization.OrganizationMember;
import dev.mosaikit.kernel.core.organization.OrganizationMembers;
import io.quarkus.security.AuthenticationFailedException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import jakarta.transaction.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
import java.util.Optional;
import org.jboss.logging.Logger;

/**
 * The accounts of people who sign in through the realm of an organization (MK-012, MK-017).
 *
 * <p>A person is found by the membership linked to their subject in the realm. At the first
 * sign-in, a new email address gets a new account and a membership. An account that already
 * exists, for example the local account of the person in another organization, is linked only to a
 * membership that a manager created for it in this organization, and only if the realm verified
 * the address: a realm can never take over an account that does not belong to its organization.
 */
@ApplicationScoped
public class FederatedAccounts {

    private static final Logger LOG = Logger.getLogger(FederatedAccounts.class);

    /**
     * The account of the person and their membership in the organization of the realm.
     *
     * @param account the account
     * @param member the membership, with the roles in the organization
     */
    public record Member(UserAccount account, OrganizationMember member) {}

    private final UserAccounts accounts;
    private final OrganizationMembers members;
    private final Clock clock;

    public FederatedAccounts(UserAccounts accounts, OrganizationMembers members, Clock clock) {
        this.accounts = accounts;
        this.members = members;
        this.clock = clock;
    }

    /** Returns the account and the membership of the person, creating or linking them at the first sign-in. */
    @ActivateRequestContext
    @Transactional
    public Member signIn(FederatedSignIn signIn) {
        Optional<OrganizationMember> linked =
                members.findByOrganizationIdAndIdentitySubject(signIn.organizationId(), signIn.subject());
        if (linked.isPresent()) {
            UserAccount account =
                    accounts.findById(linked.get().getAccountId()).orElseThrow(AuthenticationFailedException::new);
            return new Member(account, synchronizeRoles(linked.get(), signIn));
        }
        String username = signIn.email().trim().toLowerCase(Locale.ROOT);
        Optional<UserAccount> sameEmail = accounts.findByUsername(username);
        if (sameEmail.isEmpty()) {
            var account = UserAccount.withoutPassword(username, signIn.displayName(), Instant.now(clock));
            accounts.insert(account);
            var member = new OrganizationMember(
                    account.getId(), signIn.organizationId(), signIn.roles(), Instant.now(clock));
            member.linkIdentity(signIn.subject());
            members.insert(member);
            return new Member(account, member);
        }
        UserAccount existing = sameEmail.get();
        Optional<OrganizationMember> invited =
                members.findByAccountIdAndOrganizationId(existing.getId(), signIn.organizationId());
        if (!signIn.emailVerified()
                || invited.isEmpty()
                || invited.get().getIdentitySubject().isPresent()) {
            LOG.warnf(
                    "Federated sign-in refused: the address of subject %s belongs to an account that is not a"
                            + " member of the organization, or is not verified",
                    signIn.subject());
            throw new AuthenticationFailedException();
        }
        OrganizationMember member = invited.get();
        member.linkIdentity(signIn.subject());
        member.replaceRoles(signIn.roles());
        members.update(member);
        return new Member(existing, member);
    }

    private OrganizationMember synchronizeRoles(OrganizationMember member, FederatedSignIn signIn) {
        if (!member.getRoles().equals(signIn.roles())) {
            member.replaceRoles(signIn.roles());
            members.update(member);
        }
        return member;
    }
}

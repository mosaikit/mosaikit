// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.organization.OrganizationMember;
import java.util.Set;
import java.util.UUID;

/**
 * A member of an organization (MK-017).
 *
 * @param linked whether the person has signed in through the realm of the organization
 * @param password whether the account has a local password
 */
public record MemberView(
        UUID accountId, String username, String displayName, Set<String> roles, boolean linked, boolean password) {

    static MemberView of(UserAccount account, OrganizationMember member) {
        return new MemberView(
                account.getId(),
                account.getUsername(),
                account.getDisplayName(),
                member.getRoles(),
                member.getIdentitySubject().isPresent(),
                account.getPasswordHash().isPresent());
    }
}

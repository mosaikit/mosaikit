// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.teams;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * The people and the teams of the organization of the request, read-only (MK-032, MK-123), for the
 * Java code of an extension that names them outside the kernel, such as in the rules of a map
 * server: the username of an account, the teams of the organization and their people. It answers
 * what the published views answer, for one organization, without a database login.
 *
 * <p>Unlike {@link Teams}, which answers what the person of the request sees, this bean answers for
 * the organization, as the extension acting in it:
 *
 * <ul>
 *   <li><strong>One organization.</strong> Every method acts on the organization of the request, or
 *       of the event a subscriber is handling (MK-085): a person who is not a member nor a guest of it
 *       is not found, and a team of another organization has no people.
 *   <li><strong>Teams, not chats.</strong> The teams of the organization and the groups of teams
 *       (MK-034) are listed, private ones too; the chats between people (MK-036) never.
 *   <li><strong>Guests see their teams only.</strong> When the person of the request is a guest of the
 *       organization, the answers are limited to the teams where they were added, the groups of those
 *       teams they are in, the people of those teams and the guest themselves.
 *   <li>A request without a person that a shared link admitted (MK-055) gets nobody and no team.
 * </ul>
 *
 * <p>The answers are for the backend of the extension: a private team is listed even when the
 * person of the request is not in it, so an extension that shows them to people uses
 * {@link Teams#visible()} for that. The kernel provides this bean to extensions.
 */
public interface People {

    /**
     * A person of the organization.
     *
     * @param account identifier of the account, as in {@code mk_published.account}
     * @param username the e-mail address with which the person signs in, in lower case
     * @param displayName the name shown for the person
     * @param active {@code false} while a platform administrator suspends the account
     * @param standing {@code administrator}, {@code member} or {@code guest} of the organization
     */
    record Person(UUID account, String username, String displayName, boolean active, String standing) {

        /** The e-mail address of the person, which is their username. */
        public String email() {
            return username;
        }
    }

    /**
     * A team of the organization, or a group of a team.
     *
     * @param visibility {@code public} or {@code private}; a group is always private
     * @param parent the team of a group, or {@code null} for a team
     */
    record OrganizationTeam(UUID id, String name, String description, String visibility, UUID parent) {}

    /** The person with this account, when they are a member or a guest of the organization. */
    Optional<Person> find(UUID account);

    /**
     * The person with this username, in any case, when they are a member or a guest of the
     * organization.
     */
    Optional<Person> findByUsername(String username);

    /** The people of the organization: administrators, members and guests, by display name. */
    List<Person> list();

    /** The teams of the organization and the groups of teams, never chats, by name. */
    List<OrganizationTeam> teams();

    /**
     * The people of a team or group of the organization, owners first, or an empty list when it is not
     * one of {@link #teams()}.
     */
    List<Teams.Member> members(UUID team);

    /** The teams and groups of {@link #teams()} where a person is, whatever their role. */
    List<OrganizationTeam> teamsOf(UUID account);
}

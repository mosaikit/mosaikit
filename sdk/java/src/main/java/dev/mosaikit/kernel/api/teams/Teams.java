// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.teams;

import java.util.List;
import java.util.UUID;

/**
 * The teams of the organization of the request (MK-032): groups with owners, members and guests,
 * which the plugins read to share their data with a group. A guest is a person of another
 * organization who sees only the teams where they were added.
 */
public interface Teams {

    /**
     * A team.
     *
     * @param visibility {@code public}, listed to every member of the organization, or {@code private}
     * @param role the role of the person of the request in the team, or {@code null} when not in it
     * @param parent the team of a group, such as a private channel, or {@code null} for a team
     */
    record Team(UUID id, String name, String description, String visibility, String role, UUID parent) {}

    /**
     * A person of a team.
     *
     * @param role {@code owner}, {@code member} or {@code guest}
     */
    record Member(UUID account, String email, String displayName, String role) {}

    /** The teams that the person of the request sees: theirs and, unless a guest, the public ones. */
    List<Team> visible();

    /** The people of a team the person of the request sees, or an empty list. */
    List<Member> members(UUID team);

    /** Whether an account is in a team, whatever its role. */
    boolean isMember(UUID team, UUID account);
}

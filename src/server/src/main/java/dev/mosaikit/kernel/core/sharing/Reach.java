// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.extension.SubjectKind;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * The rules of sharing (MK-055, ADR-0037) on facts already read: which level a viewer has on a
 * resource. {@code mk_kernel.allows()} applies the same rules in the database.
 */
final class Reach {

    /**
     * Who asks.
     *
     * @param account the person, or {@code null} for a request without an account
     * @param member whether the person is a member of the organization of the resource
     * @param administrator whether the person administers that organization
     * @param guest whether the person is only a guest of it
     * @param teams the teams of the organization the person belongs to, guests included
     * @param link the link the request was opened with, or {@code null}
     */
    record Viewer(UUID account, boolean member, boolean administrator, boolean guest, Set<UUID> teams, UUID link) {

        Viewer {
            teams = Set.copyOf(teams);
        }

        /** Anyone: no account, no link. */
        static final Viewer ANYONE = new Viewer(null, false, false, false, Set.of(), null);
    }

    private Reach() {}

    /**
     * The highest level of the viewer on a resource: every level for its owner and for the
     * administrators of its organization (unless the type is private to its subjects,
     * {@link ResourceTypes#administratorsHoldEveryLevel}), otherwise the highest that a live grant reaching them gives,
     * capped at what its kind of subject may be given; empty when none reaches them.
     *
     * @param owner the owner of the resource, {@code null} when the organization owns it
     */
    static Optional<String> level(
            ResourceTypeEntry type, UUID owner, Viewer viewer, Collection<ResourceGrant> grants, Instant now) {
        List<String> names = type.levelNames();
        String top = names.getLast();
        if (viewer.account() != null && viewer.account().equals(owner)) {
            return Optional.of(top);
        }
        // Not for a type private to its subjects, such as the documents of a team (MK-032).
        if (viewer.administrator() && ResourceTypes.administratorsHoldEveryLevel(type)) {
            return Optional.of(top);
        }
        int best = -1;
        for (ResourceGrant grant : grants) {
            if (!grant.live(now) || !reaches(grant, viewer)) {
                continue;
            }
            int rank = names.indexOf(grant.getLevel());
            if (rank < 0) {
                continue;
            }
            int cap = names.indexOf(type.highestLevelFor(grant.kind()));
            best = Math.max(best, Math.min(rank, cap));
        }
        return best < 0 ? Optional.empty() : Optional.of(names.get(best));
    }

    /** Whether a grant is for the viewer, whatever its level. */
    static boolean reaches(ResourceGrant grant, Viewer viewer) {
        SubjectKind kind = grant.kind();
        return switch (kind) {
            case PUBLIC -> true;
            case ORGANIZATION -> viewer.account() != null && viewer.member() && !viewer.guest();
            case PERSON -> viewer.account() != null && viewer.account().equals(grant.getAccountId());
            case GROUP -> viewer.teams().contains(grant.getTeamId());
            case LINK -> grant.getId().equals(viewer.link());
        };
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.extension.SharingLevelEntry;
import dev.mosaikit.kernel.api.extension.SubjectKind;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The rules of sharing on facts already read (MK-055, ADR-0037). The rules against the database, the
 * SQL function and the REST API are tested in {@code SharingTest}.
 */
@Tag("MK-055")
class ReachTest {

    static final Instant NOW = Instant.parse("2026-10-13T10:00:00Z");
    static final UUID ORGANIZATION = UUID.randomUUID();
    static final UUID RESOURCE = UUID.randomUUID();
    static final UUID OWNER = UUID.randomUUID();
    static final UUID ADA = UUID.randomUUID();
    static final UUID TEAM = UUID.randomUUID();
    static final ResourceTypeEntry DASHBOARD = new ResourceTypeEntry(
            "dashboard",
            "Dashboard",
            List.of(
                    new SharingLevelEntry("view", "View", false, Map.of()),
                    new SharingLevelEntry("use", "Use", false, Map.of()),
                    new SharingLevelEntry("edit", "Edit", true, Map.of()),
                    new SharingLevelEntry("manage", "Manage", true, Map.of())),
            Set.of(SubjectKind.values()),
            "use",
            Map.of());

    private static Reach.Viewer member(UUID account, UUID... teams) {
        return new Reach.Viewer(account, true, false, false, Set.of(teams), null);
    }

    private static ResourceGrant grant(SubjectKind kind, UUID account, UUID team, String level) {
        return ResourceGrant.of(ORGANIZATION, RESOURCE, kind, account, team, level, OWNER, NOW);
    }

    private static ResourceGrant link(String level, Instant expires) {
        return ResourceGrant.link(ORGANIZATION, RESOURCE, level, OWNER, NOW, "digest", expires, null);
    }

    @Test
    void deniesByDefault() {
        assertThat(Reach.level(DASHBOARD, OWNER, member(ADA), List.of(), NOW)).isEmpty();
        assertThat(Reach.level(DASHBOARD, OWNER, Reach.Viewer.ANYONE, List.of(), NOW))
                .isEmpty();
    }

    @Test
    void theOwnerAndTheAdministratorsOfTheOrganizationHoldEveryLevel() {
        assertThat(Reach.level(DASHBOARD, OWNER, member(OWNER), List.of(), NOW)).contains("manage");
        Reach.Viewer administrator = new Reach.Viewer(ADA, true, true, false, Set.of(), null);
        assertThat(Reach.level(DASHBOARD, OWNER, administrator, List.of(), NOW)).contains("manage");
        // A resource of the organization: its administrators manage it, nobody else.
        assertThat(Reach.level(DASHBOARD, null, administrator, List.of(), NOW)).contains("manage");
        assertThat(Reach.level(DASHBOARD, null, member(ADA), List.of(), NOW)).isEmpty();
    }

    @Test
    void aPlatformAdministratorIsAPersonLikeAnyOther() {
        // The kernel never marks a platform administrator as administrator of an organization; they
        // reach a resource only through grants, as any person.
        Reach.Viewer platform = member(ADA);
        assertThat(Reach.level(DASHBOARD, OWNER, platform, List.of(), NOW)).isEmpty();
    }

    @Test
    void theHighestLevelAmongTheGrantsThatReachThePersonWins() {
        List<ResourceGrant> grants = List.of(
                grant(SubjectKind.ORGANIZATION, null, null, "view"),
                grant(SubjectKind.GROUP, null, TEAM, "edit"),
                grant(SubjectKind.PERSON, ADA, null, "use"));

        assertThat(Reach.level(DASHBOARD, OWNER, member(ADA, TEAM), grants, NOW))
                .contains("edit");
        assertThat(Reach.level(DASHBOARD, OWNER, member(ADA), grants, NOW)).contains("use");
        assertThat(Reach.level(DASHBOARD, OWNER, member(UUID.randomUUID()), grants, NOW))
                .contains("view");
    }

    @Test
    void guestsAreNotTheOrganizationButAreInTheirTeams() {
        Reach.Viewer guest = new Reach.Viewer(ADA, true, false, true, Set.of(TEAM), null);

        assertThat(Reach.level(
                        DASHBOARD, OWNER, guest, List.of(grant(SubjectKind.ORGANIZATION, null, null, "edit")), NOW))
                .isEmpty();
        assertThat(Reach.level(DASHBOARD, OWNER, guest, List.of(grant(SubjectKind.GROUP, null, TEAM, "view")), NOW))
                .contains("view");
    }

    @Test
    void thePublicAndLinksAreCappedAtCheckToo() {
        // Grants written before the manifest lowered what a kind may get give no more than it allows now.
        ResourceGrant everyone = grant(SubjectKind.PUBLIC, null, null, "edit");
        assertThat(Reach.level(DASHBOARD, OWNER, Reach.Viewer.ANYONE, List.of(everyone), NOW))
                .contains("view");

        ResourceGrant link = link("manage", NOW.plusSeconds(60));
        Reach.Viewer opened = new Reach.Viewer(null, false, false, false, Set.of(), link.getId());
        assertThat(Reach.level(DASHBOARD, OWNER, opened, List.of(link), NOW)).contains("use");
        assertThat(Reach.level(DASHBOARD, OWNER, Reach.Viewer.ANYONE, List.of(link), NOW))
                .isEmpty();
    }

    @Test
    void anExpiredOrRevokedLinkGivesNothing() {
        ResourceGrant expired = link("view", NOW);
        Reach.Viewer withExpired = new Reach.Viewer(null, false, false, false, Set.of(), expired.getId());
        assertThat(Reach.level(DASHBOARD, OWNER, withExpired, List.of(expired), NOW))
                .isEmpty();

        ResourceGrant revoked = link("view", NOW.plusSeconds(60));
        revoked.revoke(NOW);
        Reach.Viewer withRevoked = new Reach.Viewer(null, false, false, false, Set.of(), revoked.getId());
        assertThat(Reach.level(DASHBOARD, OWNER, withRevoked, List.of(revoked), NOW))
                .isEmpty();
    }

    @Test
    void aLevelNoLongerDeclaredGivesNothing() {
        assertThat(Reach.level(
                        DASHBOARD, OWNER, member(ADA), List.of(grant(SubjectKind.PERSON, ADA, null, "own")), NOW))
                .isEmpty();
    }
}

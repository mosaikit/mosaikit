// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.permissions;

import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.core.permissions.PermissionResolver.Standing;
import dev.mosaikit.kernel.core.security.Roles;
import java.util.Set;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * How the roles of a person in an organization decide where their permissions come from (MK-056,
 * ADR-0038). A platform administrator signed in to an organization of which they are not a member
 * cannot be made over HTTP, since the kernel only lets people act on their organizations.
 */
@Tag("MK-056")
class StandingTest {

    @Test
    void platformAdministratorsHoldNothingForBeingPlatformAdministrators() {
        assertThat(Standing.of(Set.of(Roles.PLATFORM_ADMIN))).isEqualTo(Standing.NONE);
        // Only what their membership gives them.
        assertThat(Standing.of(Set.of(Roles.PLATFORM_ADMIN, Roles.ORGANIZATION_USER)))
                .isEqualTo(Standing.MEMBER);
        assertThat(Standing.of(Set.of(Roles.PLATFORM_ADMIN, Roles.ORGANIZATION_ADMIN)))
                .isEqualTo(Standing.ADMINISTRATOR);
    }

    @Test
    void administratorsComeFirstAndGuestsLast() {
        assertThat(Standing.of(Set.of(Roles.ORGANIZATION_ADMIN, Roles.ORGANIZATION_USER)))
                .isEqualTo(Standing.ADMINISTRATOR);
        assertThat(Standing.of(Set.of(Roles.ORGANIZATION_USER, Roles.ORGANIZATION_GUEST)))
                .isEqualTo(Standing.MEMBER);
        assertThat(Standing.of(Set.of(Roles.ORGANIZATION_GUEST))).isEqualTo(Standing.GUEST);
        assertThat(Standing.of(Set.of())).isEqualTo(Standing.NONE);
    }
}

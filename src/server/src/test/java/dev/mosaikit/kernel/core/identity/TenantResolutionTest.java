// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.security.Roles;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Set;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("MK-012")
class TenantResolutionTest {

    private static String jwt(String claims) {
        var encoder = Base64.getUrlEncoder().withoutPadding();
        return encoder.encodeToString("{\"alg\":\"RS256\"}".getBytes(StandardCharsets.UTF_8)) + "."
                + encoder.encodeToString(claims.getBytes(StandardCharsets.UTF_8)) + ".c2lnbmF0dXJl";
    }

    @Test
    void readsTheBearerToken() {
        assertThat(OrganizationTenantResolver.bearerToken("Bearer abc.def.ghi")).contains("abc.def.ghi");
        assertThat(OrganizationTenantResolver.bearerToken("bearer abc")).contains("abc");
        assertThat(OrganizationTenantResolver.bearerToken("Basic YWRtaW46YWRtaW4="))
                .isEmpty();
        assertThat(OrganizationTenantResolver.bearerToken("Bearer ")).isEmpty();
        assertThat(OrganizationTenantResolver.bearerToken(null)).isEmpty();
    }

    @Test
    void readsTheIssuerOfATokenOnlyWhenItIsWellFormed() {
        var json = new ObjectMapper();

        assertThat(OrganizationTenantResolver.issuer(json, jwt("{\"iss\":\"https://auth.example.org/realms/acme\"}")))
                .contains("https://auth.example.org/realms/acme");
        assertThat(OrganizationTenantResolver.issuer(json, jwt("{\"iss\":42}"))).isEmpty();
        assertThat(OrganizationTenantResolver.issuer(json, jwt("not json"))).isEmpty();
        assertThat(OrganizationTenantResolver.issuer(json, "a.b")).isEmpty();
        assertThat(OrganizationTenantResolver.issuer(json, "a.%%%.c")).isEmpty();
    }

    @Test
    void namesTenantsAfterTheOrganizationAndItsRealm() {
        String tenant = TenantIds.of("acme", "acme-realm");

        assertThat(TenantIds.slug(tenant)).contains("acme");
        assertThat(TenantIds.slug("Default")).isEmpty();
        assertThat(TenantIds.slug("org//realm")).isEmpty();
        assertThat(TenantIds.slug(null)).isEmpty();
    }

    @Test
    void grantsOnlyKernelRolesOfTheOrganization() {
        assertThat(FederatedIdentityAugmentor.kernelRoles(Set.of("organization-admin", "platform-admin")))
                .containsExactlyInAnyOrder(Roles.ORGANIZATION_ADMIN, Roles.ORGANIZATION_USER);
        assertThat(FederatedIdentityAugmentor.kernelRoles(Set.of("platform-admin", "offline_access")))
                .containsExactly(Roles.ORGANIZATION_USER);
    }
}

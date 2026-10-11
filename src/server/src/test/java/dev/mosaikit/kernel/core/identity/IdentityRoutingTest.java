// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("MK-012")
class IdentityRoutingTest {

    private static final OrganizationIdentity ACME = new OrganizationIdentity(
            UUID.randomUUID(), "acme", Optional.of("acme-realm"), Set.of("acme.com", "acme.it"));
    private static final OrganizationIdentity LOCAL =
            new OrganizationIdentity(UUID.randomUUID(), "local", Optional.empty(), Set.of("local.org"));

    private static IdentityRouting routing(String keycloakUrl, String domain) {
        return new IdentityRouting(
                Optional.ofNullable(keycloakUrl).map(URI::create), Optional.ofNullable(domain), List.of(ACME, LOCAL));
    }

    @Test
    void choosesTheOrganizationFromItsSubDomain() {
        var routing = routing("https://auth.example.org", "mosaikit.example.org");

        assertThat(routing.byHost("acme.mosaikit.example.org")).contains(ACME);
        assertThat(routing.byHost("ACME.Mosaikit.Example.org:8443")).contains(ACME);
        assertThat(routing.byHost("local.mosaikit.example.org")).contains(LOCAL);
        assertThat(routing.byHost("mosaikit.example.org")).isEmpty();
        assertThat(routing.byHost("x.acme.mosaikit.example.org")).isEmpty();
        assertThat(routing.byHost("acme.evil.org")).isEmpty();
        assertThat(routing.byHost("[::1]:8080")).isEmpty();
        assertThat(routing.byHost(null)).isEmpty();
        assertThat(routing("https://auth.example.org", null).byHost("acme.mosaikit.example.org"))
                .isEmpty();
    }

    @Test
    void choosesTheOrganizationFromTheEmailDomain() {
        var routing = routing("https://auth.example.org", null);

        assertThat(routing.byEmail(" Mario.Rossi@ACME.it ")).contains(ACME);
        assertThat(routing.byEmail("someone@local.org")).contains(LOCAL);
        assertThat(routing.byEmail("someone@sub.acme.com")).isEmpty();
        assertThat(routing.byEmail("acme.com")).isEmpty();
        assertThat(routing.byEmail("someone@")).isEmpty();
        assertThat(routing.byEmail(null)).isEmpty();
    }

    @Test
    void choosesTheOrganizationFromTheIssuerOfItsRealm() {
        var routing = routing("https://auth.example.org/", null);

        assertThat(routing.issuer(ACME)).contains("https://auth.example.org/realms/acme-realm");
        assertThat(routing.byIssuer("https://auth.example.org/realms/acme-realm"))
                .contains(ACME);
        assertThat(routing.byIssuer("https://auth.example.org/realms/other")).isEmpty();
        assertThat(routing.byIssuer("https://auth.example.org/realms/acme-realm/x"))
                .isEmpty();
        assertThat(routing.byIssuer("https://evil.org/realms/acme-realm")).isEmpty();
        assertThat(routing.issuer(LOCAL)).isEmpty();
    }

    @Test
    void federatesNobodyWithoutAKeycloakUrl() {
        var routing = routing(null, null);

        assertThat(routing.federationEnabled()).isFalse();
        assertThat(routing.issuer(ACME)).isEmpty();
        assertThat(routing.byIssuer("https://auth.example.org/realms/acme-realm"))
                .isEmpty();
        assertThat(routing.byEmail("someone@acme.com")).contains(ACME);
    }
}

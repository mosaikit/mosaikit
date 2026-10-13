// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("MK-124")
class ServiceGuardTest {

    private static final ServiceIdentity.Grants GRANTS =
            new ServiceIdentity.Grants(Set.of("catalog"), Set.of(ServiceRegistry.CHECK_KEY), Set.of());

    @Test
    void findsWhatAPathIsToTheGrants() {
        assertThat(ServiceGuard.target("/api/v1/ext/catalog/items/3")).isEqualTo("catalog");
        assertThat(ServiceGuard.target("/api/v1/ext/catalog")).isEqualTo("catalog");
        assertThat(ServiceGuard.target("/api/v1/services/check")).isEqualTo(ServiceGuard.CHECK);
        assertThat(ServiceGuard.target("/api/v1/ext/")).isNull();
        assertThat(ServiceGuard.target("/api/v1/accounts/me")).isNull();
        assertThat(ServiceGuard.target("/")).isNull();
        assertThat(ServiceGuard.target(null)).isNull();
    }

    @Test
    void allowsOnlyTheApisAndTheEndpointsGiven() {
        assertThat(ServiceGuard.allowed(GRANTS, "catalog")).isTrue();
        assertThat(ServiceGuard.allowed(GRANTS, "orders")).isFalse();
        assertThat(ServiceGuard.allowed(GRANTS, ServiceGuard.CHECK)).isTrue();
        assertThat(ServiceGuard.allowed(GRANTS, null)).isFalse();
        assertThat(ServiceGuard.allowed(null, "catalog")).isFalse();
        var apisOnly = new ServiceIdentity.Grants(Set.of("check"), Set.of(), Set.of());
        // An API of extensions named like the endpoint of the kernel does not open the endpoint.
        assertThat(ServiceGuard.allowed(apisOnly, ServiceGuard.CHECK)).isFalse();
        assertThat(ServiceGuard.allowed(apisOnly, "check")).isTrue();
    }

    @Test
    void runsAfterTheSecurityHandlersOfQuarkusAndBeforeTheExtensionApis() {
        assertThat(ServiceGuard.ORDER).isGreaterThan(-100).isLessThan(-50);
    }

    @Test
    void tellsTheKeysOfServicesFromPersonalKeys() {
        assertThat(ServiceRegistry.looksLikeKey("mks_abc")).isTrue();
        assertThat(ServiceRegistry.looksLikeKey("mk_abc")).isFalse();
        assertThat(ServiceRegistry.looksLikeKey(null)).isFalse();
        assertThat(ServiceKeyMechanism.key("Bearer mks_abc")).contains("mks_abc");
        assertThat(ServiceKeyMechanism.key("bearer  mks_abc ")).contains("mks_abc");
        assertThat(ServiceKeyMechanism.key("Bearer mk_abc")).isEmpty();
        assertThat(ServiceKeyMechanism.key("Basic mks_abc")).isEmpty();
        assertThat(ServiceKeyMechanism.key(null)).isEmpty();
        assertThat(ServiceKeyMechanism.PRIORITY).isGreaterThan(2000);
    }

    @Test
    void auditsTheFirstUseOfEachApiInAnHour() {
        var registry = new ServiceRegistry(null, java.time.Clock.systemUTC(), java.time.Duration.ZERO);
        UUID service = UUID.randomUUID();
        assertThat(registry.firstUseThisHour(service, "catalog")).isTrue();
        assertThat(registry.firstUseThisHour(service, "catalog")).isFalse();
        assertThat(registry.firstUseThisHour(service, "orders")).isTrue();
        assertThat(registry.firstUseThisHour(UUID.randomUUID(), "catalog")).isTrue();
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static org.assertj.core.api.Assertions.assertThat;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Forwarded headers are on, but only from a proxy that is not the client (issue #97): a client that
 * reaches the kernel directly cannot make it believe the request was HTTPS, so its cookies follow
 * the scheme of the connection, plain HTTP here.
 */
@QuarkusTest
@TestProfile(SecureCookieUntrustedProxyTest.OtherProxy.class)
@Tag("MK-125")
@Tag("MK-047")
class SecureCookieUntrustedProxyTest {

    /** Forwarded headers trusted from 192.0.2.10 only, an address of documentation. */
    public static class OtherProxy implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of(
                    "quarkus.http.proxy.proxy-address-forwarding", "true",
                    "quarkus.http.proxy.allow-x-forwarded", "true",
                    "quarkus.http.proxy.trusted-proxies", "192.0.2.10");
        }
    }

    @Test
    void aForwardedSchemeFromAnUntrustedClientIsIgnored() {
        assertThat(SecureCookieBehindProxyTest.cookies(true)).containsExactly(false, false, false, false);
    }
}

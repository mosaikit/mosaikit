// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web.csp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The origins the content security policy accepts, and the policy built with them (MK-128). */
@Tag("MK-128")
class ExternalOriginsTest {

    @Test
    void acceptsSchemeHostAndPortInTheirNormalForm() {
        assertThat(ExternalOrigins.normalize("https://Tiles.Example.org/")).contains("https://tiles.example.org");
        assertThat(ExternalOrigins.normalize("https://tiles.example.org:443")).contains("https://tiles.example.org");
        assertThat(ExternalOrigins.normalize("http://10.0.0.5:8080")).contains("http://10.0.0.5:8080");
        assertThat(ExternalOrigins.normalize("wss://live.example.org")).contains("wss://live.example.org");
        assertThat(ExternalOrigins.normalize("ws://live.example.org:80")).contains("ws://live.example.org");
        assertThat(ExternalOrigins.normalize("https://*.tiles.example.org")).contains("https://*.tiles.example.org");
        assertThat(ExternalOrigins.normalize("https://*.example.org")).contains("https://*.example.org");
        assertThat(ExternalOrigins.normalize("https://bücher.example")).contains("https://xn--bcher-kva.example");
    }

    @Test
    void refusesWhatWouldOpenThePolicyToMore() {
        for (String refused : List.of(
                "*",
                "https://*",
                "https://*.org",
                "https://*.10.0.0.5",
                "https://a.*.example.org",
                "https:",
                "data:",
                "blob:",
                "'self'",
                "https://a.example.org/maps",
                "https://a.example.org#x",
                "https://user:pw@a.example.org",
                "https://a.example.org https://b.example.org",
                "https://a.example.org;script-src",
                "https://a.example.org,b",
                "file:///etc",
                "https://a.example.org:65536",
                "https://300.1.1.1",
                "https://1.2.3",
                "https://a..example.org",
                "https://a.example.org.",
                " ",
                "x".repeat(400))) {
            assertThat(ExternalOrigins.normalize(refused)).as(refused).isEmpty();
        }
        assertThat(ExternalOrigins.normalize(null)).isEmpty();
    }

    @Test
    void withoutOriginsThePolicyIsTheOneOfTheKernelBefore() {
        assertThat(ContentSecurityPolicy.policy(Optional.of("https://auth.example.org"), List.of()))
                .isEqualTo("default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'"
                        + " https://auth.example.org; object-src 'none'; base-uri 'self'; form-action 'none';"
                        + " frame-ancestors 'none'");
        assertThat(ContentSecurityPolicy.policy(Optional.empty(), List.of("https://tiles.example.org")))
                .isEqualTo("default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'"
                        + " https://tiles.example.org; connect-src 'self' https://tiles.example.org; object-src"
                        + " 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'");
    }

    @Test
    void theKernelDoesNotStartWithAnOriginOfTheConfigurationThatItRefuses() {
        assertThat(ContentSecurityPolicy.configured(List.of("https://a.example.org/", " ", "https://a.example.org")))
                .containsExactly("https://a.example.org");
        assertThatThrownBy(() -> ContentSecurityPolicy.configured(List.of("https://*")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("mosaikit.content-security-policy.allowed-origins")
                .hasMessageContaining("https://*");
    }
}

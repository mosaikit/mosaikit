// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web.embed;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.core.error.InvalidInputException;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The framing of the embed mode (MK-100), on its own: which addresses, which header, which sites. */
@Tag("MK-100")
class EmbedFramingTest {

    @Test
    void onlyTheAddressesOfTheEmbedModeNameAnOrganization() {
        assertThat(EmbedFraming.organizationOf("/embed/acme/app/maps")).contains("acme");
        assertThat(EmbedFraming.organizationOf("/embed/acme")).contains("acme");
        assertThat(EmbedFraming.organizationOf("/embed/Not A Slug/app")).contains("");
        assertThat(EmbedFraming.organizationOf("/embed/")).contains("");
        assertThat(EmbedFraming.organizationOf("/embed")).isEmpty();
        assertThat(EmbedFraming.organizationOf("/app/embed/acme")).isEmpty();
        assertThat(EmbedFraming.organizationOf("/")).isEmpty();
        assertThat(EmbedFraming.organizationOf(null)).isEmpty();
    }

    @Test
    void theDirectiveReplacesTheOneOfThePolicyAndKeepsTheRest() {
        String ancestors = EmbedFraming.frameAncestors(List.of("https://www.example.org", "https://*.example.com"));
        assertThat(ancestors).isEqualTo("frame-ancestors 'self' https://www.example.org https://*.example.com");
        assertThat(EmbedFraming.frameAncestors(List.of())).isEqualTo("frame-ancestors 'self'");

        String kernel = "default-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'";
        assertThat(EmbedFraming.policy(Optional.of(kernel), ancestors))
                .isEqualTo("default-src 'self'; connect-src 'self'; form-action 'none'; " + ancestors);
        // Without a policy (development), the directive alone: framing is refused by default anyway.
        assertThat(EmbedFraming.policy(Optional.empty(), ancestors)).isEqualTo(ancestors);
        assertThat(EmbedFraming.policy(Optional.of("default-src 'self'"), ancestors))
                .isEqualTo("default-src 'self'; " + ancestors);
    }

    @Test
    void aSiteIsAnOriginOfTheWebWithoutAPath() {
        assertThat(EmbedSiteAdministration.normalize("HTTPS://WWW.Example.org:443/"))
                .isEqualTo("https://www.example.org");
        assertThat(EmbedSiteAdministration.normalize("http://localhost:5173")).isEqualTo("http://localhost:5173");
        assertThat(EmbedSiteAdministration.normalize("https://*.example.org")).isEqualTo("https://*.example.org");
        for (String wrong : List.of(
                "wss://www.example.org",
                "https://www.example.org/page",
                "www.example.org",
                "https://*.org",
                "*",
                "'self'",
                "https://www.example.org 'unsafe-inline'")) {
            assertThatThrownBy(() -> EmbedSiteAdministration.normalize(wrong))
                    .as(wrong)
                    .isInstanceOf(InvalidInputException.class);
        }
    }
}

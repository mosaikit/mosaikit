// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** A signed link to files, and the paths of the files under a prefix (MK-093). */
@Tag("MK-093")
class SignedLinkTest {

    @Test
    void aFileUnderAPrefixIsTheBaseItsEncodedNameAndTheQuery() {
        SignedLink link = new SignedLink(
                "/api/v1/files/signed/o/org.example.maps/named/tiles/?prefix=tiles%2F&expires=1&signature=s",
                "/api/v1/files/signed/o/org.example.maps/named/",
                "prefix=tiles%2F&expires=1&signature=s",
                Instant.EPOCH);

        assertThat(link.file("tiles/3/4/2 a.png"))
                .isEqualTo("/api/v1/files/signed/o/org.example.maps/named/tiles/3/4/2%20a.png"
                        + "?prefix=tiles%2F&expires=1&signature=s");
        assertThatThrownBy(() -> new SignedLink(null, "b", "q", Instant.EPOCH))
                .isInstanceOf(NullPointerException.class);
    }
}

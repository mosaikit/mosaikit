// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The signature of links to files and the keys that sign them (MK-093). */
@Tag("MK-093")
class FileLinkTest {

    static final UUID ACME = UUID.fromString("00000000-0000-0000-0000-000000000ace");
    static final UUID FILE = UUID.randomUUID();
    static final Instant EXPIRES = Instant.parse("2026-10-20T10:00:00Z");

    private static byte[] key(int value) {
        byte[] key = new byte[32];
        Arrays.fill(key, (byte) value);
        return key;
    }

    private static String base64(byte[] key) {
        return Base64.getEncoder().encodeToString(key);
    }

    @Test
    void aSignatureVerifiesOnlyTheGrantItSigned() {
        FileLink link = new FileLink(ACME, "org.example.maps", FILE, null, null, EXPIRES);
        String signature = link.signature(key(1));
        assertThat(link.verifies(signature, List.of(key(1)))).isTrue();
        assertThat(link.verifies(signature, List.of(key(2)))).isFalse();
        assertThat(link.verifies("not base64 !", List.of(key(1)))).isFalse();

        List<FileLink> altered = List.of(
                new FileLink(UUID.randomUUID(), "org.example.maps", FILE, null, null, EXPIRES),
                new FileLink(ACME, "org.example.other", FILE, null, null, EXPIRES),
                new FileLink(ACME, "org.example.maps", UUID.randomUUID(), null, null, EXPIRES),
                new FileLink(ACME, "org.example.maps", FILE, null, null, EXPIRES.plusSeconds(1)),
                new FileLink(ACME, "org.example.maps", null, FILE.toString(), null, EXPIRES));
        for (FileLink other : altered) {
            assertThat(other.verifies(signature, List.of(key(1))))
                    .as(other.toString())
                    .isFalse();
        }
    }

    @Test
    @Tag("MK-055")
    void aLinkSignsItsCreatorWhichCannotBeDroppedOrChanged() {
        UUID ada = UUID.randomUUID();
        FileLink withoutCreator = new FileLink(ACME, "org.example.maps", null, "tiles/", null, EXPIRES);
        FileLink ofAda = new FileLink(ACME, "org.example.maps", null, "tiles/", null, EXPIRES, ada);
        String signature = ofAda.signature(key(1));
        assertThat(ofAda.verifies(signature, List.of(key(1)))).isTrue();
        assertThat(withoutCreator.verifies(signature, List.of(key(1)))).isFalse();
        assertThat(new FileLink(ACME, "org.example.maps", null, "tiles/", null, EXPIRES, UUID.randomUUID())
                        .verifies(signature, List.of(key(1))))
                .isFalse();
        assertThat(ofAda.query(signature)).contains("&expires=").contains("&creator=" + ada + "&signature=");
        // A link without a creator keeps the signed text, and the query, of the first version.
        assertThat(withoutCreator.signed()).startsWith("mosaikit.files.link.v1\n");
        assertThat(withoutCreator.query("s")).doesNotContain("creator");
    }

    @Test
    void aLinkToAPrefixSignsItsTeam() {
        UUID team = UUID.randomUUID();
        FileLink link = new FileLink(ACME, "org.example.maps", null, "tiles/", team, EXPIRES);
        String signature = link.signature(key(1));
        assertThat(new FileLink(ACME, "org.example.maps", null, "tiles/", null, EXPIRES)
                        .verifies(signature, List.of(key(1))))
                .isFalse();
        assertThat(new FileLink(ACME, "org.example.maps", null, "tiles", team, EXPIRES)
                        .verifies(signature, List.of(key(1))))
                .isFalse();
        assertThat(link.base()).isEqualTo("/api/v1/files/signed/" + ACME + "/org.example.maps/named/");
        assertThat(link.query(signature))
                .isEqualTo("prefix=tiles%2F&team=" + team + "&expires=" + EXPIRES.getEpochSecond() + "&signature="
                        + signature);
        assertThat(FileLink.path("plans/a b.png")).isEqualTo("plans/a%20b.png");
    }

    @Test
    void aLinkIsToAFileOrToAPrefix() {
        assertThatThrownBy(() -> new FileLink(ACME, "org.example.maps", FILE, "x", null, EXPIRES))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new FileLink(ACME, "org.example.maps", null, null, null, EXPIRES))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new FileLink(ACME, "org.example.maps", FILE, null, UUID.randomUUID(), EXPIRES))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void theKeysComeFromTheSettingOrFromTheMasterKeys() {
        LinkKeys configured = new LinkKeys(Optional.of(base64(key(7))), List.of(base64(key(8))), List.of(key(1)));
        assertThat(configured.source()).isEqualTo(LinkKeys.Source.CONFIGURED);
        assertThat(configured.current()).isEqualTo(key(7));
        assertThat(configured.all()).hasSize(2);

        LinkKeys derived = new LinkKeys(Optional.empty(), List.of(), List.of(key(1), key(2)));
        assertThat(derived.source()).isEqualTo(LinkKeys.Source.DERIVED);
        assertThat(derived.current())
                .isEqualTo(LinkKeys.derive(key(1)))
                .isNotEqualTo(key(1))
                .hasSize(32);
        assertThat(derived.all()).hasSize(2);
        assertThat(LinkKeys.derive(key(2))).isNotEqualTo(LinkKeys.derive(key(1)));

        // Rotation: a link signed with the former key still verifies.
        FileLink link = new FileLink(ACME, "org.example.maps", FILE, null, null, EXPIRES);
        String old = link.signature(LinkKeys.derive(key(2)));
        assertThat(link.verifies(old, derived.all())).isTrue();
    }

    @Test
    void withoutAKeyLinksAreDisabled() {
        LinkKeys none = new LinkKeys(Optional.of(" "), List.of(), List.of());
        assertThat(none.enabled()).isFalse();
        assertThatThrownBy(none::current)
                .isInstanceOf(ServiceUnavailableException.class)
                .hasMessageContaining("mosaikit.files.link-key");

        LinkKeys tooShort = new LinkKeys(Optional.of(base64(new byte[16])), List.of(), List.of(key(1)));
        assertThat(tooShort.enabled()).isFalse();
        assertThatThrownBy(tooShort::current).hasMessageContaining("at least 32 bytes");
        LinkKeys notBase64 = new LinkKeys(Optional.of(base64(key(7))), List.of("%%"), List.of());
        assertThatThrownBy(notBase64::current)
                .hasMessageContaining("mosaikit.files.link-previous-keys[0] is not in base64")
                .hasMessageNotContaining(base64(key(7)));
    }

    @Test
    void aPrefixIsTheStartOfAValidName() {
        assertThat(FileService.prefix(null)).isEmpty();
        assertThat(FileService.prefix("")).isEmpty();
        assertThat(FileService.prefix("tiles/")).isEqualTo("tiles/");
        assertThat(FileService.prefix("tiles/3/4")).isEqualTo("tiles/3/4");
        assertThat(FileService.prefix("report-2026")).isEqualTo("report-2026");
        for (String wrong : List.of("/tiles", "tiles//3", "../x", "tiles/./3", "a\\b", "a\nb", "x".repeat(256))) {
            assertThatThrownBy(() -> FileService.prefix(wrong)).as(wrong).isInstanceOf(InvalidInputException.class);
        }
    }
}

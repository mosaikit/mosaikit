// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.marketplace;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import java.net.URI;
import java.nio.file.Path;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** How the marketplace compares an offered version with the installed one, and its cleanup. */
@Tag("MK-022")
class MarketplaceStateTest {

    @Test
    void comparesTheOfferedVersionWithTheInstalledOne() {
        assertThat(Marketplace.state("1.0.0", null)).isEqualTo("available");
        assertThat(Marketplace.state("1.0.0", "1.0.0")).isEqualTo("installed");
        assertThat(Marketplace.state("1.1.0", "1.0.0")).isEqualTo("update");
        assertThat(Marketplace.state("0.9.0", "1.0.0")).isEqualTo("older");
    }

    @Test
    void locatesRelativeCatalogsInTheInstallation() {
        URI installation = Path.of("").toAbsolutePath().toUri();

        assertThat(Marketplace.located(URI.create("catalog/"))).isEqualTo(installation.resolve("catalog/"));
        assertThat(Marketplace.located(URI.create("catalog"))).isEqualTo(installation.resolve("catalog/"));
        assertThat(Marketplace.located(URI.create("file:catalog/"))).isEqualTo(installation.resolve("catalog/"));
        URI usb = Path.of("usb").toAbsolutePath().toUri();
        // An absolute file: URI is already located.
        assertThat(Marketplace.located(usb)).isSameAs(usb);
        URI published = URI.create("https://mosaikit.github.io/catalog/");
        assertThat(Marketplace.located(published)).isSameAs(published);
    }

    @Test
    void comparesVersionsThatDoNotParseAsText() {
        assertThat(Marketplace.state("nightly", "nightly")).isEqualTo("installed");
        assertThat(Marketplace.state("nightly", "1.0.0")).isEqualTo("update");
    }

    @Test
    void ignoresAFileThatCannotBeDeleted(@TempDir Path directory) {
        assertThatCode(() -> Marketplace.deleteFile(directory.resolve("missing")))
                .doesNotThrowAnyException();
    }
}

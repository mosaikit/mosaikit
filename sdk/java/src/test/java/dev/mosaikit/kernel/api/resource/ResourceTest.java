// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.resource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

@Tag("MK-054")
class ResourceTest {

    private static final ResourceRef DASHBOARD = new ResourceRef("dev.example.dashboards", "dashboard", "42");
    private static final UUID ORGANIZATION = UUID.randomUUID();
    private static final UUID OWNER = UUID.randomUUID();

    @Test
    void namesAResourceByExtensionTypeAndIdentifier() {
        assertThat(DASHBOARD).hasToString("dev.example.dashboards/dashboard/42");
        assertThat(new ResourceRef("dev.example.dashboards", "dashboard", "42")).isEqualTo(DASHBOARD);
    }

    @Test
    void refusesReferencesThatAreNotOfADeclaredKind() {
        String longId = "x".repeat(ResourceRef.MAX_ID + 1);

        assertThatThrownBy(() -> new ResourceRef("Dashboards", "dashboard", "1"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ResourceRef("dev.example.dashboards", "Dashboard", "1"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ResourceRef("dev.example.dashboards", "dashboard", " "))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ResourceRef("dev.example.dashboards", "dashboard", longId))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ResourceRef("dev.example.dashboards", "dashboard", null))
                .isInstanceOf(NullPointerException.class);
    }

    @Test
    void keepsWhatTheKernelNeedsToShowAndOpenAResource() {
        ResourceRef folder = new ResourceRef("dev.example.dashboards", "folder", "7");

        Resource resource = new Resource(DASHBOARD, ORGANIZATION, OWNER, "  Traffic  ", "/app/dashboards/42", folder);

        assertThat(resource.title()).isEqualTo("Traffic");
        assertThat(resource.parent()).isEqualTo(folder);
        assertThat(new Resources.Details(" Traffic ", "/app/dashboards/42", folder).title())
                .isEqualTo("Traffic");
        assertThat(Resources.Details.of("Traffic", "/app/dashboards/42").parent())
                .isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"app/dashboards/42", "//example.org/x", "https://example.org/x", "/app/a b", "/app\\x"})
    void refusesLinksThatAreNotPathsOfTheShell(String link) {
        assertThatThrownBy(() -> new Resource(DASHBOARD, ORGANIZATION, OWNER, "Traffic", link, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Resources.Details.of("Traffic", link)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void refusesEmptyOrLongTitlesAndLongLinks() {
        String longTitle = "x".repeat(Resource.MAX_TITLE + 1);
        String longLink = "/" + "x".repeat(Resource.MAX_LINK);

        assertThatThrownBy(() -> Resources.Details.of("  ", "/app/x")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Resources.Details.of(longTitle, "/app/x"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> Resources.Details.of("Traffic", longLink))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void aResourceIsNotItsOwnParent() {
        assertThatThrownBy(() -> new Resource(DASHBOARD, ORGANIZATION, OWNER, "Traffic", "/app/x", DASHBOARD))
                .isInstanceOf(IllegalArgumentException.class);
    }
}

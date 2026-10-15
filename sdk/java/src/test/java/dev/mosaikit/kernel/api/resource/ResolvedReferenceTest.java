// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.resource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.api.resource.ResolvedReference.Availability;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("MK-135")
class ResolvedReferenceTest {

    private static final ResourceRef MAP = new ResourceRef("dev.example.maps", "map", "7");
    private static final Resource ENTRY = new Resource(MAP, UUID.randomUUID(), null, "Rivers", "/app/maps/7", null);

    @Test
    void carriesTheResourceOnlyWhenItIsAvailable() {
        ResolvedReference available = ResolvedReference.available(ENTRY);
        assertThat(available.isAvailable()).isTrue();
        assertThat(available.target()).isEqualTo(MAP);
        assertThat(available.resource()).isEqualTo(ENTRY);

        for (Availability why :
                new Availability[] {Availability.EXTENSION_ABSENT, Availability.DELETED, Availability.FORBIDDEN}) {
            ResolvedReference missing = ResolvedReference.unavailable(MAP, why);
            assertThat(missing.isAvailable()).isFalse();
            assertThat(missing.availability()).isEqualTo(why);
            assertThat(missing.resource()).isNull();
        }
    }

    @Test
    void refusesAnEntryThatDoesNotMatch() {
        assertThatThrownBy(() -> new ResolvedReference(MAP, Availability.AVAILABLE, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ResolvedReference(MAP, Availability.DELETED, ENTRY))
                .isInstanceOf(IllegalArgumentException.class);
        ResourceRef other = new ResourceRef("dev.example.maps", "map", "8");
        assertThatThrownBy(() -> new ResolvedReference(other, Availability.AVAILABLE, ENTRY))
                .isInstanceOf(IllegalArgumentException.class);
    }
}

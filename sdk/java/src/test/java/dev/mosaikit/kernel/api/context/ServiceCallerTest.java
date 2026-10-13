// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.context;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Set;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("MK-124")
class ServiceCallerTest {

    @Test
    void recognizesTheCallsOfServiceIdentities() {
        assertThat(ServiceCaller.isService(Set.of("service"))).isTrue();
        assertThat(ServiceCaller.isService(Set.of("organization-user"))).isFalse();
        assertThat(ServiceCaller.isService(null)).isFalse();
        assertThat(ServiceCaller.name("service:gateway")).contains("gateway");
        assertThat(ServiceCaller.name("service:")).isEmpty();
        assertThat(ServiceCaller.name("ada@example.org")).isEmpty();
        assertThat(ServiceCaller.name(null)).isEmpty();
    }
}

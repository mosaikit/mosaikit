// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("MK-011")
class PluginApiGuardTest {

    @Test
    void findsTheApiNameOfAPluginPath() {
        assertThat(PluginApiGuard.apiName("/api/v1/p/sample-notes/notes")).contains("sample-notes");
        assertThat(PluginApiGuard.apiName("/api/v1/p/sample-notes")).contains("sample-notes");
    }

    @Test
    void findsNoApiNameOutsideThePluginPrefix() {
        assertThat(PluginApiGuard.apiName("/api/v1/p/")).isEmpty();
        assertThat(PluginApiGuard.apiName("/api/v1/plugins")).isEmpty();
        assertThat(PluginApiGuard.apiName(null)).isEmpty();
    }

    @Test
    void runsAfterTheSecurityHandlersOfQuarkus() {
        int orderOfTheSecurityHandlers = -100;
        int order = PluginApiGuard.ORDER;
        assertThat(order).isGreaterThan(orderOfTheSecurityHandlers);
    }
}

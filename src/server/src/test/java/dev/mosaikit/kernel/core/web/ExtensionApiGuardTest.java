// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("MK-011")
class ExtensionApiGuardTest {

    @Test
    void findsTheApiNameOfAExtensionPath() {
        assertThat(ExtensionApiGuard.apiName("/api/v1/ext/fixture-notes/notes")).contains("fixture-notes");
        assertThat(ExtensionApiGuard.apiName("/api/v1/ext/fixture-notes")).contains("fixture-notes");
    }

    @Test
    void findsNoApiNameOutsideTheExtensionPrefix() {
        assertThat(ExtensionApiGuard.apiName("/api/v1/ext/")).isEmpty();
        assertThat(ExtensionApiGuard.apiName("/api/v1/extensions")).isEmpty();
        assertThat(ExtensionApiGuard.apiName(null)).isEmpty();
    }

    @Test
    void runsAfterTheSecurityHandlersOfQuarkus() {
        int orderOfTheSecurityHandlers = -100;
        int order = ExtensionApiGuard.ORDER;
        assertThat(order).isGreaterThan(orderOfTheSecurityHandlers);
    }
}

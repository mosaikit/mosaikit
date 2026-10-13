// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.permission;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Set;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("MK-056")
class PermissionsTest {

    private static final String DASHBOARDS = "dev.example.dashboards";

    /** A person whose profile grants only create-dashboard. */
    private static final Permissions CREATOR = new Permissions() {
        @Override
        public boolean has(String extension, String permission) {
            return granted(extension).contains(permission);
        }

        @Override
        public Set<String> granted(String extension) {
            return extension.equals(DASHBOARDS) ? Set.of("create-dashboard") : Set.of();
        }
    };

    @Test
    void requireLetsThroughWhatIsGrantedAndRefusesTheRestWith403() {
        CREATOR.require(DASHBOARDS, "create-dashboard");

        assertThatThrownBy(() -> CREATOR.require(DASHBOARDS, "delete-dashboard"))
                .isInstanceOfSatisfying(AccessDeniedException.class, denied -> {
                    assertThat(denied.concealed()).isFalse();
                    assertThat(denied).hasMessageContaining("dev.example.dashboards:delete-dashboard");
                });
        assertThatThrownBy(() -> CREATOR.require("dev.example.other", "create-dashboard"))
                .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    void outsideItsExtensionAPermissionIsNamedByItsQualifiedIdentifier() {
        PermissionId id = new PermissionId(DASHBOARDS, "create-dashboard");

        assertThat(id).hasToString("dev.example.dashboards:create-dashboard");
        assertThat(PermissionId.parse("dev.example.dashboards:create-dashboard"))
                .isEqualTo(id);
        assertThatThrownBy(() -> PermissionId.parse("create-dashboard")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> PermissionId.parse("dev.example.dashboards:a:b"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> PermissionId.parse("Dashboards:create-dashboard"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PermissionId(DASHBOARDS, "Create Dashboard"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void aConcealedRefusalIsAnsweredAsNotFound() {
        assertThat(new AccessDeniedException("hidden", true).concealed()).isTrue();
        assertThat(new AccessDeniedException("visible").concealed()).isFalse();
    }
}

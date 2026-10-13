// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.secrets;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.Optional;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** {@link Secrets#resolve} on an implementation without credentials of the installation (MK-127). */
@Tag("MK-127")
class SecretsResolveTest {

    @Test
    void anImplementationWithoutCredentialsOfTheInstallationResolvesAsFind() {
        Secrets organizationOnly = (extension, name) -> "model-provider".equals(name)
                ? Optional.of(SecretValue.ofUtf8("sk-acme".getBytes(StandardCharsets.UTF_8)))
                : Optional.empty();

        try (SecretValue value = organizationOnly
                .resolve("org.example.reports", "model-provider")
                .orElseThrow()) {
            assertThat(value.reveal()).isEqualTo("sk-acme");
        }
        assertThat(organizationOnly.resolve("org.example.reports", "mail-relay"))
                .isEmpty();
    }
}

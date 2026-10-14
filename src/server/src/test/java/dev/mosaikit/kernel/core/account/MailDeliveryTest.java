// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import static org.assertj.core.api.Assertions.assertThat;

import io.smallrye.config.PropertiesConfigSource;
import io.smallrye.config.SmallRyeConfigBuilder;
import java.util.Map;
import org.eclipse.microprofile.config.Config;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** Whether the installation sends mail, from the settings of the mail client (MK-048). */
@Tag("MK-048")
class MailDeliveryTest {

    /** The settings given, over the default host of the mail client. */
    private static Config config(Map<String, String> settings) {
        return new SmallRyeConfigBuilder()
                .withDefaultValue(MailDelivery.HOST, "localhost")
                .withSources(new PropertiesConfigSource(settings, "application.properties", 250))
                .build();
    }

    @Test
    void theDefaultHostIsNoMailServer() {
        assertThat(new MailDelivery(config(Map.of())).configured()).isFalse();
        assertThat(new MailDelivery(config(Map.of(MailDelivery.MOCK, "false"))).configured())
                .isFalse();
    }

    @Test
    void aNamedHostOrTheMockMailerSendsMail() {
        assertThat(new MailDelivery(config(Map.of(MailDelivery.HOST, "smtp.example.org"))).configured())
                .isTrue();
        assertThat(new MailDelivery(config(Map.of(MailDelivery.HOST, "localhost"))).configured())
                .isTrue();
        assertThat(new MailDelivery(config(Map.of(MailDelivery.MOCK, "true"))).configured())
                .isTrue();
    }
}

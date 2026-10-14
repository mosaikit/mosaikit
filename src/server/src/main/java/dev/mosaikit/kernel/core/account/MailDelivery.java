// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.Config;
import org.eclipse.microprofile.config.ConfigProvider;
import org.eclipse.microprofile.config.ConfigValue;

/**
 * Whether the installation sends mail (MK-048): a mail server is set with {@code quarkus.mailer.host}
 * (in a file of settings, an environment variable or a system property), or the mock mailer of the
 * tests is on. The default host of the mail client, {@code localhost}, does not count: an
 * installation that relays through a mail server on the same machine names it,
 * {@code quarkus.mailer.host=localhost}.
 *
 * <p>Without mail, the link that sets the password of an account an administrator created is shown
 * once to the administrator instead of being mailed.
 */
@ApplicationScoped
public class MailDelivery {

    static final String HOST = "quarkus.mailer.host";
    static final String MOCK = "quarkus.mailer.mock";

    private final boolean configured;

    @Inject
    public MailDelivery() {
        this(ConfigProvider.getConfig());
    }

    MailDelivery(Config config) {
        boolean mock = config.getOptionalValue(MOCK, Boolean.class).orElse(false);
        ConfigValue host = config.getConfigValue(HOST);
        // The defaults of the mail client come from sources with a negative ordinal; files of
        // settings, environment variables and system properties have a positive one.
        boolean named = host.getRawValue() != null && !host.getRawValue().isBlank() && host.getSourceOrdinal() > 0;
        this.configured = mock || named;
    }

    /** Whether the kernel sends mail; without it, links are given to the administrator to pass on. */
    public boolean configured() {
        return configured;
    }
}

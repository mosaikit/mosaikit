// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.config.KernelConfig;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import org.jboss.logging.Logger;

/** Creates the platform administrator at the first start of an empty installation. */
@ApplicationScoped
public class FirstAdministrator {

    private static final Logger LOG = Logger.getLogger(FirstAdministrator.class);

    private final AccountService accounts;
    private final KernelConfig config;

    public FirstAdministrator(AccountService accounts, KernelConfig config) {
        this.accounts = accounts;
        this.config = config;
    }

    void onStart(@Observes StartupEvent event) {
        var bootstrap = config.bootstrap();
        bootstrap
                .adminPassword()
                .ifPresentOrElse(
                        password -> accounts.createFirstAdministrator(bootstrap.adminUsername(), password.toCharArray())
                                .ifPresent(admin -> LOG.infof("Created platform administrator '%s'", admin.username())),
                        () -> LOG.debug("No bootstrap administrator password configured"));
    }
}

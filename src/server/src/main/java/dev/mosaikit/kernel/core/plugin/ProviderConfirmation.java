// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import dev.mosaikit.kernel.core.config.KernelConfig;
import io.quarkus.runtime.StartupEvent;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.interceptor.Interceptor;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import org.jboss.logging.Logger;

/**
 * Confirms to the launcher that the kernel started with the plugin JARs of the last rebuild, by
 * removing {@link ProviderState#PENDING_FILE}. It runs after every other start step (plugins
 * read, schemas migrated): if one of them fails, the file stays and the launcher rolls the new
 * JARs back at the next start.
 */
@ApplicationScoped
public class ProviderConfirmation {

    private static final Logger LOG = Logger.getLogger(ProviderConfirmation.class);

    private final Optional<Path> providers;

    public ProviderConfirmation(KernelConfig config) {
        this.providers = config.plugins().providersDirectory();
    }

    void onStart(@Observes @Priority(Interceptor.Priority.PLATFORM_AFTER + 1000) StartupEvent event) {
        providers
                .filter(directory -> Files.exists(directory.resolve(ProviderState.PENDING_FILE)))
                .ifPresent(directory -> {
                    try {
                        ProviderState.clear(directory, ProviderState.PENDING_FILE);
                        LOG.info("Started with the plugin JARs of the last rebuild: confirmed");
                    } catch (UncheckedIOException e) {
                        LOG.warnf("Cannot confirm the plugin JARs of the last rebuild: %s", e.getMessage());
                    }
                });
    }
}

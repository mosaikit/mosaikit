// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.system;

import dev.mosaikit.kernel.api.version.Version;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** Version of the running kernel, taken from the build. */
@ApplicationScoped
public class KernelVersion {

    private final Version version;

    public KernelVersion(@ConfigProperty(name = "quarkus.application.version") String version) {
        this.version = Version.parse(version);
    }

    public Version get() {
        return version;
    }
}

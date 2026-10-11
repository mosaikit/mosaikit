// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.launcher;

import java.nio.file.Path;
import java.util.Objects;

/**
 * The layout of an installation.
 *
 * <pre>
 * &lt;home&gt;/
 * ├── mosaikit, mosaikit.cmd   the launcher scripts
 * ├── README.md
 * ├── config/     application.properties (read by the kernel from the working directory)
 * ├── plugins/    the installed plugins: packages (*.zip) or directories
 * ├── data/       PostgreSQL cluster and generated secrets (portable distribution only)
 * └── bin/
 *     ├── mosaikit.ps1
 *     ├── kernel/ the kernel as Quarkus mutable JAR, with the UI and this launcher; providers/
 *     │           holds the plugin JARs, plugin-packages/ the unpacked plugin packages
 *     ├── java/   Java runtime (portable distribution only)
 *     └── pgsql/  PostgreSQL binaries (portable distribution only)
 * </pre>
 *
 * @param home root directory of the installation
 */
public record Installation(Path home) {

    public Installation {
        home = Objects.requireNonNull(home, "home").toAbsolutePath().normalize();
    }

    public Path plugins() {
        return home.resolve("plugins");
    }

    public Path bin() {
        return home.resolve("bin");
    }

    public Path kernel() {
        return bin().resolve("kernel");
    }

    /** Where plugin packages are unpacked, for the launcher and the kernel alike. */
    public Path packages() {
        return kernel().resolve("plugin-packages");
    }

    public Path providers() {
        return kernel().resolve("providers");
    }

    public Path kernelJar() {
        return kernel().resolve("quarkus-run.jar");
    }

    public Path config() {
        return home.resolve("config");
    }

    public Path pgsql() {
        return bin().resolve("pgsql");
    }

    public Path data() {
        return home.resolve("data");
    }
}

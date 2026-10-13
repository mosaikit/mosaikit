// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.settings;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.time.Clock;
import java.time.Instant;

/** Reads and changes the settings of the platform, with their defaults. */
@ApplicationScoped
@Transactional
public class PlatformSettingsService {

    static final String REGISTRATION = "registration";

    private final PlatformSettings settings;
    private final Clock clock;

    public PlatformSettingsService(PlatformSettings settings, Clock clock) {
        this.settings = settings;
        this.clock = clock;
    }

    /** The current settings. */
    public PlatformSettingsView get() {
        return new PlatformSettingsView(registrationEnabled());
    }

    /** Whether self-registration is on; it is until an administrator turns it off. */
    public boolean registrationEnabled() {
        return settings.findByName(REGISTRATION)
                .map(setting -> Boolean.parseBoolean(setting.getValue()))
                .orElse(true);
    }

    /** Changes the settings. */
    public PlatformSettingsView change(PlatformSettingsView changed, String administrator) {
        write(REGISTRATION, String.valueOf(changed.registration()), administrator);
        return get();
    }

    private void write(String name, String value, String administrator) {
        Instant now = Instant.now(clock);
        settings.findByName(name)
                .ifPresentOrElse(
                        setting -> {
                            setting.change(value, administrator, now);
                            settings.update(setting);
                        },
                        () -> settings.insert(new PlatformSetting(name, value, administrator, now)));
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.settings;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.util.Optional;

/** Jakarta Data repository of the settings of the platform. */
@Repository
public interface PlatformSettings {

    @Find
    Optional<PlatformSetting> findByName(String name);

    @Insert
    void insert(PlatformSetting setting);

    @Update
    void update(PlatformSetting setting);
}

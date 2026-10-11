// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.settings;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** A setting of the platform that administrators change from the interface. */
@Entity
@Table(name = "platform_setting")
public class PlatformSetting {

    @Id
    private String name;

    @Column(nullable = false)
    private String value;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by", nullable = false)
    private String updatedBy;

    /** Required by JPA. */
    protected PlatformSetting() {}

    public PlatformSetting(String name, String value, String updatedBy, Instant updatedAt) {
        this.name = name;
        change(value, updatedBy, updatedAt);
    }

    public final void change(String value, String updatedBy, Instant updatedAt) {
        this.value = value;
        this.updatedBy = updatedBy;
        this.updatedAt = updatedAt;
    }

    public String getValue() {
        return value;
    }
}

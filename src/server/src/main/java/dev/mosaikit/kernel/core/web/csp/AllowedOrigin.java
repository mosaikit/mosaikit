// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web.csp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * An external origin that a platform administrator allowed in the content security policy of the
 * shell (MK-128), in its normal form ({@link ExternalOrigins#normalize}).
 */
@Entity
@Table(name = "csp_origin")
public class AllowedOrigin {

    @Id
    private String origin;

    @Column(name = "added_at", nullable = false)
    private Instant addedAt;

    @Column(name = "added_by", nullable = false)
    private String addedBy;

    /** Required by JPA. */
    protected AllowedOrigin() {}

    AllowedOrigin(String origin, String addedBy, Instant addedAt) {
        this.origin = origin;
        this.addedBy = addedBy;
        this.addedAt = addedAt;
    }

    public String getOrigin() {
        return origin;
    }

    public Instant getAddedAt() {
        return addedAt;
    }

    public String getAddedBy() {
        return addedBy;
    }
}

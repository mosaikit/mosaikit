// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.sample.estimates;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** How many hours an activity should take: the field that the extension adds to activities. */
@Entity
@Table(name = "estimate", schema = "p_sample_estimates")
public class Estimate {

    @Id
    @Column(name = "activity_id")
    private UUID activityId;

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(nullable = false, precision = 8, scale = 2)
    private BigDecimal hours;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** Required by JPA. */
    protected Estimate() {}

    public Estimate(UUID activityId, UUID organizationId, BigDecimal hours, Instant updatedAt) {
        this.activityId = Objects.requireNonNull(activityId, "activityId");
        this.organizationId = Objects.requireNonNull(organizationId, "organizationId");
        this.hours = Objects.requireNonNull(hours, "hours");
        this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt");
    }

    public UUID getActivityId() {
        return activityId;
    }

    public BigDecimal getHours() {
        return hours;
    }

    /** Changes the estimate. */
    public void change(BigDecimal newHours, Instant now) {
        this.hours = Objects.requireNonNull(newHours, "newHours");
        this.updatedAt = Objects.requireNonNull(now, "now");
    }
}

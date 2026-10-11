// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.sample.estimates;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;

/**
 * An activity as the Activities plugin publishes it in its data contract, the view {@code
 * activity_v1}: read only (the plugin never writes it; a view refuses it anyway), and under the
 * row-level security of the organization of the request.
 */
@Entity
@Table(name = "activity_v1", schema = "p_sample_activities")
public class ActivitySummary {

    @Id
    private UUID id;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private boolean done;

    /** Required by JPA. */
    protected ActivitySummary() {}

    public UUID getId() {
        return id;
    }

    public String getTitle() {
        return title;
    }

    public boolean isDone() {
        return done;
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

/**
 * An action would take an organization beyond one of its quotas (MK-076). Its problem detail names
 * the limit, in its text and in the member {@code quota}.
 */
public final class QuotaExceededException extends DomainException {

    private static final long serialVersionUID = 1L;

    /**
     * The limit that refused the action.
     *
     * @param measure the identifier of the measure, such as {@code storage}
     * @param unit its unit, such as {@code bytes}
     * @param period the month of a counter, such as {@code 2026-10}, or {@code null} for a gauge
     * @param limit the limit of the organization
     * @param used what the organization used of it, or keeps
     * @param requested what the action needed
     */
    public record Quota(String measure, String unit, String period, long limit, long used, long requested) {}

    private final transient Quota quota;

    public QuotaExceededException(String message, Quota quota) {
        super(message);
        this.quota = quota;
    }

    public Quota quota() {
        return quota;
    }

    @Override
    public int status() {
        return 403;
    }

    @Override
    public String title() {
        return "Quota exceeded";
    }
}

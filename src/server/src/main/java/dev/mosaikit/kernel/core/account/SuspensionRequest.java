// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

/**
 * The suspension of an account by a platform administrator (MK-125).
 *
 * @param reason why, shown to the other administrators and kept in the audit log; at most {@value
 *     #MAX_REASON} characters
 */
public record SuspensionRequest(String reason) {

    /** The longest reason accepted. */
    public static final int MAX_REASON = 500;
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import java.time.Instant;

/**
 * The link that sets the password of an account an administrator created (MK-048).
 *
 * @param member the person the link is for
 * @param mailed whether the link was mailed to the person; then {@code link} is empty
 * @param link the link, when the installation sends no mail: shown this once, for the administrator
 *     to pass on; the kernel keeps only its digest
 * @param expiresAt when the link stops working
 */
public record PasswordLinkView(MemberView member, boolean mailed, String link, Instant expiresAt) {

    /** Hides the link from logs. */
    @Override
    public String toString() {
        return "PasswordLinkView[member=" + member.username() + ", mailed=" + mailed + "]";
    }
}

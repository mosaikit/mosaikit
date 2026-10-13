// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import java.util.List;

/**
 * Whether the sign-in page offers to create an account, and in which organizations.
 *
 * @param enabled whether registration is on and some organization allows it
 * @param organizations the organizations that allow self-registration with a password
 */
public record RegistrationOptions(boolean enabled, List<Choice> organizations) {

    /** An organization to register in. */
    public record Choice(String slug, String name) {}
}

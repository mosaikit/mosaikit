// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import com.fasterxml.jackson.annotation.JsonProperty;

/** How the members of an organization sign in to act on its data (MK-017). */
public enum SignInPolicy {
    /** With their Mosaikit password. */
    @JsonProperty("password")
    PASSWORD,
    /** Through the Keycloak realm of the organization only: passwords are refused for its data. */
    @JsonProperty("realm")
    REALM,
    /** Either way. */
    @JsonProperty("password-or-realm")
    PASSWORD_OR_REALM;

    /** Whether a person who signed in with a password may act on the data of the organization. */
    public boolean allowsPassword() {
        return this != REALM;
    }

    /** Whether a person may sign in through the realm of the organization. */
    public boolean allowsRealm() {
        return this != PASSWORD;
    }
}

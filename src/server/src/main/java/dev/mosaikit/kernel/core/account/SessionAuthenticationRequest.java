// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import io.quarkus.security.identity.request.BaseAuthenticationRequest;

/** The value of the session cookie of the shell ({@value SessionResource#COOKIE}) of a request. */
public class SessionAuthenticationRequest extends BaseAuthenticationRequest {

    private final String token;

    public SessionAuthenticationRequest(String token) {
        this.token = token;
    }

    public String getToken() {
        return token;
    }

    @Override
    public String toString() {
        return "SessionAuthenticationRequest";
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import io.quarkus.security.identity.request.BaseAuthenticationRequest;

/** The token of the {@value RememberMe#COOKIE} cookie of a request. */
public class RememberMeAuthenticationRequest extends BaseAuthenticationRequest {

    private final String token;

    public RememberMeAuthenticationRequest(String token) {
        this.token = token;
    }

    public String getToken() {
        return token;
    }
}

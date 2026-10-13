// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import io.quarkus.security.identity.request.BaseAuthenticationRequest;

/** The personal access key (MK-060) of a request. */
public class AccessKeyAuthenticationRequest extends BaseAuthenticationRequest {

    private final String key;

    public AccessKeyAuthenticationRequest(String key) {
        this.key = key;
    }

    public String getKey() {
        return key;
    }

    @Override
    public String toString() {
        return "AccessKeyAuthenticationRequest";
    }
}

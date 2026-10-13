// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.service;

import io.quarkus.security.identity.request.BaseAuthenticationRequest;

/** The key of a service identity (MK-124) of a request. */
public class ServiceKeyAuthenticationRequest extends BaseAuthenticationRequest {

    private final String key;

    public ServiceKeyAuthenticationRequest(String key) {
        this.key = key;
    }

    public String getKey() {
        return key;
    }

    @Override
    public String toString() {
        return "ServiceKeyAuthenticationRequest";
    }
}

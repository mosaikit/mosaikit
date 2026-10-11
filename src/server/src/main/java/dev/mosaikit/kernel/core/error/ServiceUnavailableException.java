// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

/** A service the kernel depends on, such as Keycloak, cannot be reached or refused the request. */
public final class ServiceUnavailableException extends DomainException {

    private static final long serialVersionUID = 1L;

    public ServiceUnavailableException(String message) {
        super(message);
    }

    @Override
    public int status() {
        return 503;
    }

    @Override
    public String title() {
        return "Service Unavailable";
    }
}

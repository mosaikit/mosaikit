// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

/** The requested resource does not exist. */
public final class ResourceNotFoundException extends DomainException {

    private static final long serialVersionUID = 1L;

    public ResourceNotFoundException(String message) {
        super(message);
    }

    @Override
    public int status() {
        return 404;
    }

    @Override
    public String title() {
        return "Resource not found";
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

/** The request conflicts with the current state of a resource. */
public final class ConflictException extends DomainException {

    private static final long serialVersionUID = 1L;

    public ConflictException(String message) {
        super(message);
    }

    @Override
    public int status() {
        return 409;
    }

    @Override
    public String title() {
        return "Conflict";
    }
}

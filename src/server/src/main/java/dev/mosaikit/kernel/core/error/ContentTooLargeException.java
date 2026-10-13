// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

/** The content of the request is larger than the kernel accepts, such as a file over its limit. */
public final class ContentTooLargeException extends DomainException {

    private static final long serialVersionUID = 1L;

    public ContentTooLargeException(String message) {
        super(message);
    }

    @Override
    public int status() {
        return 413;
    }

    @Override
    public String title() {
        return "Content too large";
    }
}

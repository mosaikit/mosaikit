// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

/** Runs the calls of tools against the backend APIs of extensions. */
public interface ActionInvoker {

    /**
     * Sends a call on behalf of a person.
     *
     * @throws java.io.UncheckedIOException when the extension cannot be reached
     */
    ExtensionResponse invoke(ExtensionCall call, Caller caller);
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

/** Runs the calls of tools against the backend APIs of plugins. */
public interface ActionInvoker {

    /**
     * Sends a call on behalf of a person.
     *
     * @throws java.io.UncheckedIOException when the plugin cannot be reached
     */
    PluginResponse invoke(PluginCall call, Caller caller);
}

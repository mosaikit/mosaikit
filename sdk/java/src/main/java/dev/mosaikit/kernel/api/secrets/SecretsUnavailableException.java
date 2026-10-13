// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.secrets;

/**
 * The credentials cannot be read (MK-062): the installation has no master key, or a credential does
 * not decrypt with its keys. The kernel answers a request that ends with it with {@code 503}. The
 * message never contains a value nor a key.
 */
public final class SecretsUnavailableException extends IllegalStateException {

    private static final long serialVersionUID = 1L;

    public SecretsUnavailableException(String message) {
        super(message);
    }
}

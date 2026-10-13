// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.secrets;

import java.util.NoSuchElementException;
import java.util.Optional;

/**
 * The credentials of external services (MK-062): keys, tokens and passwords that the administrators
 * of an organization keep in the kernel for its extensions, such as the key of a model provider or
 * the password of a database. The kernel keeps them encrypted; an extension backend reads one by
 * name, on the server, at the moment of the call, and never sends it to the browser nor writes it
 * into a document, a log or an error message.
 *
 * <p>The kernel provides this bean to extensions. Every method acts on the organization of the
 * request ({@link dev.mosaikit.kernel.api.context.CurrentOrganization}): an extension reads the
 * credentials of that organization only, whoever the person of the request is, and the
 * administrators of the organization decide what is there.
 *
 * <p><strong>The caller names its extension.</strong> All Java extensions run in the same process, so
 * the calling extension names itself in every call, as {@code Notifications.send} does. The kernel
 * checks that it is an active extension; any other name is refused with {@link
 * IllegalArgumentException}. A credential that the administrators meant for one extension is read by
 * that extension only; one meant for no extension is read by every extension of the organization.
 *
 * <p><strong>The value.</strong> A {@link SecretValue} never shows the value in {@code toString}; take
 * it with {@link SecretValue#chars()} or {@link SecretValue#bytes()} where the call to the external
 * service needs it, and close the value when done:
 *
 * <pre>{@code
 * try (SecretValue key = secrets.require("org.example.reports", "model-provider")) {
 *     request.header("Authorization", "Bearer " + key.reveal());
 * }
 * }</pre>
 *
 * <p>Every read is in the audit log of the organization, with the name of the credential and the
 * extension, through the channel {@code EXTENSION}; never with the value.
 *
 * <p><strong>API preview</strong>: the kernel implements it with MK-062.
 */
public interface Secrets {

    /**
     * The value of a credential of the organization of the request, if the extension may read it.
     *
     * @param extension identifier of the calling extension
     * @param name the name the administrators gave the credential, such as {@code model-provider}
     * @return empty when the organization has no credential with this name, or it is meant for
     *     another extension
     * @throws IllegalArgumentException when {@code extension} is not an active extension
     * @throws SecretsUnavailableException when the installation has no master key, or the
     *     credential cannot be decrypted with its keys
     * @throws dev.mosaikit.kernel.api.context.NoOrganizationException when the request has no
     *     organization
     */
    Optional<SecretValue> find(String extension, String name);

    /**
     * The value of a credential of the organization of the request.
     *
     * @throws NoSuchElementException when the organization has no credential with this name that the
     *     extension may read; the message names the credential, nothing else
     * @see #find(String, String)
     */
    default SecretValue require(String extension, String name) {
        return find(extension, name)
                .orElseThrow(() -> new NoSuchElementException(
                        "No credential named " + name + " for " + extension + " in the organization."));
    }
}

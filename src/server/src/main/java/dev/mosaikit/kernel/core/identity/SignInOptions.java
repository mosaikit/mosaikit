// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

/**
 * How a person signs in, returned before sign-in.
 *
 * @param organization slug of the organization found from the sub-domain or the email domain, or
 *     {@code null}
 * @param federation realm to sign in with, or {@code null} to sign in with a local password
 */
public record SignInOptions(String organization, Federation federation) {

    /**
     * The realm of an organization. The UI discovers its endpoints from {@code
     * <issuer>/.well-known/openid-configuration} and signs in with the authorization code flow and
     * PKCE.
     *
     * @param issuer issuer URL of the realm
     * @param clientId client of the kernel UI in the realm
     */
    public record Federation(String issuer, String clientId) {}
}

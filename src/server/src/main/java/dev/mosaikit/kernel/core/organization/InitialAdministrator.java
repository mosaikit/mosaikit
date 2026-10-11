// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

/**
 * The first manager of a new federated organization, returned once when the realm is created. The
 * password must be changed at the first sign-in; it is not stored by the kernel.
 *
 * @param username username in the realm, the email address
 * @param temporaryPassword password for the first sign-in
 */
public record InitialAdministrator(String username, String temporaryPassword) {}

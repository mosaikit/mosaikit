// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * Signed extension packages (MK-013): signing a package with an Ed25519 key, and checking it against
 * the keys an installation trusts. The kernel, the launcher and the signing tool for extension
 * authors ({@link dev.mosaikit.kernel.api.signature.PackageSigningTool}) all use this package, so
 * they always agree on what a valid signature is.
 */
package dev.mosaikit.kernel.api.signature;

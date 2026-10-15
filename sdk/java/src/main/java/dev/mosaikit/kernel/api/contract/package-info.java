// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * Versioned contracts between extensions on the server (MK-134). An extension publishes a contract
 * as Java interfaces in a small API artifact of its own, each interface marked with {@link
 * dev.mosaikit.kernel.api.contract.Contract} and extending {@link
 * dev.mosaikit.kernel.api.contract.ContractImplementation}; other extensions bring the artifact as a
 * library and implement the interface in a CDI bean; the owner of the contract finds the
 * implementations of the extensions active in the organization of the request with {@link
 * dev.mosaikit.kernel.api.contract.Contracts}.
 */
package dev.mosaikit.kernel.api.contract;

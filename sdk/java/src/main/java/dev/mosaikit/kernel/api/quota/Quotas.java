// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.quota;

import dev.mosaikit.kernel.api.resource.ResourceRef;

/**
 * The quotas of the organization of the request (MK-076): an extension asks whether an action fits
 * before doing it, counts what it used, and reports the space it keeps for its resources, which
 * counts to the storage of the organization with the files of the kernel.
 *
 * <p>The kernel provides this bean to extensions. Every method acts on the organization of the
 * request ({@link dev.mosaikit.kernel.api.context.CurrentOrganization}) and joins the transaction of
 * the caller; a refusal changes nothing and leaves that transaction as it was.
 *
 * <p><strong>The caller names its extension.</strong> As with {@code Resources}, the calling
 * extension names itself in every call. A measure is one that its manifest declares in
 * {@code measures}, by its {@code id}; {@link #check} also takes {@code storage}, the measure of the
 * kernel. Any other is refused with {@link IllegalArgumentException}.
 *
 * <p><strong>Limits.</strong> A limit is the one that a platform administrator set for the
 * organization, else the default of the installation; without either there is none, and every
 * amount fits. A counter starts from zero every calendar month (UTC).
 *
 * <p><strong>At the same time.</strong> {@link #consume}, {@link #set} and {@link #reportSpace}
 * check and count in one step, under a lock of the quota until the transaction ends: two actions of
 * the same organization cannot both pass a limit that only one fits. {@link #check} only reads, to
 * refuse early or to show what is left; the amount still has to be counted.
 */
public interface Quotas {

    /**
     * Whether an amount fits what is left of a measure, without counting it.
     *
     * @param measure the {@code id} of a measure of the extension, or {@code storage}
     * @param amount what the action would use, or keep more for a gauge; 0 or more
     */
    Quota check(String extension, String measure, long amount);

    /**
     * Counts an amount of a counter of the extension for this month, for the person of the request
     * or for none.
     *
     * @return the quota before the amount
     * @throws QuotaExceededException when it does not fit; nothing is counted
     */
    Quota consume(String extension, String measure, long amount);

    /**
     * Sets what the organization keeps now of a gauge of the extension. More than before must fit;
     * less always passes.
     *
     * @return the quota before the change, {@link Quota#requested()} the increase
     * @throws QuotaExceededException when the increase does not fit; nothing changes
     */
    Quota set(String extension, String measure, long amount);

    /**
     * Sets the space, in bytes, that the extension keeps for one of its registered resources, outside
     * the files of the kernel: tables, tiles, indexes. It counts to the storage of the organization
     * and to the owner of the resource, and goes when the resource is removed from the registry. More
     * space than before must fit the storage quota; less always passes.
     *
     * @param resource a resource of the extension, registered (MK-054)
     * @throws QuotaExceededException when the space added does not fit; nothing changes
     */
    void reportSpace(ResourceRef resource, long bytes);
}

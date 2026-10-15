// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.resource.OwnershipTransfers;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * The Java code of the drive extension of the tests following the transfer of the resources of a
 * member who leaves (MK-071): it records each transfer, and refuses the transfers to an account named
 * by {@link #refuseTo}, as an extension whose tables cannot take the change would.
 */
@ApplicationScoped
public class OwnershipRecorder implements OwnershipTransfers {

    private final List<Transfer> received = new CopyOnWriteArrayList<>();
    private volatile UUID refused;

    @Override
    public String extension() {
        return InheritedLevelsTest.EXTENSION;
    }

    @Override
    public void transferred(Transfer transfer) {
        if (transfer.to().equals(refused)) {
            throw new IllegalStateException("The drive cannot take the change of owner.");
        }
        received.add(transfer);
    }

    /** The transfers received in an organization. */
    public List<Transfer> in(UUID organization) {
        return received.stream()
                .filter(transfer -> transfer.organization().equals(organization))
                .toList();
    }

    /** Refuses the transfers to this account. */
    public void refuseTo(UUID account) {
        this.refused = account;
    }
}

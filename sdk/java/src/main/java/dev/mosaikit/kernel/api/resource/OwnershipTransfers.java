// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.resource;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * The extension point through which an extension follows the transfer of the resources of a person
 * who leaves an organization (MK-071). When an administrator removes a member, they choose who takes
 * over what the member owns; the kernel gives the registered resources to that person, with their
 * grants as they were, and then calls the implementation of each extension that owns some of them,
 * so that it changes the owner it keeps in its own tables too.
 *
 * <p>Implement it in an {@code @ApplicationScoped} bean of the Java code of the extension:
 *
 * <pre>{@code
 * @ApplicationScoped
 * public class DashboardOwners implements OwnershipTransfers {
 *     @Inject DashboardRepository dashboards;
 *
 *     public String extension() { return "org.example.dashboards"; }
 *
 *     public void transferred(Transfer transfer) {
 *         dashboards.changeOwner(transfer.organization(), transfer.ids("dashboard"), transfer.to());
 *     }
 * }
 * }</pre>
 *
 * <p>The kernel calls {@link #transferred} in the transaction of the removal, once for the resources
 * of the extension, only when the extension is active: when it throws, nothing is transferred and the
 * member is not removed. Filter by {@link Transfer#organization()}: the call may come from a platform
 * administrator who acts on no organization. This interface is version 1 of the extension point: a
 * change that breaks it will be a new interface next to this one, as for the contracts between
 * extensions (MK-134).
 */
public interface OwnershipTransfers {

    /** The identifier of the extension of this implementation, which must be active. */
    String extension();

    /**
     * Takes over in the extension the ownership that the registry just transferred.
     *
     * @throws RuntimeException to refuse the transfer, which then rolls back with the removal
     */
    void transferred(Transfer transfer);

    /**
     * Resources of an extension given to a new owner.
     *
     * @param organization the organization where the person left
     * @param from the account of the person who left
     * @param to the account of the person who owns the resources now
     * @param resources the resources of the extension that changed owner, in the registry already
     */
    record Transfer(UUID organization, UUID from, UUID to, List<ResourceRef> resources) {

        public Transfer {
            Objects.requireNonNull(organization, "organization");
            Objects.requireNonNull(from, "from");
            Objects.requireNonNull(to, "to");
            resources = List.copyOf(resources);
        }

        /** The identifiers of the resources of one type. */
        public List<String> ids(String type) {
            return resources.stream()
                    .filter(ref -> ref.type().equals(type))
                    .map(ResourceRef::id)
                    .toList();
        }
    }
}

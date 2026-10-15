<!-- SPDX-FileCopyrightText: 2026 Massimo Antonini -->
<!-- SPDX-License-Identifier: MPL-2.0 -->

# When a member leaves

When a person leaves an organization, what they own must neither be orphaned nor disappear with
them (MK-071). Before the removal the administrator sees the resources the member owns in the
registry ([Resources, sharing and permissions](resources-and-sharing.md#resources-sharing-and-permissions)),
per extension, and chooses another member who takes them over. The kernel then gives those
resources to the new owner in the registry, with their grants and links untouched, and tells each
extension that owns some of them through the extension point `OwnershipTransfers`.

An extension that keeps only the registry as the owner of its resources has nothing to do: `Sharing`
and `Resources` answer with the new owner at once. An extension that also keeps an owner in its own
tables, or caches it, implements the extension point.

## The extension point

Implement `OwnershipTransfers` (`kernel-api`, `dev.mosaikit.kernel.api.resource`) in an
`@ApplicationScoped` bean of the Java code of the extension:

```java
@ApplicationScoped
public class DashboardOwners implements OwnershipTransfers {
    @Inject DashboardRepository dashboards;

    @Override
    public String extension() {
        return "org.example.dashboards";
    }

    @Override
    public void transferred(Transfer transfer) {
        dashboards.changeOwner(transfer.organization(), transfer.ids("dashboard"), transfer.to());
    }
}
```

- **What it receives**: `Transfer` names the organization, the account who left (`from`), the
  account who owns the resources now (`to`) and the references of the resources of the extension
  that changed owner; `ids(type)` gives the identifiers of one type. Only the resources of the
  extension are in it, and only when it owns some.
- **When**: in the transaction of the removal, after the registry changed, and only while the
  extension is active. Throw to refuse: nothing is transferred, and the member is not removed.
- **Where**: filter by `transfer.organization()`. The call may come from a platform administrator,
  who acts on no organization, so that `CurrentOrganization` is empty and row-level security does
  not limit the rows.
- **Versions**: this is version 1 of the extension point; a change that breaks it will be a new
  interface next to this one, both called until the old one is retired, as for the
  [contracts between extensions](contracts.md).

The grants of the resources do not change: whoever had access keeps it, and the new owner holds
every level as the owner. The resources in the trash are transferred too, and the new owner finds
them in **Trash**. The removal and the transfer are audited by the kernel
(`organization.member.removed`, `organization.member.resources.transferred`).

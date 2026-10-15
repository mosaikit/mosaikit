# The trash

People delete by mistake. An extension whose resources are registered ([Resources, sharing and
permissions](resources-and-sharing.md#resources-sharing-and-permissions)) moves a resource to the
trash instead of deleting it (MK-095); its owner, or an administrator of the organization, restores it
from the page **Trash** of the shell, with its shares, for the retention of the installation
(`mosaikit.trash.retention`, 30 days, one day at least). Then the kernel deletes it for good and tells
the extension to delete its data.

## Moving a resource to the trash

When a person deletes a resource, check as before that they may, then inject `Trash`
(`dev.mosaikit.kernel.api.resource`) and call `trash` naming your extension, in the same transaction
as your own change. Keep the data: only hide what `trash` returns.

```java
@Inject Trash trash;

// The person deleted the folder 42: the folder and everything inside it go to the trash.
List<ResourceRef> moved = trash.trash(new ResourceRef("org.example.ext.files", "folder", "42"));
folders.hide(moved); // keep the rows, leave them out of the lists
```

- **What goes with it.** The resources inside it, following the `parent` of the registry whatever
  their type (also of other extensions), go to the trash with it and come back with it. One that was
  already in the trash stays there on its own, and comes back only when restored itself.
- **While in the trash** a resource keeps its entry, its grants and its links, but gives no level to
  anyone: `Sharing` answers that nobody holds one, `mk_kernel.allows()` is false, its links answer not
  found, a reference to it resolves as `deleted` ([References](references.md)). A list filtered with
  `allows()` or `Sharing.visible` leaves it out by itself. Nothing can be registered inside it.
- `Resources.find` and `list` still return it, for your bookkeeping; `trash.contains(ref)` says
  whether it is in the trash, and `trash.trashed(extension, type)` gives the ids of a type in the
  trash, to leave out of a list read from your own tables.
- `trash.restore(ref)` brings it back, as the page does, to offer **Undo** right after a deletion.
  It refuses a resource that went to the trash with the one that contains it, or whose container is
  in the trash: restore that one.
- Calling `Resources.remove` on a resource in the trash removes it at once, as before; what went with
  it stays in the trash on its own.

## Restoring and deleting for good

The kernel tells the extension with events of the platform ([Events on the server](events.md)), once
for each resource, also for those that went with another one. They come for the resources of every
extension: keep those whose `extension` is yours.

| Event | When | What the extension does |
|---|---|---|
| `resource.trashed` | a resource went to the trash; payload with `purgeableFrom` | nothing more if it hid what `trash` returned; an extension with resources inside the folder of another hides them |
| `resource.restored` | its owner or an administrator restored it, with its grants | show it again |
| `resource.purged` | its retention passed, or its owner or an administrator deleted it for good; the kernel already removed its entry and grants | delete its data, its files and what it keeps elsewhere |

```java
@ApplicationScoped
public class TrashOfFiles implements PlatformEventSubscriber {

    @Override public String extension() { return "org.example.ext.files"; }

    @Override public Set<String> types() {
        return Set.of(PlatformEvents.RESOURCE_RESTORED, PlatformEvents.RESOURCE_PURGED);
    }

    @Override public void handle(PlatformEvent event) {
        if (!extension().equals(event.text("extension"))) {
            return;
        }
        switch (event.type()) {
            case PlatformEvents.RESOURCE_RESTORED -> folders.show(event.text("type"), event.text("id"));
            case PlatformEvents.RESOURCE_PURGED -> folders.deleteForGood(event.text("type"), event.text("id"));
            default -> { }
        }
    }
}
```

The kernel never deletes a resource for good before its retention, read when it was trashed and at
least one day, also checked by the database: a missing or wrong setting never empties a trash. The
audit log records `resource.trashed`, `resource.restored` and `resource.purged`.

A frontend without a backend has no `Trash` bean: it deletes as before.

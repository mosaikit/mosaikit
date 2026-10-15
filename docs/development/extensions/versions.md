# Versions of resources

People edit shared resources and need to see earlier versions and go back to one (MK-096). The
kernel keeps the version history of the resources your extension registers ([Resources, sharing and
permissions](resources-and-sharing.md#resources-sharing-and-permissions)): call it every time you save
a resource, and it keeps a version with its author and time, lets the people who read the resource
open its versions, and the people with edit rights restore one.

A version holds either a **snapshot** that the kernel keeps, such as the JSON of a dashboard, of at most
1 MiB (`Versions.MAX_SNAPSHOT`), or a **file** you stored with the [file service](files.md), for
content larger than that. The data of the resource stay in your extension: a version is a copy, and
you decide what it holds.

From Java, inject `Versions` (`dev.mosaikit.kernel.api.resource`); the reference names your extension
and a type it declares in `resources`, as with `Resources`:

```java
@Inject Sharing sharing;
@Inject Versions versions;

@PUT @Path("/dashboards/{id}") @Transactional
public void save(@PathParam("id") String id, Dashboard dashboard) {
    ResourceRef ref = new ResourceRef("org.example.ext.dashboards", "dashboard", id);
    sharing.require(ref, "edit");
    store.save(id, dashboard);
    versions.save(ref, Versions.Content.json(json.write(dashboard)));
}

@POST @Path("/dashboards/{id}/versions/{version}/restore") @Transactional
public Dashboard restore(@PathParam("id") String id, @PathParam("version") UUID version) {
    ResourceRef ref = new ResourceRef("org.example.ext.dashboards", "dashboard", id);
    Versions.Saved restored = versions.restore(ref, version);   // checks edit rights, audits
    Dashboard dashboard = json.read(versions.open(ref, restored.version().id()).text());
    store.save(id, dashboard);                                  // the restore becomes the current data
    return dashboard;
}
```

| Method | Who | What |
|---|---|---|
| `save(ref, content)` | not checked: call it after your own check | a new version, the newest, authored by the person of the request (none for a job or an import) |
| `list(ref)` | a level on the resource, the lowest of its type at least | the versions, newest first, without their content: number, author, time, media type, size, file |
| `open(ref, version)` | the same | the content of a version: `snapshot()` (or `text()`), or `file()` to read with `FileStorage` |
| `restore(ref, version)` | edit rights: the lowest level of the type that `edits`, or the highest when none does | a new version with the content of the restored one and `restoredFrom` set; written in the audit log as `resource.version.restored` |

The rules:

- **Inherited levels count** (MK-136): a person with a level that edits on a folder above restores the
  versions of a file of a type that declares `inherits: parent`. The administrators of the organization
  hold every level. A request without the level gets `AccessDeniedException`, concealed (`404`) when it
  holds no level at all.
- **Restoring keeps the history**: the restored content becomes the newest version, and you make it
  your current data in the same transaction; the kernel does not hold the data of the resource.
- **How many versions are kept** follows `mosaikit.versions.max-per-resource` of the installation (50
  unless set, see [configuration](../../guide/configuration.md)): a save beyond it removes the oldest
  versions, never the newest; a value below 1 is a mistake of configuration and removes nothing.
- **Files stay yours.** A version of a file holds its identifier; the kernel never deletes the file.
  The versions a save removed come back in `Saved.pruned()`: delete their files when nothing else of
  yours uses them. Deleting a file removes the versions that hold it.
- **Versions go with their resource**: removing the resource from the registry removes its versions.
- A documented exception is thrown before anything is written and leaves your transaction usable:
  `IllegalArgumentException` (a type you do not declare, a file that is not yours),
  `NoSuchElementException` (a resource not registered, a version it does not have).

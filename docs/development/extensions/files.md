# Files

Keep files (images, documents, rasters, exports) through the file service of the kernel (MK-041,
[ADR-0029](../../adr/0029-files-on-s3-and-connectors.md)), never in your own tables nor on the disk of
the server. The kernel writes them to the store of the installation, a directory or an
S3-compatible bucket whose credentials only it holds, under `<organization>/<extension>/<id>`, and
keeps their name, type, size, SHA-256 and owner. It applies the rights of the person: a file is of
the whole organization or of one of its teams (MK-032), a person reads a file of a team only when
they are in it, a guest only the files of their teams, and a file the person may not read is not
found, even with its identifier. Storing and deleting are in the audit log.

A file attached to a registered resource (`attachedTo`, MK-054) follows the sharing of that resource
instead (MK-055): a person reads it, finds it in lists and links to it when they hold any level on the
resource, and attaches, replaces or deletes files of it with a level that `edits`; the person who
stored a file keeps it. The owner of the resource and the administrators of the organization hold
every level (not on the kernel's types private to their subjects, ADR-0037). For a type that inherits
(MK-136), a level on a folder above counts too, and removing it stops at their next use the signed
links that people made through it. So declare a level that
edits on a type whose files others should change. Code that runs without a person keeps the rules of
the organization and its teams; a signed link carries its own grant.

From Java, inject `FileStorage` (`dev.mosaikit.kernel.api.files`) and name your extension in every
call, as with `Resources`; content is streamed both ways:

```java
@Inject FileStorage files;

StoredFile photo = files.store(EXTENSION,
        FileStorage.NewFile.of("plans/garden.png", "image/png")
                .forTeam(team)                                   // optional: one team of the person
                .attachedTo(new ResourceRef(EXTENSION, "album", "summer")),  // optional (MK-054)
        upload);                                                 // an InputStream, read to its end

try (FileContent content = files.read(EXTENSION, photo.id())) {
    content.stream().transferTo(output);
}
List<StoredFile> mine = files.list(EXTENSION, null, 0, 100);    // or of one team
files.delete(EXTENSION, photo.id());                            // owner, team owner, administrators;
                                                                 // of a resource: a level that edits
```

The calls join the transaction of the caller: a file whose transaction rolls back leaves the store
too. A transaction that can no longer commit, because an earlier step marked it for rollback or it
timed out, stores nothing: `store` throws `IllegalStateException` before reading the content, and
`delete` leaves the file, as the rollback will. `NoSuchElementException` means not found or not readable, `IllegalArgumentException` a name,
type or size the kernel refuses (at most `mosaikit.files.max-size`), `SecurityException` a delete
the person may not make.

From a frontend, use the REST API with the session of the page
([API](../api.md)): `POST /api/v1/files/<extension>?name=<name>` with the content as the body and its
type in `Content-Type` (`&team=<id>` for a team), `GET /api/v1/files/<extension>` to list,
`GET /api/v1/files/<extension>/<id>` for the metadata and `.../<id>/content` for the content, which
answers `Range`, `If-None-Match` and `If-Modified-Since` (the `ETag` is the checksum), so that an
image or a tile is fetched in parts and revalidated cheaply:

```js
const response = await fetch(`/api/v1/files/${EXTENSION}?name=${encodeURIComponent(file.name)}`, {
  method: 'POST',
  headers: { 'Content-Type': file.type || 'application/octet-stream' },
  body: file,
});
const stored = await response.json(); // { id, name, contentType, size, checksum, ... }
```

## Signed links to files

A viewer, an external tool, an embedded page or a link in a notification downloads files without the
session of the person through a signed, expiring link (MK-093). Ask for a link to a file the person
reads, or to every file whose name starts with a prefix, such as `tiles/`, of the organization or of
one team of the person; whoever holds it downloads those files, with ranges and cache validators,
until it expires, at most `mosaikit.files.link-max-validity` (7 days unless set) after it is made.
An expired or altered link answers 404, as a file that does not exist. Making a link is audited.

```java
SignedLink report = files.link(EXTENSION, photo.id(), Duration.ofHours(2)); // null: the longest
notify(person, report.path());                  // relative to the root of the kernel

SignedLink tiles = files.linkToPrefix(EXTENSION, "tiles/", team, Duration.ofDays(1)); // team or null
String tile = tiles.file("tiles/3/4/2.png");    // base + encoded name + "?" + query
```

From a frontend, `POST /api/v1/files/<extension>/links` with `{"file": "<id>"}`, or
`{"prefix": "tiles/", "team": "<id>"}`, and an optional `expires`, answers `url` (absolute), `base`
and `query`; a file under a prefix is at `` `${base}${name}?${query}` ``, so a tile template is
`` `${base}tiles/{z}/{x}/{y}.png?${query}` ``. The newest file of a name answers. A link stays valid
until it expires even when the person leaves the team: give the shortest validity that serves.

A link made by a person carries their account and their rights (MK-055): a file attached to a
resource is served only while they hold a level on that resource, so a link to `tiles/` never hands
out the files of an album they cannot read, and revoking their share stops their links to its files;
once they leave the organization their links answer 404. Files without a resource, such as tiles, are
served as the scope of the link says. A link made by code that runs without a person has no creator
and covers its whole scope.

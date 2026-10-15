# Search providers

The search box of the shell finds people, teams and the data of the apps (MK-040,
[ADR-0030](../../adr/0030-global-search-with-pills.md)). Each provider is a pill: **All** shows the first
results of every provider, a pill the results of one provider, a page at a time. The kernel provides
**People** and **Teams**; an extension with a backend adds its own pill with the point
`search.provider`, and searches its own tables:

```yaml
backend:
  jar: lib/files.jar
  api: files
contributes:
  search.provider:
    - id: files
      title: Files               # the label of the pill, at most 40 characters
      path: search               # GET /api/v1/ext/files/search, relative to the API of the extension
      order: 30                  # its place after People and Teams, smaller first; 100 by default
      i18n:
        it: { title: File }
```

The point is typed as the points of extensions are ([Contracts between extensions](contracts.md#contracts-between-extensions)):
`title` and `path` are required, nothing else is allowed, and `path` is a path under the API of the
extension, without a query. A contribution that does not match, or of an extension without a backend,
is ignored, and the status of the extension says why in its `warnings`
(`search.provider files is ignored: …`).

**The call.** The kernel calls the path with the credentials of the person and the organization of the
request, as a call of the web interface, so `@RolesAllowed`, `CurrentOrganization` and row-level
security apply as usual:

```
GET /api/v1/ext/files/search?q=budget%202026&tsquery=budget%3A*%20%26%202026%3A*&offset=0&limit=5
```

`q` is the text as typed (at most 200 characters); `tsquery` is the same text as a PostgreSQL
`tsquery` where every word is a prefix (`budget:* & 2026:*`), with letters and digits only, so it can
be bound to `to_tsquery` as it is; `offset` and `limit` give the page (`limit` at most 50). Answer with
the page and whether there is more:

```json
{
  "results": [
    { "title": "Budget 2026.xlsx", "detail": "Finance / Plans", "link": "/app/files?file=f81",
      "resource": { "type": "file", "id": "f81" } }
  ],
  "more": true
}
```

`title` is required unless `resource` is given; `detail` is one line under it; `link` is a page of the
shell (`/app/...`): any other address is dropped. `resource` names a resource registered with the kernel
([Resources, sharing and permissions](resources-and-sharing.md#resources-sharing-and-permissions)), of
your extension or, with `extension`, of another one, such as a connection of a connections framework:
the kernel resolves it as a [reference](references.md#references-to-resources-of-other-extensions), drops
the result when the person may not read it, its extension is absent or the resource is gone, and takes
the title and the link of the registry when you leave them out.

**Searching.** Search with PostgreSQL full-text search, under row-level security, and filter what the
person may read in the same query with `mk_kernel.allows` (MK-136), so that a page is never short of
results the person cannot see:

```sql
select f.id, f.name as title, f.folder as detail
from ext_files.file f
where to_tsvector('simple', f.name || ' ' || f.folder) @@ to_tsquery('simple', :tsquery)
  and mk_kernel.allows('org.example.files', 'file', f.id::text, 'view')
order by ts_rank(to_tsvector('simple', f.name || ' ' || f.folder), to_tsquery('simple', :tsquery)) desc
limit :limit + 1 offset :offset   -- one more row tells whether there is more
```

Use the dictionary of the language of the data (`english`, `italian`) for texts, `simple` for names
and codes, and an index on the same expression (`create index … using gin (to_tsvector('simple', …))`)
for large tables.

**Time.** The kernel waits for the providers at most `mosaikit.search.timeout` (3 s by default) and in
parallel: a provider that has not answered by then, answers with an error or cannot be reached is
shown as incomplete (`"status": "incomplete"`, `"reason": "timeout"` or `"failed"`), and the results of
the others are shown anyway. Keep the query cheap: the first results of All are asked on every search.

A provider appears only to the people who may use its extension: not when the organization turned the
extension off, and to guests only when the extension was given to them.

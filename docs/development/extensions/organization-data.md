# Data of organizations

Every request of a person to an extension API acts on one organization of the signed-in person (MK-017,
[ADR-0016](../../adr/0016-membership-of-several-organizations.md)). Store the organization with
every row and filter on it, so that data of other organizations are never visible:

```java
@Path("/api/v1/ext/notes/notes")
public class NoteResource {
    @Inject CurrentOrganization organization;   // dev.mosaikit.kernel.api.context

    @GET
    public List<NoteView> list() {
        return notes.findByOrganization(organization.require()).stream().map(NoteView::of).toList();
    }
}
```

`require()` answers `403` when a request has no organization; the kernel already refuses such
requests of people to extension APIs. Calls of services are the exception (below).

## Calls of services

A platform administrator can give the API of an extension to a service identity (MK-124), for
callers that are not people, such as a gateway or a map server. Such a call reaches the extension
with no person and, unless the service names an organization it was allowed with
`X-Mosaikit-Organization`, no organization: `CurrentOrganization.id()` is empty and row-level
security shows no row of any organization. Recognize it with the security identity of Quarkus and
`ServiceCaller` (`dev.mosaikit.kernel.api.context`):

```java
@Inject SecurityIdentity identity;   // io.quarkus.security.identity

boolean service = ServiceCaller.isService(identity.getRoles());                       // not a person
Optional<String> name = ServiceCaller.name(identity.getPrincipal().getName());   // its name
```

Endpoints meant for services check the role, for example with `@RolesAllowed("service")`; endpoints
for people keep their own roles (`organization-user`, ...), which a service never has. A service
identity has no permissions of an organization (MK-056) and no account.

Then let the database enforce it (MK-019, [ADR-0018](../../adr/0018-row-level-security.md)): give
each table of organization data a row-level security policy on `mk_kernel.current_organization()`,
which the kernel sets for every request. Queries that forget the filter still see only the rows
of the organization, and rows of another organization cannot be written:

```sql
create table note (
    id              uuid primary key,
    organization_id uuid not null default mk_kernel.current_organization(),
    text            varchar(500) not null
);
alter table note enable row level security;
create policy note_organization on note
    using (organization_id = mk_kernel.current_organization())
    with check (organization_id = mk_kernel.current_organization());
```

Do not reference the tables of the kernel nor of other extensions: extend the data of another
extension with a table of your own keyed by its identifiers, and read it through the views that
extension publishes as its data contract.

# Events on the server

The Java code of an extension can start work when something happens in the platform, without polling
and without a page open (MK-085): prepare what it keeps for an organization when it is created, release
it when the organization turns the extension off, index a file when it is stored. Unlike the real-time
channel to the pages (`LiveEvents`), delivery is durable: an event waits in the database until the
subscriber took it, through failures and restarts.

Subscribe with an `@ApplicationScoped` bean that implements `PlatformEventSubscriber`
(`dev.mosaikit.kernel.api.events`); the kernel finds it at start:

```java
@ApplicationScoped
public class PrepareOrganization implements PlatformEventSubscriber {
    private static final String EXTENSION = "dev.example.notes";

    @Inject Resources resources;          // dev.mosaikit.kernel.api.resource
    @Inject FileStorage files;            // dev.mosaikit.kernel.api.files

    @Override public String extension() { return EXTENSION; }

    @Override public Set<String> types() {
        return Set.of(PlatformEvents.ORGANIZATION_CREATED, PlatformEvents.FILE_STORED);
    }

    @Override public void handle(PlatformEvent event) {
        switch (event.type()) {
            // Registering by a fixed identifier is idempotent: a second delivery changes nothing.
            case PlatformEvents.ORGANIZATION_CREATED -> resources.register(
                    new ResourceRef(EXTENSION, "folder", "inbox"), Resources.Details.of("Inbox", "/app/notes/inbox"));
            case PlatformEvents.FILE_STORED -> {
                if ((EXTENSION + "/folder/inbox").equals(event.text("resource"))) {
                    index(UUID.fromString(event.text("file")));
                }
            }
            default -> { }
        }
    }
}
```

The kernel raises these events (constants of `PlatformEvents`), with their payload:

| Type | When | Payload |
|---|---|---|
| `organization.created` | an organization was created | `slug`, `name` |
| `organization.deleted` | a platform administrator deleted an organization (MK-130): see [An organization deleted](#an-organization-deleted) | `slug`, `name`, `removableFrom` |
| `extension.enabled` | an organization turned an extension on: one of its apps, after all were off (MK-030) | `extension` |
| `extension.disabled` | an organization turned an extension off: all its apps | `extension` |
| `extension.activated` | any extension became active in the organization: installed or able to run again, updated, or turned on (MK-133) | `extension`, `version`, `active` (`true`), `reason` (`installed`, `updated`, `enabled`), `previousVersion` after an update |
| `extension.deactivated` | any extension stopped being active in the organization: removed, no longer able to run, or turned off; not raised where the organization had turned it off | `extension`, `version` (the one it had), `active` (`false`), `reason` (`removed`, `incompatible`, `disabled`) |
| `file.stored`, `file.deleted` | a file of any extension was stored or deleted (MK-041) | `extension`, `file`, `name`, `contentType`, `size`, and `team` and `resource` (`<extension>/<type>/<id>`) when it has them |
| `resource.registered`, `resource.removed` | a resource of any extension was registered or removed (MK-054) | `extension`, `type`, `id`; `title` and `owner` when registered |
| `sharing.granted` | a resource of any extension was shared with a subject, or a link to it made (MK-055) | `extension`, `type`, `id` of the resource, `grant`, `subject` (`person`, `group`, `organization`, `public`, `link`), `subjectId` (the account or the team) for a person or a group, `level` |
| `sharing.changed` | the level of a grant changed: the resource was shared again with the same subject | as `sharing.granted`, and `previousLevel` |
| `sharing.revoked` | a grant or a link was revoked; a link that expires raises nothing | as `sharing.granted` |
| `team.member.added` | a person was added to a team or to a group of a team, also its first owner when it was created (MK-032); never for a chat | `team`, `account`, `role` (`owner`, `member`, `guest`), `parent` for a group |
| `team.member.changed` | the role of a person in a team or group changed | as `team.member.added`, and `previousRole` |
| `team.member.removed` | a person left a team or group or was removed, also when the team was deleted | as `team.member.added`, with the role they had |
| `permissions.profile.changed` | a permission profile was created, changed or deleted, or stopped being the default of its role (MK-056) | `profile`, `change` (`created`, `changed`, `deleted`), `defaultForRole` (empty for none), `added` and `removed`, the qualified permissions it gained and lost |
| `permissions.profile.assigned` | a profile was assigned to a member, or taken back for the default of their role | `account`, `profile` (empty for the default) |
| `permissions.team.changed` | a permission was granted to a team or revoked | `team`, `permission` (`<extension>:<permission>`), `granted` (boolean) |
| `permissions.exception.changed` | a personal exception was granted or revoked | `account`, `permission`, `granted` (boolean) |

The events of sharing, teams and permissions let an extension that translates grants, teams and
permissions into the rules of another server, such as a map server, follow every change without
polling: on an event, recompute what changed, such as the people of a team with `People` (see
[People and teams of the organization](without-backend.md#people-and-teams-of-the-organization)) or who holds a
permission with `PermissionHolders` (see [Who holds a permission](resources-and-sharing.md#who-holds-a-permission)). They
say what changed, not who holds what now. Some changes reach people without an event of their own: a link that expires, a person added to or
removed from the organization, a change of their roles in it, and the apps of an extension turned
off or on (which raise `extension.disabled` and `extension.enabled`); deleting a team raises
`team.member.removed` for its people, and its grants go with it.

## An organization deleted

When a platform administrator deletes an organization (MK-130), the kernel tells the extensions at
once and removes the data later. The two moments are distinct, and an extension acts only on the
first:

- **At the deletion**, the organization appears nowhere and its people lose access; the kernel raises
  `organization.deleted`, delivered as any event in the organization, which still exists for the
  handler: `CurrentOrganization` is that organization and row-level security shows its data. Release
  what you keep **outside** the database and the files of the kernel: a workspace or a layer on a
  map server, an account on an external service, scheduled or recurring work, a cache, a
  subscription. Stop starting work for the organization.
- **After the retention** of the installation (`mosaikit.organizations.removal-retention`, 30 days
  unless set; `removableFrom` in the payload), a job of the kernel removes the data: the rows of the
  organization in every table of an extension with an `organization_id` column (the one under
  row-level security, see [Data of organizations](organization-data.md#data-of-organizations)), its resources, grants
  and the records of its files, whose content then leaves the store at the clean-up of the files.
  The extension is not called again.

So release, do not destroy: do not delete your rows or the files of the organization on the event.
Until `removableFrom` the deletion can be undone from the database, and what you deleted would be
lost; the kernel deletes them anyway, in one transaction, when the retention is over. Keep every row
of organization data in a table with `organization_id`: a table without it is not removed. A table
that references another of your tables should have that column too, or reference it `on delete
cascade`, or the removal of the organization fails and is retried at each run.

```java
@Override public Set<String> types() { return Set.of(PlatformEvents.ORGANIZATION_DELETED); }

@Override public void handle(PlatformEvent event) {
    // Idempotent: a workspace already gone is not an error.
    mapServer.deleteWorkspaceIfPresent(workspaceOf(event.organization()));
    schedules.cancelAll();                 // the jobs of the extension for this organization
}
```

An extension raises its own events with `PlatformEvents`, naming itself as with
`Notifications.send`; the type becomes `<extension>:<name>`, such as `dev.example.notes:note.created`,
which other extensions subscribe to:

```java
@Inject PlatformEvents events;

events.raise(EXTENSION, "note.created", Map.of("note", note.id().toString(), "folder", folder));
```

- **Written with the change.** An event is written in the transaction of the change that raises it,
  in the organization of the request, and delivered only if that transaction commits. The payload is
  JSON, at most 8192 characters: say what happened, such as identifiers, and let the subscriber read
  the rest. Never put secrets in it. The name is lowercase letters, digits, `.` and `-`; an extension
  that is not active, or a name or payload not valid, is refused with `IllegalArgumentException`.
- **In the organization where it happened.** The handler runs in a transaction of its own, in the
  organization of the event and without a person (MK-126): `CurrentOrganization` is that
  organization, row-level security shows its data only, and the beans of the kernel act in it. What
  the handler stores or registers belongs to the organization, not to a person, and the audit log
  records the extension as actor with the channel `JOB`. An organization that turned the extension
  off sends it no event, except `extension.disabled`, `extension.enabled`, `extension.deactivated`
  and `extension.activated` about the extension itself, so that it releases and prepares what it
  keeps.
- **At least once.** When `handle` throws, its transaction rolls back and the kernel gives the event
  again later, waiting twice as long each time (`mosaikit.events.retry-delay`), up to
  `mosaikit.events.max-attempts`; then it gives up and records `events.delivery.failed` in the audit log
  of the organization. An event raised while the kernel is stopped, or while the subscriber fails, is
  delivered when it is back; `PlatformEvent.attempt()` says which attempt this is.
- **Make handlers idempotent.** An event may arrive twice: the kernel stopped after the handler
  committed and before it marked the event delivered, or a handler took longer than five minutes and
  another kernel took the event again. Register and store by fixed identifiers, check whether the work
  is already done, or keep the handled `PlatformEvent.id()` in a table of the extension in the same
  transaction as the work. Events come roughly in the order they were raised, not strictly when some
  were retried: do not rely on their order.
- **From installation on.** A subscriber receives the events raised after it was installed, not the
  earlier ones. Keep `name()` (`default` unless the extension has several subscribers) stable across
  versions: the kernel keeps what it delivered to each subscriber by that name.
- Each kernel looks for events every `mosaikit.events.poll-interval` (two seconds by default): a
  handler runs a few seconds after the change, not during the request.

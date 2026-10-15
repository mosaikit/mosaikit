# Audit log

Record the sensitive actions of the extension, such as an export, a deletion, a change of settings
or a refused attempt, in the audit log of the organization (MK-059), instead of keeping a log of your
own. Inject `AuditLog` (`dev.mosaikit.kernel.api.audit`) and name the extension in every call, as
with `Notifications.send`:

```java
@Path("/api/v1/ext/dashboards/dashboards")
public class DashboardExport {
    private static final String EXTENSION = "dev.example.dashboards";

    @Inject AuditLog audit;             // dev.mosaikit.kernel.api.audit
    @Inject Sharing sharing;           // dev.mosaikit.kernel.api.sharing
    @Inject DashboardExporter exporter;

    @GET
    @Path("{id}/export")
    public Response export(@PathParam("id") UUID id, @QueryParam("format") String format) {
        sharing.require(new ResourceRef(EXTENSION, "dashboard", id.toString()), "view");
        audit.record(EXTENSION, new AuditLog.Entry(
                "dashboard.exported", "dashboard/" + id, AuditLog.Outcome.SUCCEEDED, Map.of("format", format)));
        return Response.ok(exporter.export(id, format)).build();
    }
}
```

- The kernel adds who (the person of the request, `system` without one), the organization of the
  request, the time and the channel `EXTENSION`; the extension gives the action, its object and
  optional details. A request without an organization is refused with `NoOrganizationException`.
- The action is a stable name, lowercase letters, digits, `.` and `-` (`dashboard.exported`), recorded
  as `<extension>:<action>` (`dev.example.dashboards:dashboard.exported`, at most 100 characters), so
  that the administrators find the entries of the extension with the filter
  `action=dev.example.dashboards:`. The object is at most 255 characters; the details are written as
  JSON, at most 8192 characters. Never put secrets in them, nor personal data the administrators of
  the organization may not read.
- An extension that is not active is refused with `IllegalArgumentException`, like an invalid entry.
- The entry is written in its own transaction: it stays when the transaction of the request rolls
  back, so record a failed or refused attempt with `Outcome.FAILED` or `Outcome.DENIED`. It is chained
  to the entries before it, never changed nor deleted, except by the retention the administrators set
  (see [administration](../../guide/administration.md#audit-log)).

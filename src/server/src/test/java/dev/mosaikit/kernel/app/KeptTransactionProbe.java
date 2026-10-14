// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.audit.AuditLog;
import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.api.files.FileStorage;
import dev.mosaikit.kernel.api.permission.PermissionHolders;
import dev.mosaikit.kernel.api.permission.Permissions;
import dev.mosaikit.kernel.api.quota.Quotas;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.Resources;
import dev.mosaikit.kernel.api.secrets.Secrets;
import dev.mosaikit.kernel.api.sharing.Sharing;
import dev.mosaikit.kernel.api.sharing.Subject;
import io.quarkus.security.Authenticated;
import jakarta.transaction.Status;
import jakarta.transaction.TransactionSynchronizationRegistry;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import java.util.Map;
import java.util.UUID;

/**
 * Stands for the Java code of an extension that calls a bean of the kernel in its own transaction,
 * catches the exception that the API documents, and goes on writing in the same transaction (#126):
 * the write must commit. The write registers a note of {@link #RESOURCES}, which the test then finds.
 */
@Path("/api/v1/test/kept-transaction")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class KeptTransactionProbe {

    static final String RESOURCES = "dev.mosaikit.test.resources";
    static final String ABSENT = "dev.mosaikit.test.absent";

    private final Secrets secrets;
    private final Resources resources;
    private final Sharing sharing;
    private final PermissionHolders holders;
    private final Permissions permissions;
    private final FileStorage files;
    private final Quotas quotas;
    private final AuditLog audit;
    private final PlatformEvents events;
    private final TransactionSynchronizationRegistry transactions;

    @SuppressWarnings("java:S107") // one of each bean
    public KeptTransactionProbe(
            Secrets secrets,
            Resources resources,
            Sharing sharing,
            PermissionHolders holders,
            Permissions permissions,
            FileStorage files,
            Quotas quotas,
            AuditLog audit,
            PlatformEvents events,
            TransactionSynchronizationRegistry transactions) {
        this.secrets = secrets;
        this.resources = resources;
        this.sharing = sharing;
        this.holders = holders;
        this.permissions = permissions;
        this.files = files;
        this.quotas = quotas;
        this.audit = audit;
        this.events = events;
        this.transactions = transactions;
    }

    /**
     * Runs a call that the bean refuses, catches the refusal and registers the note {@code id}.
     *
     * @param target what the call names: a credential, a resource
     * @return the exception caught, and whether the transaction was still active after it
     */
    @POST
    @Path("/{call}/{id}")
    @Transactional
    public Map<String, Object> run(
            @PathParam("call") String call, @PathParam("id") String id, @QueryParam("target") String target) {
        String caught = "nothing";
        try {
            refused(call, target);
        } catch (RuntimeException e) {
            caught = e.getClass().getName();
        }
        boolean active = transactions.getTransactionStatus() == Status.STATUS_ACTIVE;
        resources.register(
                new ResourceRef(RESOURCES, "note", id),
                new Resources.Details("After " + call, "/app/notes/" + id, null));
        return Map.of("caught", caught, "active", active);
    }

    private void refused(String call, String target) {
        switch (call) {
            case "secrets-find" -> secrets.find(SecretsTest.NOTIFY, target);
            case "secrets-resolve" -> secrets.resolve(SecretsTest.NOTIFY, target);
            case "secrets-inactive" -> secrets.find(ABSENT, "any");
            case "resources-unregistered" ->
                resources.update(
                        new ResourceRef(RESOURCES, "note", "absent-" + UUID.randomUUID()),
                        new Resources.Details("Absent", "/app/notes/absent", null));
            case "resources-undeclared" ->
                resources.register(
                        new ResourceRef(RESOURCES, "undeclared", "x"),
                        new Resources.Details("X", "/app/notes/x", null));
            case "sharing-denied" ->
                sharing.grant(
                        new ResourceRef(SharingTest.EXTENSION, "doc", target), new Subject.Organization(), "view");
            case "sharing-unregistered" ->
                sharing.grant(
                        new ResourceRef(SharingTest.EXTENSION, "doc", "absent-" + UUID.randomUUID()),
                        new Subject.Organization(),
                        "view");
            case "sharing-level" ->
                sharing.grant(
                        new ResourceRef(SharingTest.EXTENSION, "doc", target), new Subject.Organization(), "none");
            case "holders-inactive" -> holders.of(ABSENT, "any");
            case "permissions-denied" -> permissions.require(SecretsTest.TODO, "undeclared");
            case "files-missing" -> files.read(FileStorageTest.EXTENSION, UUID.randomUUID());
            case "quotas-exceeded" -> quotas.consume(QuotaApiTest.EXTENSION, "renders", 1_000);
            case "audit-inactive" -> audit.record(ABSENT, AuditLog.Entry.of("tried", "x"));
            case "events-invalid" -> events.raise(SecretsTest.NOTIFY, "Not A Name", Map.of());
            default -> throw new AssertionError("No call " + call);
        }
    }
}

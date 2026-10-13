// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.fixture.notes;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.permission.Permissions;
import io.quarkus.security.Authenticated;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Notes of the sample extension. Extension APIs live under {@code /api/v1/ext/<extension>}; every request acts
 * on one organization, whose notes only it reads and writes (MK-017).
 */
@Path("/api/v1/ext/fixture-notes/notes")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
public class NoteResource {

    /** Request to create a note. */
    public record NewNote(@NotBlank @Size(max = 500) String text) {}

    /** A note as returned by the API. */
    public record NoteView(UUID id, String text, Instant createdAt) {

        static NoteView of(Note note) {
            return new NoteView(note.getId(), note.getText(), note.getCreatedAt());
        }
    }

    /** The identifier of this extension, which it gives to the kernel when it asks for a permission. */
    static final String EXTENSION = "dev.mosaikit.fixture.notes";

    private final Notes notes;
    private final CurrentOrganization organization;
    private final Permissions permissions;

    public NoteResource(Notes notes, CurrentOrganization organization, Permissions permissions) {
        this.notes = notes;
        this.organization = organization;
        this.permissions = permissions;
    }

    @GET
    @Transactional
    public List<NoteView> list() {
        return notes.findByOrganization(organization.require()).stream()
                .map(NoteView::of)
                .toList();
    }

    /**
     * Every note of the organization at once, for the people who hold the permission export-notes
     * (MK-056): the others get 403, whatever their interface shows.
     */
    @GET
    @Path("export")
    @Transactional
    public List<NoteView> export() {
        permissions.require(EXTENSION, "export-notes");
        return list();
    }

    @POST
    @Transactional
    public Response create(@Valid @NotNull NewNote request) {
        Note note = new Note(organization.require(), request.text().strip(), Instant.now());
        notes.insert(note);
        return Response.status(Response.Status.CREATED)
                .entity(NoteView.of(note))
                .build();
    }
}

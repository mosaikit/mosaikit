// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.fixture.notes;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.Resources;
import dev.mosaikit.kernel.api.sharing.Sharing;
import io.quarkus.security.Authenticated;
import jakarta.annotation.security.PermitAll;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Memos of the sample extension (MK-055): each memo is a resource registered with the kernel, which
 * only its author reads until they share it in the sharing dialog of the kernel. The extension has no
 * sharing code of its own: it registers the memo, and asks the kernel at every request.
 */
@Path("/api/v1/ext/fixture-notes/memos")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
public class MemoResource {

    /** The resource type of a memo, declared in the manifest. */
    static final String TYPE = "memo";

    /** Request to write a memo. */
    public record MemoText(@NotBlank @Size(max = 500) String text) {}

    /**
     * A memo as returned by the API.
     *
     * @param level the level of the request on it, as the sharing dialog shows it
     */
    public record MemoView(UUID id, String text, Instant createdAt, String level) {}

    private final Memos memos;
    private final CurrentOrganization organization;
    private final Resources resources;
    private final Sharing sharing;

    public MemoResource(Memos memos, CurrentOrganization organization, Resources resources, Sharing sharing) {
        this.memos = memos;
        this.organization = organization;
        this.resources = resources;
        this.sharing = sharing;
    }

    /** The memos the person may read: theirs and those shared with them, oldest first. */
    @GET
    @Transactional
    public List<MemoView> list() {
        Set<UUID> ids = sharing.visible(NoteResource.EXTENSION, TYPE, "view").stream()
                .map(UUID::fromString)
                .collect(Collectors.toSet());
        if (ids.isEmpty()) {
            return List.of();
        }
        return memos.findByIds(ids).stream().map(this::view).toList();
    }

    /** Writes a memo of the person and registers it with the kernel, which makes them its owner. */
    @POST
    @Transactional
    public Response create(@Valid @NotNull MemoText request) {
        Memo memo = new Memo(organization.require(), request.text().strip(), Instant.now());
        memos.insert(memo);
        resources.register(ref(memo.getId()), Resources.Details.of(title(memo), "/app/notes?memo=" + memo.getId()));
        return Response.status(Response.Status.CREATED).entity(view(memo)).build();
    }

    /**
     * One memo, for the people with the level view on it, and for a link to it: the route is open to
     * requests without an account ({@code @PermitAll}), and the kernel lets them act on the
     * organization of the memo only after {@code Sharing.require} found that their link opens it.
     */
    @GET
    @Path("{id}")
    @PermitAll
    @Transactional
    public MemoView get(@PathParam("id") UUID id) {
        sharing.require(ref(id), "view");
        return view(memos.findById(id).orElseThrow(NotFoundException::new));
    }

    /** Changes a memo, for the people with the level edit on it. */
    @PUT
    @Path("{id}")
    @Transactional
    public MemoView change(@PathParam("id") UUID id, @Valid @NotNull MemoText request) {
        sharing.require(ref(id), "edit");
        Memo memo = memos.findById(id).orElseThrow(NotFoundException::new);
        memo.setText(request.text().strip());
        memos.update(memo);
        resources.update(ref(id), Resources.Details.of(title(memo), "/app/notes?memo=" + id));
        return view(memo);
    }

    private static ResourceRef ref(UUID id) {
        return new ResourceRef(NoteResource.EXTENSION, TYPE, id.toString());
    }

    private static String title(Memo memo) {
        String text = memo.getText();
        return text.length() > 80 ? text.substring(0, 80) : text;
    }

    private MemoView view(Memo memo) {
        return new MemoView(
                memo.getId(),
                memo.getText(),
                memo.getCreatedAt(),
                sharing.level(ref(memo.getId())).orElse(null));
    }
}

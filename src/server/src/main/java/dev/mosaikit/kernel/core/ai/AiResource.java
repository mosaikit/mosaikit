// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import dev.mosaikit.kernel.core.account.SessionResource;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.CookieParam;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The tools of the active plugins, for assistants (MK-015). They act on the organization of the
 * request, with the permissions of the person; the tools that change data wait for the person to
 * confirm them.
 */
@Path("/api/v1/ai")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "AI tools")
public class AiResource {

    private final AiActions actions;
    private final Assistant assistant;
    private final SecurityIdentity identity;
    private final RequestOrganization organization;

    public AiResource(
            AiActions actions, Assistant assistant, SecurityIdentity identity, RequestOrganization organization) {
        this.actions = actions;
        this.assistant = assistant;
        this.identity = identity;
        this.organization = organization;
    }

    /** Whether the installation has an assistant (MK-024). */
    public record AssistantView(boolean enabled, String model) {}

    /** A question to the assistant, with the conversation so far. */
    public record ChatRequest(List<Assistant.Message> messages) {}

    @GET
    @Path("/assistant")
    @Operation(summary = "Tell whether an assistant is configured")
    public AssistantView assistant() {
        return new AssistantView(
                assistant.model().isPresent(), assistant.model().orElse(null));
    }

    @POST
    @Path("/assistant/replies")
    @Operation(
            summary = "Ask the assistant",
            description = "It answers the last message with the tools of the plugins; changes become drafts.")
    public Assistant.Reply ask(
            @HeaderParam(HttpHeaders.AUTHORIZATION) String authorization,
            @CookieParam(SessionResource.COOKIE) String session,
            ChatRequest request) {
        return assistant.answer(request == null ? List.of() : request.messages(), caller(authorization, session));
    }

    @GET
    @Path("/tools")
    @Operation(summary = "List the tools of the active plugins")
    public List<ToolView> tools() {
        organization.require();
        return actions.tools().stream().map(ToolView::of).toList();
    }

    @POST
    @Path("/tools/{tool}/invocations")
    @Operation(
            summary = "Invoke a tool",
            description = "A tool that reads runs at once (200); a tool that changes data becomes a draft (202).")
    public Response invoke(
            @PathParam("tool") String tool,
            @HeaderParam(HttpHeaders.AUTHORIZATION) String authorization,
            @CookieParam(SessionResource.COOKIE) String session,
            Object input) {
        Invocation invocation = actions.invoke(tool, input, caller(authorization, session));
        return Response.status(invocation.isDrafted() ? Response.Status.ACCEPTED : Response.Status.OK)
                .entity(invocation)
                .build();
    }

    @GET
    @Path("/drafts")
    @Operation(summary = "List the drafts that the person can still confirm")
    public List<DraftView> drafts() {
        return actions.openDrafts(caller(null, null));
    }

    @GET
    @Path("/drafts/{id}")
    @Operation(summary = "Get a draft of the person")
    public DraftView draft(@PathParam("id") UUID id) {
        return actions.draft(id, caller(null, null));
    }

    @POST
    @Path("/drafts/{id}/confirmation")
    @Operation(summary = "Confirm a draft, which runs it")
    public Invocation confirm(
            @PathParam("id") UUID id,
            @HeaderParam(HttpHeaders.AUTHORIZATION) String authorization,
            @CookieParam(SessionResource.COOKIE) String session) {
        return actions.confirm(id, caller(authorization, session));
    }

    @DELETE
    @Path("/drafts/{id}")
    @Operation(summary = "Reject a draft, which discards it")
    public DraftView reject(@PathParam("id") UUID id) {
        return actions.reject(id, caller(null, null));
    }

    /**
     * The person, with the credentials that the call to the plugin carries: the {@code
     * Authorization} header, or the session cookie of the shell.
     */
    private Caller caller(String authorization, String session) {
        return Caller.of(identity, organization, authorization, authorization == null ? session : null);
    }
}

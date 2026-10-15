// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.resources;

import com.fasterxml.jackson.annotation.JsonInclude;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.ArrayList;
import java.util.List;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * References between resources of different extensions (MK-135), for the frontends of extensions: the
 * kernel resolves each reference to the resource or to the reason it is not available, and tells the
 * administrators which extension to install or turn on when that is the reason.
 */
@Path("/api/v1/resources/references")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Resources")
public class ResourceReferencesResource {

    /** The most references resolved in one request, such as the widgets of a dashboard. */
    static final int MAX_REFERENCES = 100;

    /** A referred resource, as the referring extension keeps it. */
    public record ReferenceRequest(String extension, String type, String id) {}

    /**
     * What a reference resolves to: {@code status} is {@code available} (with {@code title} and
     * {@code link}), {@code extension-absent}, {@code deleted} or {@code forbidden}.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ReferenceView(
            String extension, String type, String id, String status, String title, String link, Missing missing) {}

    /**
     * For administrators, the extension a reference needs and what brings it back: {@code install} it
     * in the installation, {@code restart} the installation when its Java code waits for it,
     * {@code repair} it when it is installed but cannot run (incompatible, or missing what it
     * requires), or {@code turn-on} its apps in the organization.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Missing(String extension, String name, String action) {}

    private final KernelResourceReferences references;
    private final ReferenceViews views;
    private final SecurityIdentity identity;

    public ResourceReferencesResource(
            KernelResourceReferences references, ReferenceViews views, SecurityIdentity identity) {
        this.references = references;
        this.views = views;
        this.identity = identity;
    }

    @POST
    @Path("/resolve")
    @Operation(
            summary = "Resolve references to resources of extensions",
            description =
                    "For each reference, in the same order: the resource when the person may read it, or why it is"
                            + " not available (extension-absent, deleted, forbidden). To administrators, an absent extension"
                            + " comes with what brings it back (install, restart, repair, turn-on). At most 100 references; nothing"
                            + " is changed.")
    public List<ReferenceView> resolve(List<ReferenceRequest> request) {
        if (request == null || request.isEmpty()) {
            throw new InvalidInputException(List.of("at least one reference is required"));
        }
        if (request.size() > MAX_REFERENCES) {
            throw new InvalidInputException(List.of("at most " + MAX_REFERENCES + " references at once"));
        }
        List<ResourceRef> targets = new ArrayList<>();
        for (int i = 0; i < request.size(); i++) {
            ReferenceRequest item = request.get(i);
            try {
                if (item == null) {
                    throw new IllegalArgumentException("is missing");
                }
                targets.add(new ResourceRef(item.extension(), item.type(), item.id()));
            } catch (IllegalArgumentException | NullPointerException e) {
                throw new InvalidInputException(List.of("reference " + i + ": " + e.getMessage()));
            }
        }
        boolean administrator = ReferenceViews.administrator(identity);
        return targets.stream()
                .map(references::resolve)
                .map(resolved -> views.view(resolved, administrator))
                .toList();
    }
}

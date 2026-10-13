// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.service;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.identity.IdentityDirectory;
import dev.mosaikit.kernel.core.identity.IdentityRouting;
import dev.mosaikit.kernel.core.identity.OrganizationIdentity;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The service identities of the installation (MK-124), which platform administrators create, give
 * APIs to, rotate the keys of and revoke. Every change is in the audit log of the platform.
 */
@Path("/api/v1/platform/service-identities")
@Produces(MediaType.APPLICATION_JSON)
@RolesAllowed(Roles.PLATFORM_ADMIN)
@Tag(name = "Platform")
public class ServiceIdentityResource {

    private final ServiceRegistry registry;
    private final IdentityDirectory directory;
    private final SecurityIdentity identity;
    private final AuditLog audit;

    public ServiceIdentityResource(
            ServiceRegistry registry, IdentityDirectory directory, SecurityIdentity identity, AuditLog audit) {
        this.registry = registry;
        this.directory = directory;
        this.identity = identity;
        this.audit = audit;
    }

    @GET
    @Operation(
            summary = "List the service identities",
            description = "With what each may call and its live keys, never their secret.")
    public ServiceIdentityView.Identities list() {
        Map<UUID, List<ServiceKey>> keys =
                registry.liveKeys().stream().collect(Collectors.groupingBy(ServiceKey::getServiceId));
        IdentityRouting routing = directory.routing();
        List<ServiceIdentityView> found = registry.identities().stream()
                .map(service -> view(service, keys.getOrDefault(service.getId(), List.of()), null, routing))
                .toList();
        return new ServiceIdentityView.Identities(
                found, ServiceRegistry.ENDPOINTS.stream().sorted().toList(), ServiceRegistry.MAX_LIVE_KEYS);
    }

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Operation(
            summary = "Create a service identity",
            description =
                    "With a first key, whose secret the answer holds this once: the kernel keeps only its" + " digest.")
    public Response create(ServiceIdentityView.Request request) {
        if (request == null) {
            throw new InvalidInputException(List.of("name is required"));
        }
        ServiceRegistry.Created created =
                registry.create(request.name(), request.description(), grants(request), administrator());
        ServiceIdentity service = created.identity();
        audit("service.identity.created", service.getName(), detail(service.getId(), service.grants()));
        audit("service.key.created", created.key().getPrefix(), keyDetail(service, created.key()));
        return Response.status(Response.Status.CREATED)
                .entity(view(service, List.of(created.key()), created.secret(), directory.routing()))
                .build();
    }

    @PUT
    @Path("/{id}")
    @Consumes(MediaType.APPLICATION_JSON)
    @Operation(
            summary = "Change what a service identity may call",
            description = "Its description, APIs, endpoints and organizations; its next request follows them.")
    public ServiceIdentityView grant(@PathParam("id") UUID id, ServiceIdentityView.Request request) {
        if (request == null) {
            throw new InvalidInputException(List.of("apis is required"));
        }
        ServiceIdentity service = registry.grant(id, request.description(), grants(request));
        audit("service.identity.changed", service.getName(), detail(id, service.grants()));
        return view(service, registry.liveKeysOf(id), null, directory.routing());
    }

    @POST
    @Path("/{id}/keys")
    @Operation(
            summary = "Create a new key for a service identity",
            description = "To rotate its key: the old one goes on until it is revoked. An identity has at most two"
                    + " live keys. The answer holds the secret, shown this once.")
    public Response newKey(@PathParam("id") UUID id) {
        ServiceRegistry.Created created = registry.newKey(id);
        audit("service.key.created", created.key().getPrefix(), keyDetail(created.identity(), created.key()));
        return Response.status(Response.Status.CREATED)
                .entity(ServiceIdentityView.Key.of(created.key(), created.secret()))
                .build();
    }

    @DELETE
    @Path("/{id}/keys/{key}")
    @Operation(summary = "Revoke a key of a service identity", description = "The next request with it is refused.")
    public Response revoke(@PathParam("id") UUID id, @PathParam("key") UUID key) {
        ServiceIdentity service = registry.identity(id);
        ServiceKey revoked = registry.revoke(id, key)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "This service identity has no live key with this" + " identifier."));
        audit("service.key.revoked", revoked.getPrefix(), keyDetail(service, revoked));
        return Response.noContent().build();
    }

    /** The grants of a request, with the organizations named by slug. */
    private ServiceIdentity.Grants grants(ServiceIdentityView.Request request) {
        IdentityRouting routing = directory.routing();
        Set<UUID> organizations = new HashSet<>();
        List<String> unknown = new ArrayList<>();
        for (String slug : names(request.organizations())) {
            routing.bySlug(slug.toLowerCase(Locale.ROOT))
                    .map(OrganizationIdentity::id)
                    .ifPresentOrElse(organizations::add, () -> unknown.add(slug));
        }
        if (!unknown.isEmpty()) {
            throw new InvalidInputException(unknown.stream()
                    .map(slug -> "organizations: no organization " + slug)
                    .toList());
        }
        return new ServiceIdentity.Grants(names(request.apis()), names(request.endpoints()), organizations);
    }

    private static Set<String> names(Collection<String> names) {
        return names == null
                ? Set.of()
                : names.stream()
                        .filter(name -> name != null && !name.isBlank())
                        .map(String::strip)
                        .collect(Collectors.toUnmodifiableSet());
    }

    private static ServiceIdentityView view(
            ServiceIdentity service, List<ServiceKey> keys, String secret, IdentityRouting routing) {
        ServiceIdentity.Grants grants = service.grants();
        return new ServiceIdentityView(
                service.getId(),
                service.getName(),
                service.getDescription(),
                grants.apis().stream().sorted().toList(),
                grants.endpoints().stream().sorted().toList(),
                grants.organizations().stream()
                        .map(id ->
                                routing.byId(id).map(OrganizationIdentity::slug).orElse(id.toString()))
                        .sorted()
                        .toList(),
                service.getCreatedAt(),
                service.getCreatedBy(),
                keys.stream()
                        .map(key -> ServiceIdentityView.Key.of(key, secret))
                        .toList());
    }

    private static Map<String, Object> detail(UUID id, ServiceIdentity.Grants grants) {
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("service", id.toString());
        detail.put("apis", grants.apis().stream().sorted().toList());
        detail.put("endpoints", grants.endpoints().stream().sorted().toList());
        detail.put(
                "organizations",
                grants.organizations().stream().map(UUID::toString).sorted().toList());
        return detail;
    }

    private static Map<String, Object> keyDetail(ServiceIdentity service, ServiceKey key) {
        return Map.of(
                "service",
                service.getId().toString(),
                "name",
                service.getName(),
                "key",
                key.getId().toString());
    }

    private void audit(String action, String subject, Map<String, Object> detail) {
        audit.append(administrator(), Optional.empty(), action, subject, AuditEvent.Outcome.SUCCEEDED, detail);
    }

    private String administrator() {
        return identity.getPrincipal().getName();
    }
}

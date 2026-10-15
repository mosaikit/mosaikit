// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.sharing.Sharing;
import dev.mosaikit.kernel.api.sharing.Subject;
import io.agroal.api.AgroalDataSource;
import jakarta.annotation.security.PermitAll;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.sql.SQLException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * Stands for the Java code of an extension that shares its resources (MK-055): it calls the
 * {@link Sharing} bean as an extension does, and runs {@code mk_kernel.allows()} in plain SQL as the
 * query of a list page would. Anonymous requests are let in, for links.
 */
@Path("/api/v1/test/sharing/{extension}/{type}")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@PermitAll
public class SharingProbe {

    /** A grant asked by the extension: {@code kind} person, group, organization, public or link. */
    public record Body(String kind, UUID id, String level, Instant expires) {}

    private final Sharing sharing;
    private final AgroalDataSource dataSource;
    private final CurrentOrganization organization;

    public SharingProbe(Sharing sharing, AgroalDataSource dataSource, CurrentOrganization organization) {
        this.sharing = sharing;
        this.dataSource = dataSource;
        this.organization = organization;
    }

    /**
     * What a request opened with a link sees before and after it asks {@code Sharing} about a
     * resource, as the route of an extension served to a link does (MK-055): its organization and the
     * registered resources that the row-level security shows it, with one connection held across, as
     * in a transaction, and with a new one after.
     */
    @GET
    @Path("/{id}/admission")
    @Transactional
    public Response admission(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        Map<String, Object> seen = new LinkedHashMap<>();
        try (var held = dataSource.getConnection()) {
            seen.put("organizationBefore", organization.id().map(UUID::toString).orElse(""));
            seen.put("rowsBefore", resources(held));
            seen.put(
                    "level", sharing.level(new ResourceRef(extension, type, id)).orElse(""));
            seen.put("organizationAfter", organization.id().map(UUID::toString).orElse(""));
            seen.put("rowsAfter", resources(held));
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
        return Response.ok(seen).build();
    }

    /** The same, without asking about the resource: the route stays without organization. */
    @GET
    @Path("/{id}/no-admission")
    @Transactional
    public Response noAdmission() {
        try (var held = dataSource.getConnection()) {
            return Response.ok(Map.of(
                            "organization",
                                    organization.id().map(UUID::toString).orElse(""),
                            "rows", resources(held)))
                    .build();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    private static int resources(java.sql.Connection connection) throws SQLException {
        try (var statement = connection.prepareStatement("select count(*) from mk_kernel.resource");
                var result = statement.executeQuery()) {
            result.next();
            return result.getInt(1);
        }
    }

    /** The level of the request, or of {@code person}, as {@code {"level": ...}}. */
    @GET
    @Path("/{id}/level")
    public Response level(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id,
            @QueryParam("person") UUID person) {
        ResourceRef ref = new ResourceRef(extension, type, id);
        return answer(
                () -> Map.of("level", (person == null ? sharing.level(ref) : sharing.level(person, ref)).orElse("")));
    }

    /** {@code require} of the request, as the backend of an extension calls it. */
    @GET
    @Path("/{id}/require/{level}")
    public Response require(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id,
            @PathParam("level") String level) {
        sharing.require(new ResourceRef(extension, type, id), level);
        return Response.noContent().build();
    }

    /** {@code allows} of the request or of {@code person}, and {@code mk_kernel.allows()} of the request. */
    @GET
    @Path("/{id}/allows/{level}")
    public Response allows(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id,
            @PathParam("level") String level,
            @QueryParam("person") UUID person) {
        ResourceRef ref = new ResourceRef(extension, type, id);
        return answer(() -> Map.of(
                "java",
                person == null ? sharing.allows(ref, level) : sharing.allows(person, ref, level),
                "sql",
                sql(extension, type, id, level)));
    }

    /** The identifiers that {@code visible} gives, and those that a query with {@code mk_kernel.allows()} gives. */
    @GET
    @Path("/visible/{level}")
    public Response visible(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("level") String level,
            @QueryParam("person") UUID person) {
        return answer(() -> Map.of(
                "java",
                new TreeSet<>(
                        person == null
                                ? sharing.visible(extension, type, level)
                                : sharing.visible(person, extension, type, level)),
                "sql",
                sqlList(extension, type, level)));
    }

    /** Shares as the extension does, through the Java API. */
    @POST
    @Path("/{id}/grants")
    public Response grant(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id,
            Body body) {
        ResourceRef ref = new ResourceRef(extension, type, id);
        return answer(() -> switch (body.kind()) {
            case "link" -> sharing.createLink(ref, body.level(), body.expires());
            case "person" -> sharing.grant(ref, Subject.person(body.id()), body.level());
            case "group" -> sharing.grant(ref, Subject.group(body.id()), body.level());
            case "organization" -> sharing.grant(ref, Subject.organization(), body.level());
            default -> sharing.grant(ref, Subject.everyone(), body.level());
        });
    }

    /** The grants as the Java API lists them. */
    @GET
    @Path("/{id}/grants")
    public Response grants(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        return answer(() -> sharing.grants(new ResourceRef(extension, type, id)));
    }

    /** The grants that reach the resource from the resources above it, as the Java API lists them (MK-136). */
    @GET
    @Path("/{id}/inherited")
    public Response inherited(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        return answer(() -> sharing.inheritedGrants(new ResourceRef(extension, type, id)));
    }

    private boolean sql(String extension, String type, String id, String level) {
        try (var connection = dataSource.getConnection();
                var statement = connection.prepareStatement("select mk_kernel.allows(?, ?, ?, ?)")) {
            statement.setString(1, extension);
            statement.setString(2, type);
            statement.setString(3, id);
            statement.setString(4, level);
            try (var result = statement.executeQuery()) {
                result.next();
                return result.getBoolean(1);
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }

    private Set<String> sqlList(String extension, String type, String level) {
        Set<String> ids = new TreeSet<>();
        try (var connection = dataSource.getConnection();
                var statement = connection.prepareStatement("""
                        select r.ref_id from mk_kernel.resource r
                        where r.extension_id = ? and r.type = ?
                          and mk_kernel.allows(r.extension_id, r.type, r.ref_id, ?)""")) {
            statement.setString(1, extension);
            statement.setString(2, type);
            statement.setString(3, level);
            try (var result = statement.executeQuery()) {
                while (result.next()) {
                    ids.add(result.getString(1));
                }
            }
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
        return ids;
    }

    private static Response answer(Supplier<Object> call) {
        try {
            return Response.ok(call.get()).build();
        } catch (NoSuchElementException e) {
            return Response.status(Response.Status.NOT_FOUND).build();
        } catch (IllegalArgumentException e) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(Map.of("error", String.valueOf(e.getMessage())))
                    .build();
        }
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import io.agroal.api.AgroalDataSource;
import io.quarkus.arc.Arc;
import io.quarkus.arc.Unremovable;
import io.quarkus.vertx.http.runtime.CurrentVertxRequest;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.RequestScoped;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * The organization that a request without an account names to read what it shares with the public
 * (MK-055, MK-100): the slug in the {@value #HEADER} header, as the embedded views of the shell send
 * it. Such a request has no organization; {@code Sharing} lets it act on the one it names only for a
 * resource that the public reaches there, as for a link ({@link KernelSharing}).
 */
@RequestScoped
@Unremovable
public class PublicRequest {

    /** Header with the slug of the organization whose public resources the request reads. */
    public static final String HEADER = "X-Mosaikit-Public";

    /**
     * Data of the routing context: the organization that {@link LinkRequestPolicy} found sharing with
     * the public a resource of the extension of the API, for a request without an account.
     */
    public static final String NAMED = "mosaikit.public.organization";

    private static final String SHARES = "select mk_kernel.public_shares(?, ?)";

    private final AgroalDataSource dataSource;
    private final CurrentVertxRequest request;
    private final Map<String, Optional<UUID>> organizations = new HashMap<>();
    private String named;

    public PublicRequest(AgroalDataSource dataSource, CurrentVertxRequest request) {
        this.dataSource = dataSource;
        this.request = request;
    }

    /** Names the organization for this request, in place of the header: for the endpoint that opens a resource. */
    void name(String slug) {
        named = slug;
        organizations.clear();
    }

    /**
     * The organization the request names, when it shares a resource of the extension with the public;
     * resolved once per request and extension.
     */
    public Optional<UUID> organization(String extension) {
        String slug = slug();
        if (slug == null || slug.isBlank()) {
            return Optional.empty();
        }
        return organizations.computeIfAbsent(extension, found -> shares(dataSource, slug, found));
    }

    private String slug() {
        if (named != null) {
            return named;
        }
        RoutingContext routing = request.getCurrent();
        return routing == null ? null : routing.request().getHeader(HEADER);
    }

    /**
     * The organization of a slug when it shares with the public a resource of the extension that is
     * not in the trash, and is not deleted; read whatever the organization of the request.
     */
    static Optional<UUID> shares(AgroalDataSource dataSource, String slug, String extension) {
        if (slug == null || extension == null || slug.length() > 63) {
            return Optional.empty();
        }
        try (var connection = dataSource.getConnection();
                var statement = connection.prepareStatement(SHARES)) {
            statement.setString(1, slug.strip());
            statement.setString(2, extension);
            try (var result = statement.executeQuery()) {
                return result.next() ? Optional.ofNullable(result.getObject(1, UUID.class)) : Optional.empty();
            }
        } catch (SQLException e) {
            throw new IllegalStateException("Cannot read the public shares of " + slug, e);
        }
    }

    /** The organization named by the current request for an extension, when there is a request. */
    static Optional<UUID> current(String extension) {
        var container = Arc.container();
        if (container == null || !container.requestContext().isActive()) {
            return Optional.empty();
        }
        return container.instance(PublicRequest.class).get().organization(extension);
    }
}

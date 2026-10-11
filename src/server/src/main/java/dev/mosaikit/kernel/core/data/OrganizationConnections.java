// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.data;

import dev.mosaikit.kernel.core.identity.RequestOrganization;
import io.agroal.api.AgroalPoolInterceptor;
import io.quarkus.arc.Arc;
import io.quarkus.arc.ArcContainer;
import io.quarkus.security.identity.CurrentIdentityAssociation;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.Optional;
import java.util.UUID;

/**
 * Gives each connection taken from the pool the organization of the current request, the person
 * and whether they are a guest (MK-032), and the member role that makes the row-level security
 * policies apply (MK-019); takes them away when the connection goes back to the pool.
 */
@ApplicationScoped
public class OrganizationConnections implements AgroalPoolInterceptor {

    private static final String SET =
            "select set_config('role', ?, false), set_config('mosaikit.organization', ?, false),"
                    + " set_config('mosaikit.account', ?, false), set_config('mosaikit.guest', ?, false)";
    private static final String NONE = "none";

    private final RowSecurity rowSecurity;

    public OrganizationConnections(RowSecurity rowSecurity) {
        this.rowSecurity = rowSecurity;
    }

    @Override
    public void onConnectionAcquire(Connection connection) {
        Optional<String> role = rowSecurity.role();
        if (role.isEmpty()) {
            return;
        }
        // Every request runs as the member role, so that a request without organization sees no row
        // of the plugins; outside requests (start, migrations) the connection keeps the owner.
        Optional<Request> request = currentRequest();
        if (request.isEmpty()) {
            apply(connection, NONE, Request.NONE);
        } else {
            apply(connection, role.get(), request.get());
        }
    }

    @Override
    public void onConnectionReturn(Connection connection) {
        if (rowSecurity.role().isPresent()) {
            apply(connection, NONE, Request.NONE);
        }
    }

    private static void apply(Connection connection, String role, Request request) {
        try (PreparedStatement statement = connection.prepareStatement(SET)) {
            statement.setString(1, role);
            statement.setString(2, request.organization().map(UUID::toString).orElse(""));
            statement.setString(3, request.account().map(UUID::toString).orElse(""));
            statement.setString(4, String.valueOf(request.guest()));
            statement.execute();
        } catch (SQLException e) {
            throw new IllegalStateException("Cannot set the organization of the connection", e);
        }
    }

    /** What the policies know of a request: its organization, its person, and if a guest. */
    record Request(Optional<UUID> organization, Optional<UUID> account, boolean guest) {
        static final Request NONE = new Request(Optional.empty(), Optional.empty(), false);
    }

    /** The request on this thread, if there is one. */
    static Optional<Request> currentRequest() {
        ArcContainer container = Arc.container();
        if (container == null || !container.requestContext().isActive()) {
            return Optional.empty();
        }
        var association = container.instance(CurrentIdentityAssociation.class);
        SecurityIdentity identity =
                association.isAvailable() ? association.get().getIdentity() : null;
        return Optional.of(new Request(
                RequestOrganization.of(identity),
                RequestOrganization.account(identity),
                RequestOrganization.guest(identity)));
    }
}

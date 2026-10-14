// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.permission.PermissionHolders;
import dev.mosaikit.kernel.core.account.UserAccount;
import dev.mosaikit.kernel.core.account.UserAccounts;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Stands for the Java backend of an extension that translates its permissions into the rules of
 * another server (MK-056): it asks the {@link PermissionHolders} bean who holds a permission, naming
 * the extension, and answers with the usernames of the people, sorted, and the teams.
 */
@Path("/api/v1/test/permission-holders/{extension}/{permission}")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class PermissionHoldersProbe {

    private final PermissionHolders holders;
    private final UserAccounts accounts;

    public PermissionHoldersProbe(PermissionHolders holders, UserAccounts accounts) {
        this.holders = holders;
        this.accounts = accounts;
    }

    @GET
    public Response holders(@PathParam("extension") String extension, @PathParam("permission") String permission) {
        try {
            PermissionHolders.Holders found = holders.of(extension, permission);
            return Response.ok(Map.of(
                            "permission", found.permission().toString(),
                            "people", usernames(found.people().stream().toList()),
                            "teams",
                                    found.teams().stream()
                                            .map(UUID::toString)
                                            .sorted()
                                            .toList()))
                    .build();
        } catch (IllegalArgumentException e) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(List.of(String.valueOf(e.getMessage())))
                    .build();
        }
    }

    private List<String> usernames(List<UUID> people) {
        return people.stream()
                .map(account ->
                        accounts.findById(account).map(UserAccount::getUsername).orElse(account.toString()))
                .sorted()
                .toList();
    }
}

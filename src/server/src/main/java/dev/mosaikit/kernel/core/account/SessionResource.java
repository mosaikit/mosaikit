// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.PermitAll;
import jakarta.ws.rs.CookieParam;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.NewCookie;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The session of the shell for local accounts. {@code POST /api/v1/accounts/session} with the form
 * fields {@code username} and {@code password} is answered by the form authentication of Quarkus,
 * with the same {@link LocalIdentityProvider} as HTTP Basic: it sets an encrypted, HttpOnly cookie,
 * so that a reload of the page keeps the session and no script of the page, plugins included, ever
 * holds the password. API and MCP clients keep using HTTP Basic or bearer tokens.
 */
@Path("/api/v1/accounts/session")
@Produces(MediaType.APPLICATION_JSON)
@Tag(name = "Accounts")
public class SessionResource {

    /** The session cookie; {@code quarkus.http.auth.form.cookie-name} must have this value. */
    public static final String COOKIE = "mosaikit-session";

    private final AccountService service;
    private final SecurityIdentity identity;
    private final RememberMe rememberMe;
    private final String cookie;

    public SessionResource(
            AccountService service,
            SecurityIdentity identity,
            RememberMe rememberMe,
            @ConfigProperty(name = "quarkus.http.auth.form.cookie-name") String cookie) {
        this.service = service;
        this.identity = identity;
        this.rememberMe = rememberMe;
        this.cookie = cookie;
    }

    @GET
    @PermitAll
    @Operation(summary = "Get the account of the current session, if any")
    public Response current() {
        if (identity.isAnonymous()) {
            return Response.noContent().build();
        }
        return Response.ok(service.get(
                        identity.getPrincipal().getName(), identity.getRoles(), RequestOrganization.of(identity)))
                .build();
    }

    @POST
    @Path("/remembrance")
    @Authenticated
    @Operation(
            summary = "Remember the signed-in person on this browser",
            description = "Sets an HttpOnly cookie that signs the person in again when the session ends,"
                    + " for mosaikit.accounts.remember-for, until they sign out.")
    public Response remember(@Context UriInfo uri) {
        String token = rememberMe
                .issue(identity.getPrincipal().getName())
                .orElseThrow(
                        () -> new ForbiddenOperationException(
                                "Only accounts with a password are remembered; accounts of a realm are remembered by the realm."));
        NewCookie remembered = new NewCookie.Builder(RememberMe.COOKIE)
                .value(token)
                .path("/")
                .maxAge((int) rememberMe.duration().toSeconds())
                .httpOnly(true)
                .secure("https".equals(uri.getBaseUri().getScheme()))
                .sameSite(NewCookie.SameSite.STRICT)
                .build();
        return Response.noContent().cookie(remembered).build();
    }

    @DELETE
    @PermitAll
    @Operation(summary = "End the session of the shell, and forget the browser if it was remembered")
    public Response end(@CookieParam(RememberMe.COOKIE) String remembered) {
        rememberMe.revoke(remembered);
        return Response.noContent()
                .cookie(expired(cookie), expired(RememberMe.COOKIE))
                .build();
    }

    private static NewCookie expired(String name) {
        return new NewCookie.Builder(name)
                .value("")
                .path("/")
                .maxAge(0)
                .httpOnly(true)
                .sameSite(NewCookie.SameSite.STRICT)
                .build();
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.identity.OrganizationAccess;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import io.quarkus.security.Authenticated;
import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.identity.SecurityIdentity;
import io.vertx.core.http.HttpServerRequest;
import jakarta.annotation.security.PermitAll;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.CookieParam;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.FormParam;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.NewCookie;
import jakarta.ws.rs.core.Response;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The session of the shell for local accounts. {@code POST /api/v1/accounts/session} with the form
 * fields {@code username} and {@code password} verifies them with the same {@link
 * LocalIdentityProvider} as HTTP Basic and opens a session that the kernel keeps (MK-125): the
 * HttpOnly cookie holds only a random value, so that a reload of the page keeps the session, no script
 * of the page, extensions included, ever holds the password, and signing out ends the session on the
 * server, whoever kept a copy of the cookie. API and MCP clients keep using HTTP Basic or bearer
 * tokens.
 */
@Path("/api/v1/accounts/session")
@Produces(MediaType.APPLICATION_JSON)
@Tag(name = "Accounts")
public class SessionResource {

    /** The session cookie. */
    public static final String COOKIE = "mosaikit-session";

    /** Longest password verified: longer ones are refused without hashing them. */
    private static final int MAX_PASSWORD = 1024;

    private final AccountService service;
    private final SecurityIdentity identity;
    private final RememberMe rememberMe;
    private final LocalIdentityProvider local;
    private final SessionRegistry sessions;
    private final SecureCookies secureCookies;

    public SessionResource(
            AccountService service,
            SecurityIdentity identity,
            RememberMe rememberMe,
            LocalIdentityProvider local,
            SessionRegistry sessions,
            SecureCookies secureCookies) {
        this.service = service;
        this.identity = identity;
        this.rememberMe = rememberMe;
        this.local = local;
        this.sessions = sessions;
        this.secureCookies = secureCookies;
    }

    @POST
    @PermitAll
    @Consumes(MediaType.APPLICATION_FORM_URLENCODED)
    @Operation(
            summary = "Sign a local account in and open a session of the shell",
            description = "200 with the account and an HttpOnly session cookie, or 401. A session cookie"
                    + " sent along ends its session first.")
    public Response open(
            @FormParam("username") String username,
            @FormParam("password") String password,
            @CookieParam(COOKIE) String previous,
            @Context HttpServerRequest request) {
        if (username == null || username.isBlank() || password == null || password.length() > MAX_PASSWORD) {
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        SecurityIdentity signedIn;
        try {
            signedIn = local.verify(
                    username,
                    password.toCharArray(),
                    request.getHeader(OrganizationAccess.HEADER),
                    request.authority() == null ? null : request.authority().host());
        } catch (AuthenticationFailedException e) {
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        sessions.byCookie(previous).ifPresent(session -> sessions.end(session.id()));
        UUID account = UUID.fromString(signedIn.getAttribute(OrganizationAccess.ACCOUNT_ATTRIBUTE));
        UUID organization = LocalIdentityProvider.organizationOf(signedIn);
        SessionRegistry.Opened opened = sessions.open(account, organization, SessionClient.of(request));
        NewCookie cookie = new NewCookie.Builder(COOKIE)
                .value(opened.token())
                .path("/")
                .httpOnly(true)
                .secure(secureCookies.secure(request))
                .sameSite(NewCookie.SameSite.STRICT)
                .build();
        return Response.ok(service.get(
                        signedIn.getPrincipal().getName(), signedIn.getRoles(), RequestOrganization.of(signedIn)))
                .cookie(cookie)
                .build();
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
                    + " for mosaikit.accounts.remember-for, until they sign out or the session is ended.")
    public Response remember(@Context HttpServerRequest request) {
        String token = rememberMe
                .issue(
                        identity.getPrincipal().getName(),
                        SessionRegistry.of(identity).orElse(null))
                .orElseThrow(
                        () -> new ForbiddenOperationException(
                                "Only accounts with a password are remembered; accounts of a realm are remembered by the realm."));
        NewCookie remembered = new NewCookie.Builder(RememberMe.COOKIE)
                .value(token)
                .path("/")
                .maxAge((int) rememberMe.duration().toSeconds())
                .httpOnly(true)
                .secure(secureCookies.secure(request))
                .sameSite(NewCookie.SameSite.STRICT)
                .build();
        return Response.noContent().cookie(remembered).build();
    }

    @DELETE
    @PermitAll
    @Operation(
            summary = "End the session of the request, and forget the browser if it was remembered",
            description = "The cookie, or the tokens of the realm session, open nothing any more.")
    public Response end(@CookieParam(RememberMe.COOKIE) String remembered, @Context HttpServerRequest request) {
        SessionRegistry.of(identity).ifPresent(sessions::end);
        rememberMe.revoke(remembered);
        boolean secure = secureCookies.secure(request);
        return Response.noContent()
                .cookie(expired(COOKIE, secure), expired(RememberMe.COOKIE, secure))
                .build();
    }

    /** A cookie that the browser deletes, with {@code Secure} like the cookie it replaces. */
    static NewCookie expired(String name, boolean secure) {
        return new NewCookie.Builder(name)
                .value("")
                .path("/")
                .maxAge(0)
                .httpOnly(true)
                .secure(secure)
                .sameSite(NewCookie.SameSite.STRICT)
                .build();
    }
}

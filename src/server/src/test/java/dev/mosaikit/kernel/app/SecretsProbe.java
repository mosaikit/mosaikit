// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.secrets.SecretValue;
import dev.mosaikit.kernel.api.secrets.Secrets;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.function.Supplier;

/**
 * Stands for the Java code of an extension that calls an external service with a credential of the
 * organization (MK-062): it reads the value through the {@link Secrets} bean, naming the extension,
 * uses it on the server, and answers only its digest, as a backend answers the result of the call and
 * never the key.
 */
@Path("/api/v1/test/secrets")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class SecretsProbe {

    private final Secrets secrets;

    public SecretsProbe(Secrets secrets) {
        this.secrets = secrets;
    }

    @GET
    @Path("/{extension}/{name}")
    public Response use(@PathParam("extension") String extension, @PathParam("name") String name)
            throws NoSuchAlgorithmException {
        return answer(() -> secrets.require(extension, name));
    }

    /** The most specific credential, of the organization or else of the installation (MK-127). */
    @GET
    @Path("/resolved/{extension}/{name}")
    public Response resolve(@PathParam("extension") String extension, @PathParam("name") String name)
            throws NoSuchAlgorithmException {
        return answer(() -> secrets.resolve(extension, name)
                .orElseThrow(() -> new NoSuchElementException("No credential named " + name + " for " + extension)));
    }

    private static Response answer(Supplier<SecretValue> read) throws NoSuchAlgorithmException {
        try (SecretValue value = read.get()) {
            byte[] bytes = value.bytes();
            String digest = HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            return Response.ok(Map.of("sha256", digest, "masked", value.toString()))
                    .build();
        } catch (NoSuchElementException e) {
            return Response.status(Response.Status.NOT_FOUND)
                    .entity(Map.of("detail", e.getMessage()))
                    .build();
        } catch (IllegalArgumentException e) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(Map.of("detail", e.getMessage()))
                    .build();
        }
    }
}

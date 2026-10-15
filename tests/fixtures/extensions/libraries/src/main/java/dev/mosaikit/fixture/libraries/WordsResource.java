// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.fixture.libraries;

import io.quarkus.security.Authenticated;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.text.WordUtils;

/** Calls the libraries the extension brings (MK-131): Commons Text, and Commons Lang through it. */
@Path("/api/v1/ext/fixture-libraries/words")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class WordsResource {

    /** A text as the libraries change it. */
    public record Words(String capitalized, String reversed) {}

    @GET
    public Words words(@QueryParam("text") String text) {
        String value = text == null ? "" : text;
        return new Words(WordUtils.capitalizeFully(value), StringUtils.reverse(value));
    }
}

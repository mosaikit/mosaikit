// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.files;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Objects;

/**
 * A signed, expiring link to files of an extension (MK-093): whoever holds it downloads the files it
 * names without a session, with ranges and cache validators, until it expires. The paths are relative
 * to the root of the kernel, such as {@code https://mosaikit.example.org}.
 *
 * @param path the path and query that open the file of a link to a file, or the file named as the
 *     prefix of a link to a prefix
 * @param base the path up to the name of a file: a file under a prefix is at {@code base + name + "?" +
 *     query}, its name encoded as a path
 * @param query the query of the link, with its expiry and signature
 * @param expires when the link stops working
 */
public record SignedLink(String path, String base, String query, Instant expires) {

    public SignedLink {
        Objects.requireNonNull(path, "path");
        Objects.requireNonNull(base, "base");
        Objects.requireNonNull(query, "query");
        Objects.requireNonNull(expires, "expires");
    }

    /** The path and query of the file with this name under a link to a prefix; the name is encoded. */
    public String file(String name) {
        Objects.requireNonNull(name, "name");
        StringBuilder encoded = new StringBuilder();
        for (String segment : name.split("/", -1)) {
            if (!encoded.isEmpty()) {
                encoded.append('/');
            }
            encoded.append(URLEncoder.encode(segment, StandardCharsets.UTF_8).replace("+", "%20"));
        }
        return base + encoded + "?" + query;
    }
}

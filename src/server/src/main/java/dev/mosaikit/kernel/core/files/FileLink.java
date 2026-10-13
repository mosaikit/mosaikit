// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * What a signed link to files grants (MK-093): the files of an extension in an organization, either
 * one file or every file whose name starts with a prefix, until it expires. The link carries its own
 * grant, signed with HMAC-SHA256: nothing is stored, and an altered link no longer matches its
 * signature.
 *
 * <p>A link to a prefix covers the files of the organization ({@code team} absent) or of one team,
 * never both: the scope that the person who made it could read as a whole.
 *
 * <p>A link made by a person carries their account ({@code creator}), and serves only what they still
 * read when it is used: a file attached to a resource (MK-055) only while they hold a level on it, and
 * nothing once they left the organization. A link made without a person, by the code of an extension
 * or of the kernel, has no creator and covers its whole scope.
 *
 * @param file the file of a link to one file, or {@code null}
 * @param prefix the prefix of a link to a prefix, possibly empty for every file, or {@code null}
 * @param team the team of a link to a prefix, or {@code null} for the files of the organization
 * @param expires when the link stops working, to the second
 * @param creator the account of the person who made the link, or {@code null} for one made without a
 *     person
 */
public record FileLink(
        UUID organization, String extension, UUID file, String prefix, UUID team, Instant expires, UUID creator) {

    /** The path under which links are served. */
    public static final String ROOT = "/api/v1/files/signed";

    /** The version of the signed text, so that a later form never verifies against this one. */
    private static final String VERSION = "mosaikit.files.link.v1";

    /** The version of the signed text of a link with a creator. */
    private static final String VERSION_WITH_CREATOR = "mosaikit.files.link.v2";

    private static final String HMAC = "HmacSHA256";

    public FileLink {
        if ((file == null) == (prefix == null)) {
            throw new IllegalArgumentException("A link is to a file or to a prefix");
        }
        if (file != null && team != null) {
            throw new IllegalArgumentException("A link to a file has no team");
        }
    }

    /** A link made without a person. */
    public FileLink(UUID organization, String extension, UUID file, String prefix, UUID team, Instant expires) {
        this(organization, extension, file, prefix, team, expires, null);
    }

    /** The text that is signed: every part of the grant, one per line, none of which has a line break. */
    String signed() {
        String grant = String.join(
                "\n",
                organization.toString(),
                extension,
                file != null ? "file:" + file : "prefix:" + prefix,
                team == null ? "" : team.toString(),
                Long.toString(expires.getEpochSecond()));
        // Without a creator, the text of the first version, so that the links already made still verify.
        return creator == null ? VERSION + "\n" + grant : VERSION_WITH_CREATOR + "\n" + grant + "\ncreator:" + creator;
    }

    /** The signature with a key, in base64url without padding. */
    String signature(byte[] key) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(mac(key));
    }

    /** Whether a signature is that of one of the keys, compared in constant time. */
    boolean verifies(String signature, List<byte[]> keys) {
        byte[] given;
        try {
            given = Base64.getUrlDecoder().decode(signature);
        } catch (IllegalArgumentException _) {
            return false;
        }
        boolean valid = false;
        for (byte[] key : keys) {
            valid |= MessageDigest.isEqual(given, mac(key));
        }
        return valid;
    }

    private byte[] mac(byte[] key) {
        try {
            Mac mac = Mac.getInstance(HMAC);
            mac.init(new SecretKeySpec(key, HMAC));
            return mac.doFinal(signed().getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HMAC-SHA256 is not available", e);
        }
    }

    /**
     * The identifier of the link in the audit log: the start of a digest of its signature, which tells
     * links apart and opens nothing.
     */
    static String id(String signature) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(signature.getBytes(StandardCharsets.US_ASCII));
            return HexFormat.of().formatHex(digest, 0, 8);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    /**
     * The path of the link up to the name of a file: {@code /api/v1/files/signed/<organization>/<extension>/}
     * then the identifier of the file, or {@code named/} then the name of a file under the prefix.
     */
    String base() {
        return ROOT + "/" + organization + "/" + extension + "/" + (file == null ? "named/" : "");
    }

    /** The query of the link, signature included. */
    String query(String signature) {
        Stream.Builder<String> parts = Stream.builder();
        if (prefix != null) {
            parts.add("prefix="
                    + URLEncoder.encode(prefix, StandardCharsets.UTF_8).replace("+", "%20"));
        }
        if (team != null) {
            parts.add("team=" + team);
        }
        parts.add("expires=" + expires.getEpochSecond());
        if (creator != null) {
            parts.add("creator=" + creator);
        }
        parts.add("signature=" + signature);
        return parts.build().collect(Collectors.joining("&"));
    }

    /** The path of a file under the link: its identifier, or its name with each segment encoded. */
    String target() {
        if (file != null) {
            return file.toString();
        }
        return path(prefix);
    }

    /** A name as a path of a URL, each segment encoded. */
    static String path(String name) {
        return Stream.of(name.split("/", -1))
                .map(segment ->
                        URLEncoder.encode(segment, StandardCharsets.UTF_8).replace("+", "%20"))
                .collect(Collectors.joining("/"));
    }
}

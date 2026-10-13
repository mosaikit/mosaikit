// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import jakarta.ws.rs.core.EntityTag;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.StreamingOutput;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Date;
import java.util.Optional;
import java.util.Set;

/**
 * The HTTP answer with the content of a file (MK-041): ranges ({@code Range}, {@code If-Range}) and
 * cache validators ({@code ETag} from the checksum, {@code Last-Modified}, {@code If-None-Match},
 * {@code If-Modified-Since}), streamed from the store. Every way to download a file goes through it,
 * so that they all answer alike.
 *
 * <p>The content of a file is what someone uploaded: it is sent with {@code nosniff} and a sandbox
 * policy, and inline only for types that a browser cannot run, otherwise as an attachment.
 */
public final class FileResponses {

    /** Types shown in the browser; any other is downloaded. */
    static final Set<String> INLINE = Set.of(
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "image/avif",
            "application/pdf",
            "text/plain",
            "text/csv",
            "application/json",
            "audio/mpeg",
            "audio/ogg",
            "audio/wav",
            "video/mp4",
            "video/webm",
            "video/ogg");

    private FileResponses() {}

    /**
     * The answer to a {@code GET} of the content of a file.
     *
     * @param cacheControl the {@code Cache-Control} of the answer, such as {@code private, no-cache}
     */
    public static Response content(FileService.Content content, HttpHeaders headers, String cacheControl) {
        FileView file = content.file();
        Instant modified = file.updatedAt().truncatedTo(ChronoUnit.SECONDS);
        if (notModified(file, modified, headers)) {
            return Response.notModified(new EntityTag(file.checksum()))
                    .lastModified(Date.from(modified))
                    .header(HttpHeaders.CACHE_CONTROL, cacheControl)
                    .build();
        }
        ByteRange.Request range = file.size() == 0 || !rangeApplies(file, modified, headers)
                ? new ByteRange.Whole()
                : ByteRange.parse(headers.getHeaderString("Range"), file.size());
        Response.ResponseBuilder answer;
        switch (range) {
            case ByteRange.Unsatisfiable ignored -> {
                return Response.status(Response.Status.REQUESTED_RANGE_NOT_SATISFIABLE)
                        .header("Content-Range", "bytes */" + file.size())
                        .header("Accept-Ranges", "bytes")
                        .build();
            }
            case ByteRange.Part part ->
                answer = Response.status(Response.Status.PARTIAL_CONTENT)
                        .header("Content-Range", part.range().contentRange(file.size()))
                        .header(HttpHeaders.CONTENT_LENGTH, part.range().length())
                        .entity(stream(content, part.range()));
            case ByteRange.Whole ignored -> {
                answer = Response.ok().header(HttpHeaders.CONTENT_LENGTH, file.size());
                if (file.size() > 0) {
                    answer.entity(stream(content, ByteRange.whole(file.size())));
                }
            }
        }
        return answer.type(file.contentType())
                .tag(new EntityTag(file.checksum()))
                .lastModified(Date.from(modified))
                .header("Accept-Ranges", "bytes")
                .header(HttpHeaders.CACHE_CONTROL, cacheControl)
                .header("Content-Disposition", disposition(file))
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "sandbox; default-src 'none'")
                .build();
    }

    /** {@code inline} for the types a browser shows without running them, {@code attachment} otherwise. */
    static String disposition(FileView file) {
        String type = file.contentType();
        int parameters = type.indexOf(';');
        String bare = parameters < 0 ? type : type.substring(0, parameters).strip();
        String base = file.name().substring(file.name().lastIndexOf('/') + 1);
        String ascii = base.replaceAll("[^\\x20-\\x7e]|[\"\\\\]", "_");
        return (INLINE.contains(bare) ? "inline" : "attachment")
                + "; filename=\"" + ascii + "\"; filename*=UTF-8''"
                + URLEncoder.encode(base, StandardCharsets.UTF_8).replace("+", "%20");
    }

    /**
     * Whether the copy of the client is current: {@code If-None-Match} decides when present,
     * otherwise {@code If-Modified-Since} (RFC 9110, section 13.2.2).
     */
    static boolean notModified(FileView file, Instant modified, HttpHeaders headers) {
        String ifNoneMatch = headers.getHeaderString(HttpHeaders.IF_NONE_MATCH);
        if (ifNoneMatch != null) {
            return Arrays.stream(ifNoneMatch.split(","))
                    .map(String::strip)
                    .map(tag -> tag.startsWith("W/") ? tag.substring(2) : tag)
                    .anyMatch(tag -> tag.equals("*") || tag.equals(file.etag()));
        }
        return date(headers.getHeaderString(HttpHeaders.IF_MODIFIED_SINCE))
                .map(since -> !modified.isAfter(since))
                .orElse(false);
    }

    /** {@code If-Range}: the range is sent only when the copy of the client is the current one. */
    static boolean rangeApplies(FileView file, Instant modified, HttpHeaders headers) {
        String ifRange = headers.getHeaderString("If-Range");
        if (ifRange == null || ifRange.isBlank()) {
            return true;
        }
        String value = ifRange.strip();
        if (value.startsWith("\"")) {
            return value.equals(file.etag());
        }
        return date(value).map(modified::equals).orElse(false);
    }

    private static Optional<Instant> date(String value) {
        if (value == null || value.isBlank()) {
            return Optional.empty();
        }
        try {
            return Optional.of(ZonedDateTime.parse(value.strip(), DateTimeFormatter.RFC_1123_DATE_TIME)
                    .withZoneSameInstant(ZoneOffset.UTC)
                    .toInstant());
        } catch (DateTimeParseException e) {
            return Optional.empty();
        }
    }

    /** The content, opened only when the answer is written, and closed after. */
    private static StreamingOutput stream(FileService.Content content, ByteRange range) {
        return output -> {
            try (InputStream in = content.open(range)) {
                in.transferTo(output);
            }
        };
    }
}

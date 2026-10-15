// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.branding;

import dev.mosaikit.kernel.core.error.InvalidInputException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.MalformedInputException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * The formats of the images of a branding (MK-074), told by their content, not by what the browser
 * declares: PNG, JPEG, WebP, ICO and SVG. An SVG with scripts, event handlers or foreign content is
 * refused: it is shown in an {@code img}, where none would run, but it is a file of the installation.
 */
final class ImageFormats {

    static final String PNG = "image/png";
    static final String JPEG = "image/jpeg";
    static final String WEBP = "image/webp";
    static final String ICO = "image/x-icon";
    static final String SVG = "image/svg+xml";

    private static final byte[] PNG_SIGNATURE = {(byte) 0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a};

    /** The start of an SVG document: an XML declaration, comments and a doctype, then the svg element. */
    private static final Pattern SVG_START = Pattern.compile(
            "^(<\\?xml[^>]*\\?>\\s*)?(<!--.*?-->\\s*)*(<!DOCTYPE[^>]*>\\s*)?(<!--.*?-->\\s*)*<svg[\\s>]",
            Pattern.DOTALL | Pattern.CASE_INSENSITIVE);

    /** What an image has no reason to contain. */
    private static final Pattern SVG_ACTIVE = Pattern.compile(
            "<script|<foreignobject|<iframe|<embed|<object|\\son[a-z]+\\s*=|javascript:", Pattern.CASE_INSENSITIVE);

    private ImageFormats() {}

    /**
     * The media type of an image.
     *
     * @throws InvalidInputException when the content is none of the formats accepted
     */
    static String of(Path content) throws IOException {
        byte[] head = new byte[16];
        int read;
        try (InputStream in = Files.newInputStream(content)) {
            read = in.readNBytes(head, 0, head.length);
        }
        return of(Arrays.copyOf(head, read), () -> Files.readString(content, StandardCharsets.UTF_8));
    }

    /** Reads the whole content as text, for an SVG. */
    @FunctionalInterface
    interface Text {
        String read() throws IOException;
    }

    static String of(byte[] head, Text text) throws IOException {
        if (startsWith(head, PNG_SIGNATURE)) {
            return PNG;
        }
        if (head.length >= 3 && (head[0] & 0xff) == 0xff && (head[1] & 0xff) == 0xd8 && (head[2] & 0xff) == 0xff) {
            return JPEG;
        }
        if (head.length >= 12
                && new String(head, 0, 4, StandardCharsets.US_ASCII).equals("RIFF")
                && new String(head, 8, 4, StandardCharsets.US_ASCII).equals("WEBP")) {
            return WEBP;
        }
        if (startsWith(head, new byte[] {0, 0, 1, 0})) {
            return ICO;
        }
        if (looksLikeText(head)) {
            String svg;
            try {
                svg = text.read();
            } catch (MalformedInputException e) {
                throw notAnImage();
            }
            String start = svg.startsWith("﻿") ? svg.substring(1) : svg;
            if (SVG_START.matcher(start.stripLeading()).find()) {
                if (SVG_ACTIVE.matcher(start).find()) {
                    throw new InvalidInputException(
                            List.of("the SVG image has scripts, event handlers or embedded content, which an image"
                                    + " does not need"));
                }
                return SVG;
            }
        }
        throw notAnImage();
    }

    private static boolean looksLikeText(byte[] head) {
        String text = new String(head, StandardCharsets.UTF_8)
                .toLowerCase(Locale.ROOT)
                .replace("﻿", "");
        return text.stripLeading().startsWith("<");
    }

    private static boolean startsWith(byte[] content, byte[] prefix) {
        return content.length >= prefix.length && Arrays.equals(content, 0, prefix.length, prefix, 0, prefix.length);
    }

    private static InvalidInputException notAnImage() {
        return new InvalidInputException(List.of("the image must be a PNG, JPEG, WebP, ICO or SVG file"));
    }
}

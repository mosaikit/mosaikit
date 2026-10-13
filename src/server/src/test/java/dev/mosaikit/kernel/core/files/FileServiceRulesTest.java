// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.core.error.InvalidInputException;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The names and types of files, and how they are sent to a browser (MK-041). */
@Tag("MK-041")
class FileServiceRulesTest {

    @Test
    void acceptsNamesAndPathsAndRefusesTheOthers() {
        assertThat(FileService.name("  Plan B.pdf ")).isEqualTo("Plan B.pdf");
        assertThat(FileService.name("tiles/3/4/2.png")).isEqualTo("tiles/3/4/2.png");
        assertThat(FileService.name("città.txt")).isEqualTo("città.txt");
        for (String name : new String[] {
            null, "", "  ", "a".repeat(256), "../x", "a/./b", "a//b", "/a", "a/", "a\\b", "a\u0000b", "a\nb"
        }) {
            assertThatThrownBy(() -> FileService.name(name))
                    .as(String.valueOf(name))
                    .isInstanceOf(InvalidInputException.class);
        }
    }

    @Test
    void acceptsMediaTypes() {
        assertThat(FileService.contentType(null)).isEqualTo("application/octet-stream");
        assertThat(FileService.contentType(" ")).isEqualTo("application/octet-stream");
        assertThat(FileService.contentType("Image/PNG")).isEqualTo("image/png");
        assertThat(FileService.contentType("text/plain; charset=UTF-8")).isEqualTo("text/plain; charset=UTF-8");
        assertThat(FileService.contentType("application/vnd.geo+json")).isEqualTo("application/vnd.geo+json");
        for (String type : new String[] {"png", "image/", "/png", "image png", "a/b/c", "x/" + "y".repeat(300)}) {
            assertThatThrownBy(() -> FileService.contentType(type)).as(type).isInstanceOf(InvalidInputException.class);
        }
    }

    private static FileView file(String name, String type) {
        Instant now = Instant.now();
        return new FileView(UUID.randomUUID(), "x.y", name, type, 1, "ab", null, null, null, now, now);
    }

    @Test
    void showsInlineOnlyWhatABrowserDoesNotRun() {
        assertThat(FileResponses.disposition(file("maps/rome.png", "image/png")))
                .isEqualTo("inline; filename=\"rome.png\"; filename*=UTF-8''rome.png");
        assertThat(FileResponses.disposition(file("note.txt", "text/plain; charset=utf-8")))
                .startsWith("inline;");
        assertThat(FileResponses.disposition(file("page.html", "text/html"))).startsWith("attachment;");
        assertThat(FileResponses.disposition(file("logo.svg", "image/svg+xml"))).startsWith("attachment;");
        assertThat(FileResponses.disposition(file("città \"vecchia\".pdf", "application/pdf")))
                .isEqualTo("inline; filename=\"citt_ _vecchia_.pdf\"; filename*=UTF-8''citt%C3%A0%20%22vecchia%22.pdf");
    }
}

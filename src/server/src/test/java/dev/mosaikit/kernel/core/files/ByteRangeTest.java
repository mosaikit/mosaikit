// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The {@code Range} header of a download of a file (MK-041). */
@Tag("MK-041")
class ByteRangeTest {

    private static ByteRange.Request parse(String header) {
        return ByteRange.parse(header, 100);
    }

    private static ByteRange.Request part(long first, long last) {
        return new ByteRange.Part(new ByteRange(first, last));
    }

    @Test
    void readsOneRangeOfBytes() {
        assertThat(parse("bytes=0-9")).isEqualTo(part(0, 9));
        assertThat(parse("bytes=90-")).isEqualTo(part(90, 99));
        assertThat(parse("bytes=-10")).isEqualTo(part(90, 99));
        assertThat(parse("bytes=-1000")).isEqualTo(part(0, 99));
        assertThat(parse("bytes=50-1000")).isEqualTo(part(50, 99));
        assertThat(parse(" bytes=99-99 ")).isEqualTo(part(99, 99));
        assertThat(((ByteRange.Part) parse("bytes=10-19")).range().contentRange(100))
                .isEqualTo("bytes 10-19/100");
        assertThat(((ByteRange.Part) parse("bytes=10-19")).range().length()).isEqualTo(10);
    }

    @Test
    void sendsTheWholeFileForWhatItDoesNotServe() {
        assertThat(parse(null)).isInstanceOf(ByteRange.Whole.class);
        assertThat(parse("")).isInstanceOf(ByteRange.Whole.class);
        assertThat(parse("bytes=0-1,5-6")).isInstanceOf(ByteRange.Whole.class);
        assertThat(parse("items=0-1")).isInstanceOf(ByteRange.Whole.class);
        assertThat(parse("bytes=-")).isInstanceOf(ByteRange.Whole.class);
        assertThat(parse("bytes=9-3")).isInstanceOf(ByteRange.Whole.class);
    }

    @Test
    void refusesARangeTheFileDoesNotHave() {
        assertThat(parse("bytes=100-")).isInstanceOf(ByteRange.Unsatisfiable.class);
        assertThat(parse("bytes=99999999999999999999-")).isInstanceOf(ByteRange.Unsatisfiable.class);
        assertThat(parse("bytes=-0")).isInstanceOf(ByteRange.Unsatisfiable.class);
        assertThat(ByteRange.parse("bytes=-5", 0)).isInstanceOf(ByteRange.Unsatisfiable.class);
        assertThatThrownBy(() -> new ByteRange(5, 4)).isInstanceOf(IllegalArgumentException.class);
    }
}

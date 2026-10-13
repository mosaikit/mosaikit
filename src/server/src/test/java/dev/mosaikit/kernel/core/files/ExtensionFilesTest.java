// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.ContentTooLargeException;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.NoSuchElementException;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The failures of the file service as the exceptions of the Java API of extensions (MK-041). */
@Tag("MK-041")
class ExtensionFilesTest {

    @Test
    void givesTheFailuresOfTheServiceAsTheExceptionsOfTheApi() {
        assertThat(ExtensionFiles.translated(new ResourceNotFoundException("No file 1.")))
                .isInstanceOf(NoSuchElementException.class)
                .hasMessage("No file 1.");
        assertThat(ExtensionFiles.translated(new InvalidInputException(List.of("name is wrong"))))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(ExtensionFiles.translated(new ContentTooLargeException("Too large.")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(ExtensionFiles.translated(new ForbiddenOperationException("No.")))
                .isInstanceOf(SecurityException.class);
        assertThat(ExtensionFiles.translated(new ServiceUnavailableException("Later.")))
                .isInstanceOf(UncheckedIOException.class);
        assertThat(ExtensionFiles.translated(new ConflictException("Changed.")))
                .isInstanceOf(IllegalStateException.class);
    }
}

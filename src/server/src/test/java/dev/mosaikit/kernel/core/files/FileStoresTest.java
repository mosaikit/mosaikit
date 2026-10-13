// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.core.config.KernelConfig;
import io.quarkus.runtime.configuration.MemorySize;
import java.math.BigInteger;
import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The store that {@code mosaikit.files.*} chooses, and what it says of itself (MK-041). */
@Tag("MK-041")
class FileStoresTest {

    static final String SECRET = "a-secret-that-must-never-be-logged";

    private static KernelConfig.Files files(KernelConfig.Files.Store kind, Optional<String> bucket) {
        KernelConfig.Files.S3 s3 = new KernelConfig.Files.S3() {
            @Override
            public Optional<URI> endpoint() {
                return Optional.of(URI.create("https://s3.example.org"));
            }

            @Override
            public String region() {
                return "eu-south-1";
            }

            @Override
            public Optional<String> bucket() {
                return bucket;
            }

            @Override
            public boolean pathStyle() {
                return true;
            }

            @Override
            public Optional<String> accessKeyId() {
                return Optional.of("ACME-KEY");
            }

            @Override
            public Optional<String> secretAccessKey() {
                return Optional.of(SECRET);
            }
        };
        return new KernelConfig.Files() {
            @Override
            public Store store() {
                return kind;
            }

            @Override
            public Path directory() {
                return Path.of("target", "files-of-the-test");
            }

            @Override
            public MemorySize maxSize() {
                return new MemorySize(BigInteger.valueOf(1024));
            }

            @Override
            public Duration linkMaxValidity() {
                return Duration.ofDays(7);
            }

            @Override
            public Optional<String> linkKey() {
                return Optional.empty();
            }

            @Override
            public Optional<List<String>> linkPreviousKeys() {
                return Optional.empty();
            }

            @Override
            public S3 s3() {
                return s3;
            }
        };
    }

    @Test
    void choosesTheStoreOfTheConfiguration() {
        assertThat(FileStores.of(files(KernelConfig.Files.Store.FILESYSTEM, Optional.empty())))
                .isInstanceOf(FilesystemFileStore.class);
        FileStore s3 = FileStores.of(files(KernelConfig.Files.Store.S3, Optional.of("acme-files")));
        assertThat(s3).isInstanceOf(S3FileStore.class);
        assertThat(s3.describe())
                .contains("acme-files", "https://s3.example.org")
                .doesNotContain(SECRET)
                .doesNotContain("ACME-KEY");
        ((S3FileStore) s3).close();
    }

    @Test
    void anS3StoreNeedsABucket() {
        assertThatThrownBy(() -> FileStores.of(files(KernelConfig.Files.Store.S3, Optional.empty())))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("mosaikit.files.s3.bucket");
        assertThatThrownBy(() -> FileStores.of(files(KernelConfig.Files.Store.S3, Optional.of(" "))))
                .isInstanceOf(IllegalStateException.class);
    }
}

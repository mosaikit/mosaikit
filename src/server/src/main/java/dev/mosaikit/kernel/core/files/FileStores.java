// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import dev.mosaikit.kernel.core.config.KernelConfig;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.enterprise.inject.Disposes;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Singleton;
import java.io.IOException;
import org.jboss.logging.Logger;

/** Makes the store of files that {@code mosaikit.files.store} names (MK-041). */
@ApplicationScoped
public class FileStores {

    private static final Logger LOG = Logger.getLogger(FileStores.class);

    @Produces
    @Singleton
    FileStore store(KernelConfig config) {
        return of(config.files());
    }

    void close(@Disposes FileStore store) {
        if (store instanceof S3FileStore s3) {
            s3.close();
        }
    }

    /** Says at start where the files are, and whether a bucket can be reached. */
    void onStart(@Observes StartupEvent event, FileStore store) {
        LOG.infof("Files of extensions are kept in %s", store.describe());
        if (store instanceof S3FileStore s3) {
            try {
                s3.check();
            } catch (IOException e) {
                LOG.warnf("The store of files cannot be used yet: %s", e.getMessage());
            }
        }
    }

    /**
     * The store of a configuration.
     *
     * @throws IllegalStateException when the {@code s3} store has no bucket
     */
    static FileStore of(KernelConfig.Files files) {
        return switch (files.store()) {
            case FILESYSTEM -> new FilesystemFileStore(files.directory());
            case S3 -> {
                KernelConfig.Files.S3 s3 = files.s3();
                String bucket = s3.bucket()
                        .filter(name -> !name.isBlank())
                        .orElseThrow(() -> new IllegalStateException(
                                "mosaikit.files.store=s3 needs the bucket in mosaikit.files.s3.bucket"));
                yield new S3FileStore(new S3FileStore.Settings(
                        s3.endpoint(),
                        s3.region(),
                        bucket,
                        s3.pathStyle(),
                        s3.accessKeyId().filter(key -> !key.isBlank()),
                        s3.secretAccessKey().filter(secret -> !secret.isBlank())));
            }
        };
    }
}

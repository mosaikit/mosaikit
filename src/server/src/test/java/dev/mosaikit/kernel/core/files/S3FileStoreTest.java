// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;

/**
 * The store of files in an S3-compatible bucket (MK-041), against MinIO in a container: needs Docker,
 * so it is tagged {@code docker} and runs with {@code -Dtest.groups.excluded=} (the nightly CI).
 * {@code -Dit.minio.image} chooses another image.
 */
@Tag("MK-041")
@Tag("docker")
class S3FileStoreTest {

    static final String USER = "mosaikit-test";
    static final String SECRET = "a-secret-that-must-never-be-logged";
    static final String BUCKET = "mosaikit-files";

    static GenericContainer<?> minio;
    static URI endpoint;

    @TempDir
    Path uploads;

    @BeforeAll
    @SuppressWarnings("resource")
    static void start() {
        minio = new GenericContainer<>(
                        System.getProperty(
                                "it.minio.image",
                                "cgr.dev/chainguard/minio@sha256:dc455cdd4db6e390b1b26514f15ff37681a777bf8dab41aac445a0259f751e56"))
                .withCommand("server", "/tmp/data")
                .withEnv("MINIO_ROOT_USER", USER)
                .withEnv("MINIO_ROOT_PASSWORD", SECRET)
                .withExposedPorts(9000)
                .waitingFor(Wait.forHttp("/minio/health/ready").forPort(9000));
        minio.start();
        endpoint = URI.create("http://" + minio.getHost() + ":" + minio.getMappedPort(9000));
        try (S3Client admin = S3Client.builder()
                .endpointOverride(endpoint)
                .region(Region.US_EAST_1)
                .forcePathStyle(true)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(USER, SECRET)))
                .httpClient(software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient.create())
                .build()) {
            admin.createBucket(request -> request.bucket(BUCKET));
        }
    }

    @AfterAll
    static void stop() {
        if (minio != null) {
            minio.stop();
        }
    }

    private static S3FileStore store(String secret, String bucket) {
        return new S3FileStore(new S3FileStore.Settings(
                Optional.of(endpoint), "us-east-1", bucket, true, Optional.of(USER), Optional.of(secret)));
    }

    private static String read(InputStream in) throws IOException {
        try (in) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    void storesReadsByRangeAndDeletesWithoutLoggingTheCredentials() throws Exception {
        List<String> logged = new CopyOnWriteArrayList<>();
        Handler capture = new Handler() {
            @Override
            public void publish(LogRecord entry) {
                logged.add(entry.getMessage() + " " + String.valueOf(entry.getThrown()));
            }

            @Override
            public void flush() {}

            @Override
            public void close() {}
        };
        Logger root = Logger.getLogger("");
        Logger client = Logger.getLogger("software.amazon.awssdk");
        Level before = client.getLevel();
        root.addHandler(capture);
        client.setLevel(Level.ALL);
        try (S3FileStore store = store(SECRET, BUCKET)) {
            store.check();
            String key = FileStore.key(UUID.randomUUID(), "dev.mosaikit.test.files", UUID.randomUUID());
            Path content = Files.writeString(uploads.resolve("upload.bin"), "0123456789");

            store.put(key, content, 10, "text/plain");

            assertThat(read(store.read(key, 0, 10))).isEqualTo("0123456789");
            assertThat(read(store.read(key, 3, 4))).isEqualTo("3456");
            store.delete(key);
            assertThatThrownBy(() -> store.read(key, 0, 1)).isInstanceOf(NoSuchFileException.class);
            assertThat(store.describe()).contains(BUCKET).doesNotContain(SECRET);

            // Failures say what failed, never with what.
            try (S3FileStore missing = store(SECRET, "no-such-bucket")) {
                assertThatThrownBy(missing::check)
                        .isInstanceOf(IOException.class)
                        .hasMessageContaining("no-such-bucket")
                        .hasMessageNotContaining(SECRET);
            }
            try (S3FileStore wrong = store("not-the-secret", BUCKET)) {
                assertThatThrownBy(() -> wrong.put(key, content, 10, "text/plain"))
                        .isInstanceOf(IOException.class)
                        .hasMessageNotContaining("not-the-secret");
            }
        } finally {
            root.removeHandler(capture);
            client.setLevel(before);
        }
        assertThat(logged).isNotEmpty().noneMatch(line -> line.contains(SECRET));
    }
}

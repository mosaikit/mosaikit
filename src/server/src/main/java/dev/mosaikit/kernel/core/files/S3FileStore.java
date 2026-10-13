// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.util.Optional;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.checksums.ResponseChecksumValidation;
import software.amazon.awssdk.core.exception.SdkException;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3ClientBuilder;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;

/**
 * Files in a bucket of an S3-compatible object store (MK-041, ADR-0029): Amazon S3, or a store on
 * premises such as MinIO, Ceph or Garage. The credentials go to the client and nowhere else: neither
 * {@link #describe()} nor the messages of the errors carry them.
 */
public class S3FileStore implements FileStore, AutoCloseable {

    /** How to reach the store. */
    public record Settings(
            Optional<URI> endpoint,
            String region,
            String bucket,
            boolean pathStyle,
            Optional<String> accessKeyId,
            Optional<String> secretAccessKey) {

        /** Without the secret, should a record ever be printed. */
        @Override
        public String toString() {
            return "S3 bucket " + bucket + " at " + endpoint.map(URI::toString).orElse("Amazon S3 " + region);
        }
    }

    private final S3Client client;
    private final Settings settings;

    public S3FileStore(Settings settings) {
        this.settings = settings;
        S3ClientBuilder builder = S3Client.builder()
                .httpClient(UrlConnectionHttpClient.create())
                .region(Region.of(settings.region()))
                .forcePathStyle(settings.pathStyle())
                .credentialsProvider(credentials(settings))
                // Checksums only when an operation needs one: several S3-compatible stores refuse
                // the trailing checksums that the client sends by default.
                .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED)
                .responseChecksumValidation(ResponseChecksumValidation.WHEN_REQUIRED);
        settings.endpoint().ifPresent(builder::endpointOverride);
        this.client = builder.build();
    }

    private static AwsCredentialsProvider credentials(Settings settings) {
        if (settings.accessKeyId().isPresent() && settings.secretAccessKey().isPresent()) {
            return StaticCredentialsProvider.create(AwsBasicCredentials.create(
                    settings.accessKeyId().get(), settings.secretAccessKey().get()));
        }
        return DefaultCredentialsProvider.builder().build();
    }

    @Override
    public String describe() {
        return "the " + settings;
    }

    /**
     * Whether the bucket can be reached with the credentials, for the check at start.
     *
     * @throws IOException when it cannot, with the reason given by the store
     */
    public void check() throws IOException {
        try {
            client.headBucket(request -> request.bucket(settings.bucket()));
        } catch (SdkException e) {
            throw failure("reach", settings.bucket(), e);
        }
    }

    @Override
    public void put(String key, Path content, long size, String contentType) throws IOException {
        try {
            client.putObject(
                    request -> request.bucket(settings.bucket())
                            .key(key)
                            .contentLength(size)
                            .contentType(contentType),
                    RequestBody.fromFile(content));
        } catch (SdkException e) {
            throw failure("store", key, e);
        }
    }

    @Override
    public InputStream read(String key, long offset, long length) throws IOException {
        try {
            return client.getObject(request ->
                    request.bucket(settings.bucket()).key(key).range("bytes=" + offset + "-" + (offset + length - 1)));
        } catch (NoSuchKeyException e) {
            throw new NoSuchFileException(key);
        } catch (SdkException e) {
            throw failure("read", key, e);
        }
    }

    @Override
    public void delete(String key) throws IOException {
        try {
            client.deleteObject(request -> request.bucket(settings.bucket()).key(key));
        } catch (SdkException e) {
            throw failure("delete", key, e);
        }
    }

    @Override
    public void close() {
        client.close();
    }

    /*
     * The message of the store, never the request: the client does not put credentials in its
     * messages, and the signature of a request is not one of them.
     */
    private IOException failure(String action, String what, SdkException e) {
        return new IOException("Cannot " + action + " " + what + " in " + describe() + ": " + e.getMessage(), e);
    }
}

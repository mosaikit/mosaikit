// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Files stored and deleted by an extension inside its own transaction (MK-041, #93): the store joins
 * it, and a transaction that an earlier step of the extension marked for rollback gets a clear
 * refusal, with nothing left in the store, instead of a failure of the transaction manager; the
 * requests that follow work.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-041")
class FilesInTransactionTest {

    static final String EXTENSION = FileStorageTest.EXTENSION;
    static final String PROBE = "/api/v1/test/files/" + EXTENSION;
    static final String PASSWORD = FileStorageTest.PASSWORD;

    private String acme;
    private String ada;

    @BeforeEach
    void people() {
        acme = unique("files-tx");
        asAdmin()
                .body(Map.of("slug", acme, "name", acme, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        ada = unique("files-tx") + "@example.org";
        anonymous()
                .body(Map.of("organization", acme, "email", ada, "displayName", "Ada", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
    }

    private RequestSpecification ada() {
        return as(ada, PASSWORD).header("X-Mosaikit-Organization", acme);
    }

    private String storeInTransaction(String name) {
        return ada().contentType("text/plain")
                .body("Rome".getBytes(StandardCharsets.UTF_8))
                .post(PROBE + "/in-transaction?name=" + name)
                .then()
                .statusCode(200)
                .extract()
                .path("id");
    }

    private Path directory() {
        String organizationId =
                asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");
        return Path.of("target", "files", organizationId, EXTENSION);
    }

    private long storedFiles() throws IOException {
        Path directory = directory();
        if (!Files.isDirectory(directory)) {
            return 0;
        }
        try (Stream<Path> files = Files.list(directory)) {
            return files.count();
        }
    }

    @Test
    void aFileIsStoredInTheTransactionOfTheExtension() {
        String id = storeInTransaction("rome.txt");
        ada().get(PROBE + "/" + id).then().statusCode(200).body("content", equalTo("Rome"));
        assertThat(directory().resolve(id)).hasContent("Rome");
    }

    @Test
    void aTransactionMarkedForRollbackIsRefusedClearlyAndTheNextRequestsWork() throws IOException {
        storeInTransaction("before.txt");
        long before = storedFiles();

        ada().contentType("text/plain")
                .body("lost".getBytes(StandardCharsets.UTF_8))
                .post(PROBE + "/in-transaction?name=lost.txt&failed=true")
                .then()
                .statusCode(409)
                .body(
                        "[0]",
                        equalTo("The transaction of the caller can no longer commit (an earlier step failed,"
                                + " or it timed out): the file is not stored."));
        assertThat(storedFiles()).isEqualTo(before);
        ada().get(PROBE).then().statusCode(200).body("name", not(hasItem("lost.txt")));

        // Nothing stays behind on the server: the following requests store files as before.
        storeInTransaction("after.txt");
        storeInTransaction("again.txt");
        ada().get(PROBE).then().statusCode(200).body("name", hasItem("again.txt"));
    }

    @Test
    void aDeletionInATransactionMarkedForRollbackKeepsTheFileAndItsContent() {
        String id = storeInTransaction("kept.txt");

        ada().delete(PROBE + "/" + id + "/in-failed-transaction").then().statusCode(204);

        ada().get(PROBE + "/" + id).then().statusCode(200).body("content", equalTo("Rome"));
        assertThat(directory().resolve(id)).hasContent("Rome");
    }
}

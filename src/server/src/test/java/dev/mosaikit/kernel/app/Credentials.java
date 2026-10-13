// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static io.restassured.RestAssured.given;

import io.restassured.http.ContentType;
import io.restassured.specification.RequestSpecification;

/** Request specifications shared by the integration tests. */
final class Credentials {

    static final String ADMIN = "admin";
    static final String ADMIN_PASSWORD = "test-admin-password";

    private Credentials() {}

    static RequestSpecification asAdmin() {
        return given().auth().preemptive().basic(ADMIN, ADMIN_PASSWORD).contentType(ContentType.JSON);
    }

    static RequestSpecification as(String username, String password) {
        return given().auth().preemptive().basic(username, password).contentType(ContentType.JSON);
    }

    static RequestSpecification anonymous() {
        return given().contentType(ContentType.JSON);
    }
}

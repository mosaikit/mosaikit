// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;

import io.quarkus.test.junit.QuarkusTest;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The personal settings of a person, kept for the next sign-in. */
@QuarkusTest
@Tag("MK-027")
class PreferencesTest {

    private static final String PASSWORD = "a long enough password";

    private static String person() {
        asAdmin()
                .body(Map.of("slug", "prefs-town", "name", "Prefs Town", "selfRegistration", true))
                .post("/api/v1/organizations");
        String email = unique("prefs") + "@example.org";
        anonymous()
                .body(Map.of("organization", "prefs-town", "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    @Test
    void keepsTheSettingsOfThePerson() {
        String email = person();
        as(email, PASSWORD)
                .get("/api/v1/accounts/me/preferences")
                .then()
                .statusCode(200)
                .body("theme", nullValue())
                .body("hiddenApps", hasSize(0));

        as(email, PASSWORD)
                .body(Map.of(
                        "theme", "pa",
                        "appearance", "contrast",
                        "language", "it",
                        "hiddenApps", List.of("dev.mosaikit.sample.notes/notes")))
                .put("/api/v1/accounts/me/preferences")
                .then()
                .statusCode(200)
                .body("appearance", equalTo("contrast"));

        // At the next sign-in the shell finds them with the account.
        as(email, PASSWORD)
                .get("/api/v1/accounts/me")
                .then()
                .body("preferences.theme", equalTo("pa"))
                .body("preferences.language", equalTo("it"))
                .body("preferences.hiddenApps", contains("dev.mosaikit.sample.notes/notes"));
    }

    @Test
    void refusesValuesThatTheShellDoesNotKnow() {
        String email = person();
        for (Map<String, Object> wrong : List.<Map<String, Object>>of(
                Map.of("appearance", "neon"),
                Map.of("language", "klingon"),
                Map.of("theme", "Not A Theme!"),
                Map.of("hiddenApps", List.of("../etc")))) {
            int status = as(email, PASSWORD)
                    .body(wrong)
                    .put("/api/v1/accounts/me/preferences")
                    .statusCode();
            assertThat(status).as("%s", wrong).isEqualTo(400);
        }
        anonymous().get("/api/v1/accounts/me/preferences").then().statusCode(401);
    }
}

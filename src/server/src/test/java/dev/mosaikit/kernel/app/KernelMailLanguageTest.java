// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;

import io.quarkus.mailer.Mail;
import io.quarkus.mailer.MockMailbox;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The mails of the kernel in the language of the person, else of the installation (#95), here an
 * installation in Italian: the confirmation mail and the mail that sets a password.
 */
@QuarkusTest
@TestProfile(KernelMailLanguageTest.Italian.class)
@Tag("MK-048")
class KernelMailLanguageTest {

    static final String PASSWORD = "a long enough password";

    /** An installation in Italian that confirms addresses by mail. */
    public static class Italian implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of("mosaikit.accounts.confirm-email", "true", "mosaikit.language", "it");
        }
    }

    @Inject
    MockMailbox mailbox;

    private String town;

    @BeforeEach
    void open() {
        asAdmin()
                .body(Map.of("registration", true))
                .put("/api/v1/platform/settings")
                .then()
                .statusCode(200);
        town = unique("lingua");
        asAdmin()
                .body(Map.of("slug", town, "name", "Comune " + town, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        mailbox.clear();
    }

    private Mail registered(String acceptLanguage) {
        String email = unique("lingua") + "@example.org";
        var request = anonymous();
        if (acceptLanguage != null) {
            request = request.header("Accept-Language", acceptLanguage);
        }
        request.body(Map.of("organization", town, "email", email, "displayName", "Luigi", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(202);
        List<Mail> mails = mailbox.getMailsSentTo(email);
        assertThat(mails).hasSize(1);
        return mails.getFirst();
    }

    @Test
    void aPersonWhoRegistersInEnglishGetsTheMailInEnglish() {
        Mail mail = registered("en-GB,en;q=0.9");
        assertThat(mail.getSubject()).isEqualTo("Confirm your email address");
        assertThat(mail.getText()).startsWith("Hello Luigi,").contains("/?confirm=");
    }

    @Test
    void aPersonInALanguageTheKernelDoesNotWriteGetsTheLanguageOfTheInstallation() {
        for (String language : new String[] {"fr-FR,de;q=0.8", null}) {
            Mail mail = registered(language);
            assertThat(mail.getSubject()).isEqualTo("Conferma il tuo indirizzo email");
            assertThat(mail.getText())
                    .startsWith("Ciao Luigi,")
                    .contains("/?confirm=")
                    .contains("ore");
            assertThat(mail.getHtml()).contains("Conferma il mio indirizzo email");
        }
    }

    @Test
    void theLinkAskedForAgainFollowsTheLanguageOfTheRequest() {
        Mail first = registered("it-IT");
        String email = first.getTo().getFirst();
        mailbox.clear();
        anonymous()
                .header("Accept-Language", "en")
                .body(Map.of("email", email))
                .post("/api/v1/accounts/confirmations/requests")
                .then()
                .statusCode(202);
        assertThat(mailbox.getMailsSentTo(email).getLast().getSubject()).isEqualTo("Confirm your email address");
    }

    @Test
    void theMailThatSetsAPasswordIsNotInTheLanguageOfTheAdministratorButOfTheInstallation() {
        String email = unique("lingua") + "@example.org";
        asAdmin()
                .header("Accept-Language", "en")
                .body(Map.of("email", email, "displayName", "Maria Rossi", "roles", List.of("organization-user")))
                .post("/api/v1/organizations/{slug}/accounts", town)
                .then()
                .statusCode(201);
        Mail mail = mailbox.getMailsSentTo(email).getLast();
        assertThat(mail.getSubject()).isEqualTo("Scegli la password del tuo account");
        assertThat(mail.getText())
                .startsWith("Ciao Maria Rossi,")
                .contains("Comune " + town)
                .contains("/?set-password=");
        assertThat(mail.getHtml()).contains("Scegli la mia password");
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The language of a mail of the kernel (#95): the one the person chose, else the one they ask in,
 * else the one of the installation.
 */
@Tag("MK-048")
class MailLanguageTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static UserAccount person(String preferences) {
        UserAccount account = UserAccount.withoutPassword("ada@example.org", "Ada", Instant.EPOCH);
        account.setPreferences(preferences);
        return account;
    }

    @Test
    void theLanguageThePersonChoseComesFirst() {
        MailLanguage languages = new MailLanguage(JSON, "en");
        assertThat(languages.of(person("{\"language\":\"it\"}"), List.of(Locale.ENGLISH)))
                .isEqualTo("it");
        assertThat(languages.of(person("{\"language\":\"en\"}"), List.of(Locale.ITALIAN)))
                .isEqualTo("en");
    }

    @Test
    void thenTheFirstLanguageOfTheirRequestThatTheKernelWrites() {
        MailLanguage languages = new MailLanguage(JSON, "en");
        assertThat(languages.of(person("{}"), List.of(Locale.FRENCH, Locale.forLanguageTag("it-IT"), Locale.ENGLISH)))
                .isEqualTo("it");
        assertThat(languages.of(person("{\"theme\":\"pa\"}"), List.of(Locale.forLanguageTag("en-GB"))))
                .isEqualTo("en");
    }

    @Test
    void thenTheLanguageOfTheInstallation() {
        MailLanguage italian = new MailLanguage(JSON, "it");
        assertThat(italian.installation()).isEqualTo("it");
        assertThat(italian.of(person("{}"), List.of())).isEqualTo("it");
        assertThat(italian.of(person("{}"), List.of(Locale.GERMAN, Locale.forLanguageTag("*"))))
                .isEqualTo("it");
        // Preferences written by an older version, or a language the kernel does not write.
        assertThat(italian.of(person("not json"), List.of())).isEqualTo("it");
        assertThat(italian.of(person("{\"language\":\"fr\"}"), List.of())).isEqualTo("it");
    }

    @Test
    void anInstallationLanguageTheKernelDoesNotWriteIsEnglish() {
        assertThat(new MailLanguage(JSON, "fr").installation()).isEqualTo("en");
        assertThat(new MailLanguage(JSON, " IT ").installation()).isEqualTo("it");
    }
}

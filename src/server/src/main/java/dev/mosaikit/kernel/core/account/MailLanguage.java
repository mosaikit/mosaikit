// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.config.KernelConfig;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import org.jboss.logging.Logger;

/**
 * The language of a mail of the kernel to a person (#95): the one they chose in their settings
 * (MK-027); else, when they ask themselves, as when they register, the first language of their
 * request ({@code Accept-Language}) that the kernel writes; else the language of the installation,
 * {@code mosaikit.language}.
 */
@ApplicationScoped
public class MailLanguage {

    private static final Logger LOG = Logger.getLogger(MailLanguage.class);

    /** The languages of the mails of the kernel, as those of the shell. */
    static final Set<String> SUPPORTED = Set.of("en", "it");

    static final String DEFAULT = "en";

    private final ObjectMapper json;
    private final String installation;

    @Inject
    public MailLanguage(ObjectMapper json, KernelConfig config) {
        this(json, config.language());
    }

    MailLanguage(ObjectMapper json, String installation) {
        this.json = json;
        this.installation = supported(installation).orElseGet(() -> {
            LOG.warnf(
                    "mosaikit.language=%s is not a language of the kernel (%s): mails are in English",
                    installation, SUPPORTED);
            return DEFAULT;
        });
    }

    /** The language of the installation. */
    public String installation() {
        return installation;
    }

    /**
     * The language of a mail to a person.
     *
     * @param asked the languages of the request of the person themselves, best first; empty when
     *     someone else asks, such as an administrator who creates their account
     */
    public String of(UserAccount account, List<Locale> asked) {
        return chosen(account)
                .or(() -> asked.stream()
                        .map(Locale::getLanguage)
                        .map(MailLanguage::supported)
                        .flatMap(Optional::stream)
                        .findFirst())
                .orElse(installation);
    }

    private Optional<String> chosen(UserAccount account) {
        String preferences = account.getPreferences();
        if (preferences == null || preferences.isBlank()) {
            return Optional.empty();
        }
        try {
            return supported(json.readTree(preferences).path("language").asText(""));
        } catch (JsonProcessingException e) {
            return Optional.empty();
        }
    }

    static Optional<String> supported(String language) {
        if (language == null) {
            return Optional.empty();
        }
        String code = language.strip().toLowerCase(Locale.ROOT);
        return SUPPORTED.contains(code) ? Optional.of(code) : Optional.empty();
    }
}

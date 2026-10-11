// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import io.quarkus.mailer.Mail;
import io.quarkus.mailer.Mailer;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.net.URI;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;
import org.jboss.logging.Logger;

/**
 * Confirms the address of self-registered people: a link with a random token goes to the address,
 * valid for {@code mosaikit.accounts.confirmation-valid-for}; opening it confirms the account. The
 * database keeps only the SHA-256 digest of the token, and a new link replaces the previous ones.
 */
@ApplicationScoped
@Transactional
public class ConfirmationMail {

    private static final Logger LOG = Logger.getLogger(ConfirmationMail.class);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final EmailConfirmations confirmations;
    private final UserAccounts accounts;
    private final Mailer mailer;
    private final Duration validFor;
    private final Optional<URI> publicUrl;
    private final Clock clock;

    @Inject
    public ConfirmationMail(
            EmailConfirmations confirmations, UserAccounts accounts, Mailer mailer, KernelConfig config, Clock clock) {
        this.confirmations = confirmations;
        this.accounts = accounts;
        this.mailer = mailer;
        this.validFor = config.accounts().confirmationValidFor();
        this.publicUrl = config.publicUrl();
        this.clock = clock;
    }

    /**
     * Sends a new link to the address of an account that is not confirmed yet.
     *
     * @param base the address of the installation, used when {@code mosaikit.public-url} is not set
     */
    public void send(UserAccount account, URI base) {
        Instant now = Instant.now(clock);
        confirmations.deleteByAccountId(account.getId());
        byte[] random = new byte[32];
        RANDOM.nextBytes(random);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        confirmations.insert(new EmailConfirmation(account.getId(), RememberMe.digest(token), now, now.plus(validFor)));
        String link = publicUrl.orElse(base).resolve("/?confirm=" + token).toString();
        long hours = validFor.toHours();
        String text = """
                Hello %s,

                to finish creating your account, confirm your email address by opening this link:

                %s

                The link works for %d hours. If you did not ask for an account, ignore this message.
                """.formatted(account.getDisplayName(), link, hours);
        String html = """
                <p>Hello %s,</p>
                <p>to finish creating your account, confirm your email address:</p>
                <p><a href="%s">Confirm my email address</a></p>
                <p>The link works for %d hours. If you did not ask for an account, ignore this message.</p>
                """.formatted(escape(account.getDisplayName()), link, hours);
        try {
            mailer.send(Mail.withText(account.getUsername(), "Confirm your email address", text)
                    .setHtml(html));
        } catch (RuntimeException e) {
            LOG.warnf("The confirmation mail to %s could not be sent: %s", account.getUsername(), e.getMessage());
            throw new ServiceUnavailableException(
                    "The confirmation mail could not be sent. Try again later, or ask the administrator.");
        }
    }

    /** Confirms the account of a link; empty when the link is unknown, used or expired. */
    public Optional<UserAccount> confirm(String token) {
        if (token == null || token.isBlank() || token.length() > 100) {
            return Optional.empty();
        }
        Instant now = Instant.now(clock);
        return confirmations
                .findByTokenDigest(RememberMe.digest(token))
                .filter(found -> found.getExpiresAt().isAfter(now))
                .flatMap(found -> accounts.findById(found.getAccountId()))
                .map(account -> {
                    account.confirmEmail(now);
                    accounts.update(account);
                    confirmations.deleteByAccountId(account.getId());
                    return account;
                });
    }

    private static String escape(String text) {
        return text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }
}

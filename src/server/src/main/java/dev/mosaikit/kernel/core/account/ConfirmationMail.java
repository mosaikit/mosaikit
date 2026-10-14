// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.data.KernelWrites;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import io.quarkus.mailer.Mail;
import io.smallrye.mutiny.TimeoutException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.transaction.Transactional.TxType;
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
 *
 * <p>Writing the link ({@link #prepare}) and sending it ({@link #deliver}) are two steps: the mail
 * goes out after the transaction that wrote the link has committed, and waits for the mail server at
 * most {@code mosaikit.accounts.mail-timeout}, so that a slow or stuck mail server never holds a
 * database transaction.
 */
@KernelWrites
@ApplicationScoped
public class ConfirmationMail {

    private static final Logger LOG = Logger.getLogger(ConfirmationMail.class);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final EmailConfirmations confirmations;
    private final UserAccounts accounts;
    private final EventLoopMailer mailer;
    private final Duration validFor;
    private final Duration mailTimeout;
    private final Optional<URI> publicUrl;
    private final Clock clock;

    @Inject
    public ConfirmationMail(
            EmailConfirmations confirmations,
            UserAccounts accounts,
            EventLoopMailer mailer,
            KernelConfig config,
            Clock clock) {
        this.confirmations = confirmations;
        this.accounts = accounts;
        this.mailer = mailer;
        this.validFor = config.accounts().confirmationValidFor();
        this.mailTimeout = config.accounts().mailTimeout();
        this.publicUrl = config.publicUrl();
        this.clock = clock;
    }

    /**
     * Writes a new link for an account that is not confirmed yet, replacing the previous ones, and
     * returns the mail that carries it, for {@link #deliver} once the transaction has committed.
     *
     * @param base the address of the installation, used when {@code mosaikit.public-url} is not set
     * @param language the language of the mail, {@code en} or {@code it} ({@link MailLanguage})
     */
    @Transactional
    public Mail prepare(UserAccount account, URI base, String language) {
        Instant now = Instant.now(clock);
        confirmations.deleteByAccountId(account.getId());
        byte[] random = new byte[32];
        RANDOM.nextBytes(random);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        confirmations.insert(new EmailConfirmation(account.getId(), RememberMe.digest(token), now, now.plus(validFor)));
        String link = publicUrl.orElse(base).resolve("/?confirm=" + token).toString();
        long hours = validFor.toHours();
        String name = account.getDisplayName();
        if ("it".equals(language)) {
            return Mail.withText(
                            account.getUsername(), "Conferma il tuo indirizzo email", """
                            Ciao %s,

                            per finire di creare il tuo account, conferma il tuo indirizzo email aprendo questo link:

                            %s

                            Il link vale per %d ore. Se non hai chiesto un account, ignora questo messaggio.
                            """.formatted(name, link, hours))
                    .setHtml("""
                            <p>Ciao %s,</p>
                            <p>per finire di creare il tuo account, conferma il tuo indirizzo email:</p>
                            <p><a href="%s">Conferma il mio indirizzo email</a></p>
                            <p>Il link vale per %d ore. Se non hai chiesto un account, ignora questo messaggio.</p>
                            """.formatted(escape(name), link, hours));
        }
        return Mail.withText(account.getUsername(), "Confirm your email address", """
                        Hello %s,

                        to finish creating your account, confirm your email address by opening this link:

                        %s

                        The link works for %d hours. If you did not ask for an account, ignore this message.
                        """.formatted(name, link, hours))
                .setHtml("""
                        <p>Hello %s,</p>
                        <p>to finish creating your account, confirm your email address:</p>
                        <p><a href="%s">Confirm my email address</a></p>
                        <p>The link works for %d hours. If you did not ask for an account, ignore this message.</p>
                        """.formatted(escape(name), link, hours));
    }

    /**
     * Sends a mail written by {@link #prepare}, outside of any transaction, waiting for the mail
     * server at most {@code mosaikit.accounts.mail-timeout} in all. The time is split in two
     * attempts: when the first one times out, the mail is sent once more, on another connection. The
     * mail starts on an event loop ({@link EventLoopMailer}), where the greeting of the server is no
     * longer lost (#94); the second attempt remains for a server that is slow once.
     *
     * @throws ServiceUnavailableException when the mail server refuses the mail or does not take it in
     *     time
     */
    @Transactional(TxType.NOT_SUPPORTED)
    public void deliver(Mail mail) {
        Duration attempt = mailTimeout.dividedBy(2);
        try {
            try {
                mailer.send(mail).await().atMost(attempt);
            } catch (TimeoutException first) {
                // The same mail, with the same link: if the first attempt went through after all, the
                // person gets the link twice, and either one works.
                LOG.infof("The confirmation mail to %s timed out after %s: trying once more", mail.getTo(), attempt);
                mailer.send(mail).await().atMost(attempt);
            }
        } catch (RuntimeException e) {
            LOG.warnf("The confirmation mail to %s could not be sent: %s", mail.getTo(), e);
            throw new ServiceUnavailableException(
                    "The confirmation mail could not be sent. Try again later, or ask the administrator.");
        }
    }

    /** Confirms the account of a link; empty when the link is unknown, used or expired. */
    @Transactional
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

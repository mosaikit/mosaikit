// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.data.KernelWrites;
import dev.mosaikit.kernel.core.security.PasswordHasher;
import io.quarkus.mailer.Mail;
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
import java.util.UUID;

/**
 * The links with which a person sets the password of an account an administrator created (MK-048):
 * a random token, valid for {@code mosaikit.accounts.set-password-valid-for}, that works once. The
 * database keeps only the SHA-256 digest of the token, and a new link replaces the previous ones.
 */
@KernelWrites
@ApplicationScoped
@Transactional
public class PasswordLinkService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final PasswordLinks links;
    private final UserAccounts accounts;
    private final PasswordHasher hasher;
    private final Duration validFor;
    private final Optional<URI> publicUrl;
    private final Clock clock;

    @Inject
    public PasswordLinkService(
            PasswordLinks links, UserAccounts accounts, PasswordHasher hasher, KernelConfig config, Clock clock) {
        this(links, accounts, hasher, config.accounts().setPasswordValidFor(), config.publicUrl(), clock);
    }

    PasswordLinkService(
            PasswordLinks links,
            UserAccounts accounts,
            PasswordHasher hasher,
            Duration validFor,
            Optional<URI> publicUrl,
            Clock clock) {
        this.links = links;
        this.accounts = accounts;
        this.hasher = hasher;
        this.validFor = validFor;
        this.publicUrl = publicUrl;
        this.clock = clock;
    }

    /**
     * A new link, which replaces the previous ones of the account.
     *
     * @param link the address the person opens; never stored
     * @param expiresAt when the link stops working
     */
    public record Issued(String link, Instant expiresAt) {

        /** Hides the link from logs. */
        @Override
        public String toString() {
            return "Issued[expiresAt=" + expiresAt + "]";
        }
    }

    /** The account a link set the password of, and the organization it was created in. */
    public record Used(UserAccount account, Optional<UUID> organization) {}

    /**
     * Writes a new link for an account, replacing the previous ones.
     *
     * @param organization the organization the account is in, for the audit of the use
     * @param base the address of the installation, used when {@code mosaikit.public-url} is not set
     */
    public Issued issue(UserAccount account, UUID organization, URI base) {
        Instant now = Instant.now(clock);
        links.deleteByAccountId(account.getId());
        byte[] random = new byte[32];
        RANDOM.nextBytes(random);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        Instant expiresAt = now.plus(validFor);
        links.insert(new PasswordLink(account.getId(), organization, RememberMe.digest(token), now, expiresAt));
        String link = publicUrl.orElse(base).resolve("/?set-password=" + token).toString();
        return new Issued(link, expiresAt);
    }

    /**
     * The mail that carries a link to the person.
     *
     * @param language the language of the mail, {@code en} or {@code it} ({@link MailLanguage})
     */
    public Mail mail(UserAccount account, String organizationName, Issued issued, String language) {
        String name = account.getDisplayName();
        long days = validFor.toDays();
        long hours = Math.max(1, validFor.toHours());
        if ("it".equals(language)) {
            String validity =
                    days >= 1 ? days + (days == 1 ? " giorno" : " giorni") : hours + (hours == 1 ? " ora" : " ore");
            return Mail.withText(account.getUsername(), "Scegli la password del tuo account", """
                            Ciao %s,

                            un amministratore ha creato un account per te in %s. Scegli la tua password aprendo questo link:

                            %s

                            Il link vale una volta sola, per %s. Poi accedi con il tuo indirizzo email e la password scelta.
                            """.formatted(
                                    name, organizationName, issued.link(), validity))
                    .setHtml("""
                            <p>Ciao %s,</p>
                            <p>un amministratore ha creato un account per te in %s.</p>
                            <p><a href="%s">Scegli la mia password</a></p>
                            <p>Il link vale una volta sola, per %s. Poi accedi con il tuo indirizzo email e la password scelta.</p>
                            """.formatted(escape(name), escape(organizationName), issued.link(), validity));
        }
        String validity = days >= 1 ? days + " days" : hours + " hours";
        return Mail.withText(account.getUsername(), "Choose the password of your account", """
                        Hello %s,

                        an administrator created an account for you in %s. Choose your password by opening this link:

                        %s

                        The link works once, for %s. Then sign in with your email address and the password you chose.
                        """.formatted(
                                name, organizationName, issued.link(), validity))
                .setHtml("""
                        <p>Hello %s,</p>
                        <p>an administrator created an account for you in %s.</p>
                        <p><a href="%s">Choose my password</a></p>
                        <p>The link works once, for %s. Then sign in with your email address and the password you chose.</p>
                        """.formatted(escape(name), escape(organizationName), issued.link(), validity));
    }

    /**
     * Sets the password of the account of a link, which stops working; empty when the link is
     * unknown, used or expired, or the account has a password already.
     */
    public Optional<Used> use(String token, char[] password) {
        if (token == null || token.isBlank() || token.length() > 100) {
            return Optional.empty();
        }
        Instant now = Instant.now(clock);
        return links.findByTokenDigest(RememberMe.digest(token))
                .filter(found -> found.getExpiresAt().isAfter(now))
                .flatMap(found -> accounts.findById(found.getAccountId())
                        .filter(account -> account.getPasswordHash().isEmpty())
                        .map(account -> {
                            account.setPasswordHash(hasher.hash(password));
                            account.confirmEmail(now);
                            accounts.update(account);
                            links.deleteByAccountId(account.getId());
                            return new Used(account, found.getOrganizationId());
                        }));
    }

    private static String escape(String text) {
        return text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }
}

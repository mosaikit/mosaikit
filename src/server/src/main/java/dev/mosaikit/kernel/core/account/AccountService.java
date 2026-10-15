// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.data.KernelWrites;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.OrganizationMember;
import dev.mosaikit.kernel.core.organization.OrganizationMembers;
import dev.mosaikit.kernel.core.organization.OrganizationService;
import dev.mosaikit.kernel.core.security.PasswordHasher;
import dev.mosaikit.kernel.core.security.Roles;
import dev.mosaikit.kernel.core.settings.PlatformSettingsService;
import io.quarkus.mailer.Mail;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import jakarta.transaction.Transactional;
import jakarta.transaction.Transactional.TxType;
import java.net.URI;
import java.time.Clock;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Creates local accounts, resolves the current one and manages memberships (MK-003, MK-017). */
@KernelWrites
@ApplicationScoped
@Transactional
public class AccountService {

    /** An app of the app bar in the personal settings: {@code <extension id>/<app id>}. */
    private static final java.util.regex.Pattern HIDDEN_APP =
            java.util.regex.Pattern.compile("^[a-z0-9][a-z0-9.-]{0,99}/[a-z0-9][a-z0-9-]{0,63}$");

    /** Roles a person can have in an organization. */
    static final Set<String> ORGANIZATION_ROLES = Set.of(Roles.ORGANIZATION_ADMIN, Roles.ORGANIZATION_USER);

    private final UserAccounts accounts;
    private final OrganizationMembers members;
    private final OrganizationService organizations;
    private final PasswordHasher passwordHasher;
    private final ObjectMapper json;
    private final PlatformSettingsService settings;
    private final ConfirmationMail confirmationMail;
    private final SessionRegistry sessions;
    private final AccessKeyRegistry keys;
    private final AccessKeyAudit keyAudit;
    private final PasswordLinkService passwordLinks;
    private final MailLanguage mailLanguage;
    private final boolean confirmEmail;
    private final Clock clock;

    public AccountService(
            UserAccounts accounts,
            OrganizationMembers members,
            OrganizationService organizations,
            PasswordHasher passwordHasher,
            ObjectMapper json,
            PlatformSettingsService settings,
            ConfirmationMail confirmationMail,
            SessionRegistry sessions,
            AccessKeyRegistry keys,
            AccessKeyAudit keyAudit,
            PasswordLinkService passwordLinks,
            MailLanguage mailLanguage,
            KernelConfig config,
            Clock clock) {
        this.accounts = accounts;
        this.members = members;
        this.organizations = organizations;
        this.passwordHasher = passwordHasher;
        this.json = json;
        this.settings = settings;
        this.confirmationMail = confirmationMail;
        this.sessions = sessions;
        this.keys = keys;
        this.keyAudit = keyAudit;
        this.passwordLinks = passwordLinks;
        this.mailLanguage = mailLanguage;
        this.confirmEmail = config.accounts().confirmEmail();
        this.clock = clock;
    }

    /**
     * The outcome of a registration.
     *
     * @param confirmationSent whether a link was sent to confirm the address, before the person can
     *     sign in
     */
    public record Registration(AccountView account, boolean confirmationSent) {}

    /**
     * Whether people can register, and in which organizations: those that allow self-registration
     * with a password, while the administrator has not turned registration off.
     */
    public RegistrationOptions registrationOptions() {
        if (!settings.registrationEnabled()) {
            return new RegistrationOptions(false, List.of());
        }
        List<RegistrationOptions.Choice> open = organizations.all().stream()
                .filter(Organization::isSelfRegistration)
                .filter(organization -> organization.getSignIn().allowsPassword())
                .map(organization -> new RegistrationOptions.Choice(organization.getSlug(), organization.getName()))
                .toList();
        return new RegistrationOptions(!open.isEmpty(), open);
    }

    /**
     * Sends a new confirmation link to a registered address that is not confirmed yet. The link is
     * written in a transaction of its own, and the mail goes out after it has committed.
     */
    @Transactional(TxType.NOT_SUPPORTED)
    public void resendConfirmation(String email, URI base, List<Locale> languages) {
        QuarkusTransaction.requiringNew()
                .call(() -> accounts.findByUsername(normalize(email))
                        .filter(account -> !account.isEmailConfirmed())
                        .filter(account -> account.getPasswordHash().isPresent())
                        .map(account -> confirmationMail.prepare(account, base, mailLanguage.of(account, languages))))
                .ifPresent(confirmationMail::deliver);
    }

    /** Confirms the address of the link; false when the link is unknown, used or expired. */
    public boolean confirm(String token) {
        return confirmationMail.confirm(token).isPresent();
    }

    /**
     * Registers a person in an organization that allows self-registration. With {@code
     * mosaikit.accounts.confirm-email} the account signs in only after the link sent to the address
     * is opened.
     *
     * <p>The account and its link are committed before the mail goes out, so that a slow or stuck
     * mail server never holds the transaction. When the mail cannot be sent, the account stays and
     * the answer is 503: the person asks for the link again.
     *
     * @param base the address of the installation, for the link
     */
    @Transactional(TxType.NOT_SUPPORTED)
    public Registration register(RegistrationRequest request, URI base, List<Locale> languages) {
        record Created(Registration registration, Optional<Mail> mail) {}
        Created created = QuarkusTransaction.requiringNew().call(() -> {
            Registration registration = createAccount(request);
            Optional<Mail> mail = Optional.empty();
            if (confirmEmail) {
                UserAccount account =
                        accounts.findById(registration.account().id()).orElseThrow();
                mail = Optional.of(confirmationMail.prepare(account, base, mailLanguage.of(account, languages)));
            }
            return new Created(registration, mail);
        });
        try {
            created.mail().ifPresent(confirmationMail::deliver);
        } catch (ServiceUnavailableException e) {
            throw new ServiceUnavailableException("The account was created, but the mail with the link that"
                    + " confirms the address could not be sent. Ask for the link again in a few minutes, or ask"
                    + " the administrator.");
        }
        return created.registration();
    }

    private Registration createAccount(RegistrationRequest request) {
        if (!settings.registrationEnabled()) {
            throw new ForbiddenOperationException(
                    "Self-registration is turned off on this installation. Ask the administrator for an account.");
        }
        Organization organization = organizations.require(request.organization());
        if (!organization.isSelfRegistration()) {
            throw new ForbiddenOperationException("Organization '" + organization.getSlug()
                    + "' does not allow self-registration. Ask its manager for an invitation.");
        }
        if (!organization.getSignIn().allowsPassword()) {
            throw new ForbiddenOperationException("Organization '" + organization.getSlug()
                    + "' signs in through its identity provider: sign in there instead.");
        }
        String username = normalize(request.email());
        if (accounts.countByUsername(username) > 0) {
            throw new ConflictException("An account with this email already exists. Sign in or reset the password.");
        }
        var account = new UserAccount(
                username,
                request.displayName().trim(),
                passwordHasher.hash(request.password().toCharArray()),
                Set.of(),
                Instant.now(clock));
        if (confirmEmail) {
            account.requireConfirmation();
        }
        accounts.insert(account);
        members.insert(new OrganizationMember(
                account.getId(), organization.getId(), Set.of(Roles.ORGANIZATION_USER), Instant.now(clock)));
        return new Registration(
                view(account, Set.of(Roles.ORGANIZATION_USER), Optional.of(organization.getId())), confirmEmail);
    }

    /** Creates the platform administrator when the installation has no account yet. */
    public Optional<AccountView> createFirstAdministrator(String username, char[] password) {
        if (accounts.countAll() > 0) {
            return Optional.empty();
        }
        var account = new UserAccount(
                normalize(username),
                "Platform administrator",
                passwordHasher.hash(password),
                Set.of(Roles.PLATFORM_ADMIN),
                Instant.now(clock));
        accounts.insert(account);
        return Optional.of(view(account, account.getRoles(), Optional.empty()));
    }

    /**
     * Returns the account with the given login name, as seen by the current request.
     *
     * @param roles the roles of the request
     * @param organizationId the organization of the request
     */
    public AccountView get(String username, Set<String> roles, Optional<UUID> organizationId) {
        return accounts.findByUsername(normalize(username))
                .map(account -> view(account, roles, organizationId))
                .orElseThrow(() -> new ResourceNotFoundException("No account for the current identity."));
    }

    /** The members of an organization. */
    public List<MemberView> members(String slug) {
        Organization organization = organizations.require(slug);
        return members.findByOrganizationId(organization.getId()).stream()
                .map(member -> accounts.findById(member.getAccountId()).map(account -> MemberView.of(account, member)))
                .flatMap(Optional::stream)
                .sorted(Comparator.comparing(MemberView::username))
                .toList();
    }

    /**
     * Adds a person to an organization, or changes their roles in it (MK-017). A person without an
     * account gets one without password: they sign in through the realm of the organization, which
     * links the account at the first sign-in.
     */
    public MemberView putMember(String slug, String email, MemberRequest request) {
        Organization organization = organizations.require(slug);
        Set<String> roles =
                request == null || request.roles() == null || request.roles().isEmpty()
                        ? Set.of(Roles.ORGANIZATION_USER)
                        : Set.copyOf(request.roles());
        if (!ORGANIZATION_ROLES.containsAll(roles)) {
            throw new ForbiddenOperationException(
                    "A member can have only the roles " + new TreeSet<>(ORGANIZATION_ROLES) + ".");
        }
        String username = normalize(email);
        UserAccount account = accounts.findByUsername(username).orElseGet(() -> {
            String name = request == null
                            || request.displayName() == null
                            || request.displayName().isBlank()
                    ? username
                    : request.displayName().trim();
            var created = UserAccount.withoutPassword(username, name, Instant.now(clock));
            accounts.insert(created);
            return created;
        });
        Optional<OrganizationMember> existing =
                members.findByAccountIdAndOrganizationId(account.getId(), organization.getId());
        OrganizationMember member;
        if (existing.isPresent()) {
            member = existing.get();
            member.replaceRoles(roles);
            members.update(member);
        } else {
            member = new OrganizationMember(account.getId(), organization.getId(), roles, Instant.now(clock));
            members.insert(member);
        }
        return MemberView.of(account, member);
    }

    /**
     * A link that sets the password of an account an administrator created (MK-048), with the
     * member it is for and, when the installation sends mail, the mail that carries it, to send once
     * the transaction has committed.
     */
    public record PasswordLinkIssue(MemberView member, PasswordLinkService.Issued issued, Optional<Mail> mail) {}

    /**
     * Creates a local account in an organization for a person who has none (MK-048): without a
     * password, so that it signs in only after the person sets one with the link returned.
     *
     * @param mail whether the installation sends mail: then the link goes in a mail to the person
     * @param base the address of the installation, for the link
     */
    public PasswordLinkIssue createLocalAccount(String slug, NewAccountRequest request, boolean mail, URI base) {
        Organization organization = organizations.require(slug);
        requirePassword(organization);
        Set<String> roles = request.roles() == null || request.roles().isEmpty()
                ? Set.of(Roles.ORGANIZATION_USER)
                : Set.copyOf(request.roles());
        if (!ORGANIZATION_ROLES.containsAll(roles)) {
            throw new InvalidInputException(
                    List.of("roles must be among " + new TreeSet<>(ORGANIZATION_ROLES) + ", not " + roles));
        }
        String username = normalize(request.email());
        if (accounts.countByUsername(username) > 0) {
            throw new ConflictException(
                    "An account with this email already exists: add the person to the" + " organization instead.");
        }
        Instant now = Instant.now(clock);
        UserAccount account =
                UserAccount.withoutPassword(username, request.displayName().trim(), now);
        accounts.insert(account);
        OrganizationMember member = new OrganizationMember(account.getId(), organization.getId(), roles, now);
        members.insert(member);
        return issue(account, member, organization, mail, base);
    }

    /**
     * Issues a new link for an account an administrator created, which has no password yet; the
     * previous link stops working.
     *
     * @param platformAdmin whether a platform administrator asks: an administrator of the organization
     *     issues links only for people who belong to no other organization
     */
    public PasswordLinkIssue reissuePasswordLink(
            String slug, String email, boolean platformAdmin, boolean mail, URI base) {
        Organization organization = organizations.require(slug);
        requirePassword(organization);
        UserAccount account = accounts.findByUsername(normalize(email)).orElseThrow(() -> noMember(slug, email));
        OrganizationMember member = members.findByAccountIdAndOrganizationId(account.getId(), organization.getId())
                .orElseThrow(() -> noMember(slug, email));
        if (account.getPasswordHash().isPresent()) {
            throw new ConflictException("This person has set a password already.");
        }
        if (member.getIdentitySubject().isPresent()) {
            throw new ConflictException("This person signs in through the identity provider of the organization.");
        }
        boolean elsewhere = members.findByAccountId(account.getId()).stream()
                .anyMatch(other -> !other.getOrganizationId().equals(organization.getId()));
        if (elsewhere && !platformAdmin) {
            throw new ForbiddenOperationException(
                    "This person belongs to other organizations too: a platform" + " administrator issues the link.");
        }
        return issue(account, member, organization, mail, base);
    }

    private PasswordLinkIssue issue(
            UserAccount account, OrganizationMember member, Organization organization, boolean mail, URI base) {
        PasswordLinkService.Issued issued = passwordLinks.issue(account, organization.getId(), base);
        Optional<Mail> message =
                // Not the language of the administrator who asks: the one of the person, or of the installation.
                mail
                        ? Optional.of(passwordLinks.mail(
                                account, organization.getName(), issued, mailLanguage.of(account, List.of())))
                        : Optional.empty();
        return new PasswordLinkIssue(MemberView.of(account, member), issued, message);
    }

    private static void requirePassword(Organization organization) {
        if (!organization.getSignIn().allowsPassword()) {
            throw new ForbiddenOperationException("Organization '" + organization.getSlug()
                    + "' signs in through its identity provider: its people have no password here.");
        }
    }

    /**
     * Sets the password of the account of a link (MK-048); empty when the link is unknown, used or
     * expired.
     */
    public Optional<PasswordLinkService.Used> setPassword(String token, char[] password) {
        return passwordLinks.use(token, password);
    }

    /**
     * Removes a person from an organization; the account stays, with its other memberships. The
     * sessions of the person that act on the organization, or on none, end at once (MK-125), and
     * their access keys in it are revoked (MK-060).
     *
     * @param actor the username of the administrator, for the audit of the revoked keys
     */
    public void removeMember(String slug, String email, String actor) {
        Organization organization = organizations.require(slug);
        UserAccount account = accounts.findByUsername(normalize(email)).orElseThrow(() -> noMember(slug, email));
        OrganizationMember member = members.findByAccountIdAndOrganizationId(account.getId(), organization.getId())
                .orElseThrow(() -> noMember(slug, email));
        members.delete(member);
        sessions.endIn(account.getId(), organization.getId());
        keys.revokeIn(account.getId(), organization.getId()).forEach(key -> keyAudit.revoked(actor, key, "removed"));
    }

    /**
     * Ends the access of every member to a deleted organization (MK-130), as a removal from it does
     * (MK-125): their sessions that act on it, or on none, end at once and their access keys in it are
     * revoked. Their memberships stay with the data of the organization until it is removed.
     *
     * @param actor the username of the administrator, for the audit of the revoked keys
     * @return how many people lost access
     */
    public int endAccessTo(UUID organizationId, String actor) {
        List<OrganizationMember> found = members.findByOrganizationId(organizationId);
        for (OrganizationMember member : found) {
            sessions.endIn(member.getAccountId(), organizationId);
            keys.revokeIn(member.getAccountId(), organizationId)
                    .forEach(key -> keyAudit.revoked(actor, key, "organization deleted"));
        }
        return found.size();
    }

    /**
     * Ends the sessions of every member that act on a suspended organization, or on none (MK-072), as
     * a removal from it does (MK-125). Their access keys stay: they open nothing while it is suspended,
     * and work again once it is reactivated.
     *
     * @return how many people it has
     */
    public int endSessionsIn(UUID organizationId) {
        List<OrganizationMember> found = members.findByOrganizationId(organizationId);
        for (OrganizationMember member : found) {
            sessions.endIn(member.getAccountId(), organizationId);
        }
        return found.size();
    }

    private static ResourceNotFoundException noMember(String slug, String email) {
        return new ResourceNotFoundException("No member '" + email + "' in organization '" + slug + "'.");
    }

    /**
     * Suspends an account (MK-125): it signs in by no means, and its sessions and "remember me"
     * tokens end at once, until it is reactivated; its access keys are revoked (MK-060).
     *
     * @param actor the username of the administrator, who cannot suspend their own account
     * @param reason why, or {@code null}; an account already suspended keeps its first reason
     */
    public AccountStatus suspend(String email, String actor, String reason) {
        String why = reason == null || reason.isBlank() ? null : reason.strip();
        if (why != null && why.length() > SuspensionRequest.MAX_REASON) {
            throw new InvalidInputException(
                    List.of("reason is longer than " + SuspensionRequest.MAX_REASON + " characters"));
        }
        UserAccount account = accounts.findByUsername(normalize(email))
                .orElseThrow(() -> new ResourceNotFoundException("No account '" + email + "'."));
        if (account.getUsername().equals(normalize(actor))) {
            throw new ForbiddenOperationException("You cannot suspend your own account.");
        }
        if (!account.isSuspended()) {
            account.suspend(Instant.now(clock), normalize(actor), why);
            accounts.update(account);
        }
        sessions.endAllOf(account.getId());
        keys.revokeAllOf(account.getId()).forEach(key -> keyAudit.revoked(actor, key, "suspended"));
        return AccountStatus.of(account);
    }

    /** Whether an account may sign in, and why not (MK-125). */
    public AccountStatus status(String email) {
        return accounts.findByUsername(normalize(email))
                .map(AccountStatus::of)
                .orElseThrow(() -> new ResourceNotFoundException("No account '" + email + "'."));
    }

    /** The suspended accounts, the most recently suspended first (MK-125). */
    public List<AccountStatus> suspended() {
        return accounts.findSuspended().stream().map(AccountStatus::of).toList();
    }

    /** Lets a suspended account sign in again; the sessions it had stay ended. */
    public AccountStatus reactivate(String email) {
        UserAccount account = accounts.findByUsername(normalize(email))
                .orElseThrow(() -> new ResourceNotFoundException("No account '" + email + "'."));
        if (account.isSuspended()) {
            account.reactivate();
            accounts.update(account);
        }
        return AccountStatus.of(account);
    }

    /** Looks up an account for authentication, which runs outside of any HTTP request context. */
    @ActivateRequestContext
    Optional<UserAccount> findForAuthentication(String username) {
        return accounts.findByUsername(normalize(username));
    }

    /** Looks up the account of a session for authentication. */
    @ActivateRequestContext
    Optional<UserAccount> findForAuthentication(UUID id) {
        return accounts.findById(id);
    }

    private AccountView view(UserAccount account, Set<String> roles, Optional<UUID> organizationId) {
        // A suspended organization is not one the person can use (MK-072).
        Map<UUID, Organization> byId = organizations.all().stream()
                .filter(organization -> !organization.isSuspended())
                .collect(Collectors.toMap(Organization::getId, Function.identity()));
        List<AccountView.MembershipView> memberships = members.findByAccountId(account.getId()).stream()
                .flatMap(member -> Optional.ofNullable(byId.get(member.getOrganizationId())).stream()
                        .map(organization -> new AccountView.MembershipView(
                                organization.getId(),
                                organization.getSlug(),
                                organization.getName(),
                                member.getRoles(),
                                organization.getSignIn())))
                .toList();
        return new AccountView(
                account.getId(),
                account.getUsername(),
                account.getDisplayName(),
                Set.copyOf(roles),
                organizationId.orElse(null),
                organizationId.map(byId::get).map(Organization::getSlug).orElse(null),
                memberships,
                readPreferences(account));
    }

    /** Whether an account is a member of an organization. */
    public boolean isMemberOf(UUID account, UUID organization) {
        return members.findByAccountId(account).stream()
                .anyMatch(member -> member.getOrganizationId().equals(organization));
    }

    /** The account of an email address, when it is a member of the organization. */
    public Optional<UUID> idIn(String email, UUID organization) {
        return accounts.findByUsername(normalize(email))
                .map(UserAccount::getId)
                .filter(account -> isMemberOf(account, organization));
    }

    /** Whether an account turned off a kind of notifications, as {@code <extension id>/<kind>} (MK-038). */
    public boolean mutes(UUID account, String kind) {
        return accounts.findById(account)
                .map(this::readPreferences)
                .map(preferences -> preferences.mutedNotifications().contains(kind))
                .orElse(false);
    }

    /** The personal settings of the signed-in person (MK-027). */
    public Preferences preferences(String username) {
        return accounts.findByUsername(normalize(username))
                .map(this::readPreferences)
                .orElseThrow(() -> new ResourceNotFoundException("No account for the current identity."));
    }

    /** Replaces the personal settings of the signed-in person. */
    public Preferences changePreferences(String username, Preferences preferences) {
        UserAccount account = accounts.findByUsername(normalize(username))
                .orElseThrow(() -> new ResourceNotFoundException("No account for the current identity."));
        List<String> wrong = preferences.hiddenApps().stream()
                .filter(app -> !HIDDEN_APP.matcher(app).matches())
                .toList();
        if (!wrong.isEmpty()) {
            throw new InvalidInputException(
                    List.of("hiddenApps must hold <extension id>/<app id>, not " + String.join(", ", wrong)));
        }
        try {
            account.setPreferences(json.writeValueAsString(preferences));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Preferences are plain values", e);
        }
        accounts.update(account);
        return readPreferences(account);
    }

    private Preferences readPreferences(UserAccount account) {
        try {
            return json.readValue(account.getPreferences(), Preferences.class);
        } catch (JsonProcessingException e) {
            // Settings written by an older version: the defaults, rather than no sign-in.
            return Preferences.NONE;
        }
    }

    private static String normalize(String username) {
        return username.trim().toLowerCase(Locale.ROOT);
    }
}

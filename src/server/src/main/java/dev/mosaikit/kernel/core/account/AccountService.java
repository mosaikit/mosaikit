// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.OrganizationMember;
import dev.mosaikit.kernel.core.organization.OrganizationMembers;
import dev.mosaikit.kernel.core.organization.OrganizationService;
import dev.mosaikit.kernel.core.security.PasswordHasher;
import dev.mosaikit.kernel.core.security.Roles;
import dev.mosaikit.kernel.core.settings.PlatformSettingsService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import jakarta.transaction.Transactional;
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
@ApplicationScoped
@Transactional
public class AccountService {

    /** An app of the app bar in the personal settings: {@code <plugin id>/<app id>}. */
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
            KernelConfig config,
            Clock clock) {
        this.accounts = accounts;
        this.members = members;
        this.organizations = organizations;
        this.passwordHasher = passwordHasher;
        this.json = json;
        this.settings = settings;
        this.confirmationMail = confirmationMail;
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

    /** Sends a new confirmation link to a registered address that is not confirmed yet. */
    public void resendConfirmation(String email, URI base) {
        accounts.findByUsername(normalize(email))
                .filter(account -> !account.isEmailConfirmed())
                .filter(account -> account.getPasswordHash().isPresent())
                .ifPresent(account -> confirmationMail.send(account, base));
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
     * @param base the address of the installation, for the link
     */
    public Registration register(RegistrationRequest request, URI base) {
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
        if (confirmEmail) {
            confirmationMail.send(account, base);
        }
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

    /** Removes a person from an organization; the account stays, with its other memberships. */
    public void removeMember(String slug, String email) {
        Organization organization = organizations.require(slug);
        accounts.findByUsername(normalize(email))
                .flatMap(account -> members.findByAccountIdAndOrganizationId(account.getId(), organization.getId()))
                .ifPresentOrElse(members::delete, () -> {
                    throw new ResourceNotFoundException("No member '" + email + "' in organization '" + slug + "'.");
                });
    }

    /** Looks up an account for authentication, which runs outside of any HTTP request context. */
    @ActivateRequestContext
    Optional<UserAccount> findForAuthentication(String username) {
        return accounts.findByUsername(normalize(username));
    }

    private AccountView view(UserAccount account, Set<String> roles, Optional<UUID> organizationId) {
        Map<UUID, Organization> byId =
                organizations.all().stream().collect(Collectors.toMap(Organization::getId, Function.identity()));
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

    /** Whether an account turned off a kind of notifications, as {@code <plugin id>/<kind>} (MK-038). */
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
                    List.of("hiddenApps must hold <plugin id>/<app id>, not " + String.join(", ", wrong)));
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

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import dev.mosaikit.kernel.core.organization.OrganizationMember;
import dev.mosaikit.kernel.core.organization.OrganizationMembers;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import jakarta.transaction.Transactional;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * The organization a request acts on (MK-017). A person signed in through the realm of an
 * organization acts on that organization. A person signed in with a password acts on the
 * organization named by the {@value #HEADER} header (the selector of the shell) or by the
 * sub-domain, or on the only organization of the person that accepts passwords; always one of
 * which the person is a member, and only if that organization accepts passwords.
 */
@ApplicationScoped
public class OrganizationAccess {

    /** Header with which the shell names the organization chosen by the person. */
    public static final String HEADER = "X-Mosaikit-Organization";

    /** Attribute of the security identity: identifier of the organization of the request. */
    public static final String ORGANIZATION_ATTRIBUTE = "mosaikit.organization";

    /** Attribute of the security identity: identifier of the account of the person (MK-032). */
    public static final String ACCOUNT_ATTRIBUTE = "mosaikit.account";

    /** Attribute of the security identity: slug of the organization of the request. */
    public static final String SLUG_ATTRIBUTE = "mosaikit.organization.slug";

    /** The path of the WebSocket of the shell, whose browsers cannot send headers (MK-031). */
    public static final String LIVE_PATH = "/api/v1/live";

    /**
     * The organization a request asks for: the {@value #HEADER} header, or, for the WebSocket of the
     * shell, the query parameter {@code organization}.
     */
    public static String requested(io.vertx.ext.web.RoutingContext routing) {
        if (routing == null) {
            return null;
        }
        String header = routing.request().getHeader(HEADER);
        if (header == null && LIVE_PATH.equals(routing.normalizedPath())) {
            return routing.request().getParam("organization");
        }
        return header;
    }

    /**
     * The organization of a request and the roles of the person in it.
     *
     * @param organizationId identifier of the organization
     * @param slug slug of the organization
     * @param roles roles of the person in the organization
     */
    public record Access(UUID organizationId, String slug, Set<String> roles) {
        public Access {
            Objects.requireNonNull(organizationId, "organizationId");
            Objects.requireNonNull(slug, "slug");
            roles = Set.copyOf(roles);
        }
    }

    private final IdentityDirectory directory;
    private final OrganizationMembers members;

    public OrganizationAccess(IdentityDirectory directory, OrganizationMembers members) {
        this.directory = directory;
        this.members = members;
    }

    /**
     * The organization of a request made with a password.
     *
     * @param requested slug from the {@value #HEADER} header, or {@code null}
     * @param host host of the request, whose sub-domain may name an organization
     * @return empty when the request names no organization the person may act on with a password
     */
    @ActivateRequestContext
    @Transactional
    public Optional<Access> forPassword(UUID accountId, String requested, String host) {
        IdentityRouting routing = directory.routing();
        List<OrganizationMember> memberships = members.findByAccountId(accountId);
        Optional<OrganizationIdentity> organization;
        if (requested != null && !requested.isBlank()) {
            organization = routing.bySlug(requested.trim().toLowerCase(Locale.ROOT));
        } else {
            organization = routing.byHost(host).or(() -> onlyOrganizationWithPassword(routing, memberships));
        }
        return organization
                .filter(found -> found.signIn().allowsPassword())
                .flatMap(found -> memberships.stream()
                        .filter(member -> member.getOrganizationId().equals(found.id()))
                        .findFirst()
                        .map(member -> new Access(found.id(), found.slug(), member.getRoles())));
    }

    private static Optional<OrganizationIdentity> onlyOrganizationWithPassword(
            IdentityRouting routing, List<OrganizationMember> memberships) {
        List<OrganizationIdentity> usable = memberships.stream()
                .map(member -> routing.byId(member.getOrganizationId()))
                .flatMap(Optional::stream)
                .filter(found -> found.signIn().allowsPassword())
                .toList();
        return usable.size() == 1 ? Optional.of(usable.getFirst()) : Optional.empty();
    }
}

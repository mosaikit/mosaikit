// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.context;

import java.util.Collection;
import java.util.Optional;

/**
 * How the Java code of an extension recognizes a call of a service identity (MK-124): a caller that is
 * not a person, such as a gateway, that a platform administrator gave the API of the extension. Such a
 * call has the single role {@value #ROLE}, the principal {@value #PRINCIPAL_START}{@code <name>}, no
 * account and, unless it names one it was allowed, no organization: {@link CurrentOrganization#id()}
 * is then empty.
 *
 * <pre>{@code
 * @Inject SecurityIdentity identity;
 *
 * if (ServiceCaller.isService(identity.getRoles())) {
 *     String name = ServiceCaller.name(identity.getPrincipal().getName()).orElseThrow();
 * }
 * }</pre>
 */
public final class ServiceCaller {

    /** The role of every call of a service identity, and of no person. */
    public static final String ROLE = "service";

    /** The start of the principal of a call of a service identity, before its name. */
    public static final String PRINCIPAL_START = "service:";

    private ServiceCaller() {}

    /** Whether the roles of a call are those of a service identity. */
    public static boolean isService(Collection<String> roles) {
        return roles != null && roles.contains(ROLE);
    }

    /** The name of the service identity of a principal, or empty for a person. */
    public static Optional<String> name(String principal) {
        return principal != null
                        && principal.startsWith(PRINCIPAL_START)
                        && principal.length() > PRINCIPAL_START.length()
                ? Optional.of(principal.substring(PRINCIPAL_START.length()))
                : Optional.empty();
    }
}

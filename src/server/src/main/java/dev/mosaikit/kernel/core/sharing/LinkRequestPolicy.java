// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import dev.mosaikit.kernel.api.extension.BackendEntry;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.vertx.http.runtime.security.HttpSecurityPolicy;
import io.smallrye.mutiny.Uni;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Optional;

/**
 * Who may call the APIs of extensions ({@code /api/v1/ext/<api>/}, MK-055): a signed-in person or
 * service, as before, or a request without an account that carries, in the {@value LinkRequest#HEADER}
 * header, a link that works and opens a resource of the extension that provides the API. Every other
 * anonymous request is refused with {@code 401}, also one with a link to a resource of another
 * extension.
 *
 * <p>Such a request has no organization yet, so the row-level security shows it no row: it acts on
 * the organization of the resource only once the extension asked {@code Sharing} about that very
 * resource and the link gave a level ({@link KernelSharing}). A route that never asks reads nothing,
 * and one annotated {@code @Authenticated} still refuses it: an extension opens to links only the
 * routes it annotates {@code @PermitAll} and checks with {@code Sharing.require}.
 */
@ApplicationScoped
public class LinkRequestPolicy implements HttpSecurityPolicy {

    /** The name of the policy, in {@code quarkus.http.auth.permission.extension-api.policy}. */
    public static final String NAME = "person-or-link";

    private static final String PREFIX = "/api/v1/ext/";

    private final SharedLinks links;
    private final ExtensionRegistry registry;

    public LinkRequestPolicy(SharedLinks links, ExtensionRegistry registry) {
        this.links = links;
        this.registry = registry;
    }

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public Uni<CheckResult> checkPermission(
            RoutingContext request, Uni<SecurityIdentity> identity, AuthorizationRequestContext context) {
        return identity.onItem().transformToUni(found -> {
            if (!found.isAnonymous()) {
                return CheckResult.permit();
            }
            String secret = request.request().getHeader(LinkRequest.HEADER);
            if (secret == null || secret.isBlank()) {
                return CheckResult.deny();
            }
            // Opening the link reads the database and writes its use in the audit log.
            return context.runBlocking(
                    request, Uni.createFrom().item(found), (routing, anonymous) -> check(routing, secret));
        });
    }

    private CheckResult check(RoutingContext routing, String secret) {
        Optional<String> extension = extensionOf(routing.normalizedPath());
        if (extension.isEmpty()) {
            return CheckResult.DENY;
        }
        try {
            SharedLinks.Opened opened =
                    links.open(secret, routing.request().getHeader(LinkRequest.PASSWORD_HEADER), "anonymous");
            if (!opened.resource().extension().equals(extension.get())) {
                return CheckResult.DENY;
            }
            routing.put(LinkRequest.OPENED, opened);
            return CheckResult.PERMIT;
        } catch (SharedLinks.RefusedException refused) {
            return CheckResult.DENY;
        }
    }

    /** The active extension that provides the API of a path under {@code /api/v1/ext/}. */
    Optional<String> extensionOf(String path) {
        if (path == null || !path.startsWith(PREFIX)) {
            return Optional.empty();
        }
        String rest = path.substring(PREFIX.length());
        int slash = rest.indexOf('/');
        String api = slash < 0 ? rest : rest.substring(0, slash);
        if (api.isEmpty()) {
            return Optional.empty();
        }
        return registry.active().stream()
                .map(InstalledExtension::manifest)
                .flatMap(Optional::stream)
                .filter(manifest -> manifest.backend()
                        .map(BackendEntry::api)
                        .filter(api::equals)
                        .isPresent())
                .map(ExtensionManifest::id)
                .findFirst();
    }
}

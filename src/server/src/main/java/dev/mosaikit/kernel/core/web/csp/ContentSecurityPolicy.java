// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web.csp;

import dev.mosaikit.kernel.core.config.KernelConfig;
import io.quarkus.runtime.StartupEvent;
import io.quarkus.scheduler.Scheduled;
import io.quarkus.vertx.http.runtime.filters.Filters;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import java.net.URI;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import org.jboss.logging.Logger;

/**
 * The content security policy of the shell and of everything the kernel serves (MK-128). By default
 * the browser loads and contacts the installation only (and Keycloak, whose token endpoint the shell
 * calls). The external origins listed in {@code mosaikit.content-security-policy.allowed-origins} and
 * by platform administrators are added to two directives only:
 *
 * <ul>
 *   <li>{@code connect-src}: what scripts read with {@code fetch}, XHR and WebSocket, such as the data
 *       of a service or vector tiles;
 *   <li>{@code img-src}: images, such as raster tiles.
 * </ul>
 *
 * <p>Never to {@code script-src}, {@code style-src}, {@code worker-src}, {@code frame-src} nor {@code
 * default-src}: an external origin may give data to read, never code to run. Workers that fetch tiles
 * are covered by {@code connect-src}, which applies to their requests too.
 *
 * <p>Every kernel keeps the policy in memory, rebuilt when its administrators change the list and
 * every 30 seconds, so that the other kernels of a cluster follow.
 */
@ApplicationScoped
public class ContentSecurityPolicy {

    private static final Logger LOG = Logger.getLogger(ContentSecurityPolicy.class);

    /** The header, run before the other filters so that every answer carries it. */
    static final String HEADER = "Content-Security-Policy";

    private static final int PRIORITY = 1_000;

    private final boolean enabled;
    private final Optional<String> keycloak;
    private final List<String> configured;
    private final AllowedOriginReader reader;
    private final AtomicReference<String> policy;

    public ContentSecurityPolicy(KernelConfig config, AllowedOriginReader reader) {
        this.enabled = config.contentSecurityPolicy().enabled();
        this.keycloak = config.identity().keycloakUrl().map(ContentSecurityPolicy::origin);
        this.configured =
                configured(config.contentSecurityPolicy().allowedOrigins().orElse(List.of()));
        this.reader = reader;
        this.policy = new AtomicReference<>(policy(keycloak, configured));
    }

    /**
     * The origins of {@code mosaikit.content-security-policy.allowed-origins}, normalized.
     *
     * @throws IllegalStateException naming the first that is not an origin the policy accepts: the
     *     kernel does not start with a policy other than the one configured
     */
    static List<String> configured(Collection<String> values) {
        List<String> result = new ArrayList<>();
        for (String value : values) {
            if (value.isBlank()) {
                continue;
            }
            result.add(ExternalOrigins.normalize(value)
                    .orElseThrow(() -> new IllegalStateException("mosaikit.content-security-policy.allowed-origins: "
                            + value.trim() + " is not an origin scheme://host[:port] (https, wss, http or ws; at"
                            + " most one leading *. before a name of two labels or more)")));
        }
        return List.copyOf(new LinkedHashSet<>(result));
    }

    /**
     * The policy: that of the kernel, with the external origins added to {@code connect-src} and
     * {@code img-src}. Without origins, exactly the policy of the kernel before MK-128.
     */
    static String policy(Optional<String> keycloak, Collection<String> external) {
        Set<String> allowed = new LinkedHashSet<>(external);
        StringBuilder connect = new StringBuilder("connect-src 'self'");
        keycloak.ifPresent(origin -> connect.append(' ').append(origin));
        allowed.forEach(origin -> connect.append(' ').append(origin));
        List<String> directives = new ArrayList<>(List.of("default-src 'self'", "style-src 'self' 'unsafe-inline'"));
        if (!allowed.isEmpty()) {
            directives.add("img-src 'self' " + String.join(" ", allowed));
        }
        directives.addAll(List.of(
                connect.toString(),
                "object-src 'none'",
                "base-uri 'self'",
                "form-action 'none'",
                "frame-ancestors 'none'"));
        return String.join("; ", directives);
    }

    /** The origin of the URL of Keycloak, as the token endpoint is called. */
    private static String origin(URI url) {
        return url.getScheme() + "://" + url.getRawAuthority();
    }

    /** Whether the kernel sends the policy: in production, or when configured. */
    public boolean enabled() {
        return enabled;
    }

    /** The policy that the kernel sends now. */
    public String current() {
        return policy.get();
    }

    /** The origins of the configuration of the installation, normalized. */
    public List<String> configured() {
        return configured;
    }

    void filter(@Observes Filters filters) {
        if (!enabled) {
            return;
        }
        filters.register(
                context -> {
                    context.response().headers().set(HEADER, policy.get());
                    context.next();
                },
                PRIORITY);
    }

    void start(@Observes StartupEvent event) {
        if (enabled) {
            refresh();
        }
    }

    /** Reads the origins of the administrators again: after a change, and every 30 seconds. */
    @Scheduled(every = "30s", delayed = "30s", concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    public void refresh() {
        if (!enabled) {
            return;
        }
        try {
            List<String> listed = reader.origins();
            List<String> all = new ArrayList<>(configured);
            all.addAll(listed);
            policy.set(policy(keycloak, all));
        } catch (RuntimeException e) {
            // The previous policy stays: never a wider one because the database did not answer.
            LOG.warnf("The external origins of the content security policy cannot be read: %s", e.getMessage());
        }
    }
}

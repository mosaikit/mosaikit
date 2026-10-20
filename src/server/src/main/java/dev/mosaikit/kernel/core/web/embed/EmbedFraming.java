// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web.embed;

import dev.mosaikit.kernel.core.web.csp.ContentSecurityPolicy;
import io.quarkus.runtime.StartupEvent;
import io.quarkus.scheduler.Scheduled;
import io.quarkus.vertx.http.runtime.filters.Filters;
import io.vertx.core.MultiMap;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;
import org.jboss.logging.Logger;

/**
 * Who may show the pages of the installation in an iframe (MK-100). Every answer is refused to frames
 * ({@code X-Frame-Options: DENY} and, in production, {@code frame-ancestors 'none'}), so that the
 * console cannot be framed to trick a person into clicking in it, except the embed mode of the shell:
 * {@value #PREFIX}{@code <slug>/...}, which the installation itself and the sites that the
 * administrators of the organization {@code <slug>} listed may frame, and no other site.
 *
 * <p>For those addresses the kernel sends {@code frame-ancestors 'self' <sites>} in place of the
 * directive of the policy (or alone, when the policy is not sent, as in development) and no {@code
 * X-Frame-Options}, which cannot name sites. An unknown or deleted organization gets {@code 'self'}
 * only. The sites are read into memory at the start, after every change, and every 30 seconds, so
 * that the other kernels of a cluster follow; a failed read keeps the previous list, never a wider one.
 */
@ApplicationScoped
public class EmbedFraming {

    private static final Logger LOG = Logger.getLogger(EmbedFraming.class);

    /** The addresses of the embed mode of the shell. */
    public static final String PREFIX = "/embed/";

    static final String POLICY_HEADER = "Content-Security-Policy";
    static final String FRAME_OPTIONS_HEADER = "X-Frame-Options";
    private static final String DIRECTIVE = "frame-ancestors";
    private static final Pattern SLUG = Pattern.compile("[a-z0-9]([a-z0-9-]*[a-z0-9])?");

    /** After the content security policy, which sets its header first. */
    private static final int PRIORITY = 900;

    private final ContentSecurityPolicy policy;
    private final EmbedSiteReader reader;
    private final AtomicReference<Map<String, List<String>>> sites = new AtomicReference<>(Map.of());

    public EmbedFraming(ContentSecurityPolicy policy, EmbedSiteReader reader) {
        this.policy = policy;
        this.reader = reader;
    }

    /**
     * The organization of an address of the embed mode, empty text when it names none; empty for any
     * other address.
     */
    static Optional<String> organizationOf(String path) {
        if (path == null || !path.startsWith(PREFIX)) {
            return Optional.empty();
        }
        String rest = path.substring(PREFIX.length());
        int slash = rest.indexOf('/');
        String slug = slash < 0 ? rest : rest.substring(0, slash);
        return Optional.of(SLUG.matcher(slug).matches() ? slug : "");
    }

    /** The directive for the sites of an organization: the installation itself, then the sites. */
    static String frameAncestors(Collection<String> origins) {
        StringBuilder directive = new StringBuilder(DIRECTIVE).append(" 'self'");
        origins.forEach(origin -> directive.append(' ').append(origin));
        return directive.toString();
    }

    /**
     * The policy of an address of the embed mode: the policy of the kernel with its {@code
     * frame-ancestors} replaced, or the directive alone when the kernel sends no policy.
     */
    static String policy(Optional<String> kernel, String frameAncestors) {
        if (kernel.isEmpty() || kernel.get().isBlank()) {
            return frameAncestors;
        }
        List<String> directives = new ArrayList<>();
        boolean replaced = false;
        for (String directive : kernel.get().split(";")) {
            String trimmed = directive.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            if (trimmed.equals(DIRECTIVE) || trimmed.startsWith(DIRECTIVE + " ")) {
                if (!replaced) {
                    directives.add(frameAncestors);
                    replaced = true;
                }
                continue;
            }
            directives.add(trimmed);
        }
        if (!replaced) {
            directives.add(frameAncestors);
        }
        return String.join("; ", directives);
    }

    /** The sites that may frame the views of an organization now. */
    public List<String> sitesOf(String slug) {
        return sites.get().getOrDefault(slug, List.of());
    }

    void filter(@Observes Filters filters) {
        filters.register(
                context -> {
                    Optional<String> organization = organizationOf(context.normalizedPath());
                    if (organization.isPresent()) {
                        String header = policy(
                                policy.enabled() ? Optional.of(policy.current()) : Optional.empty(),
                                frameAncestors(sitesOf(organization.get())));
                        // At the end, over the headers that the configuration and the other filters set.
                        context.addHeadersEndHandler(_ -> {
                            MultiMap headers = context.response().headers();
                            headers.remove(FRAME_OPTIONS_HEADER);
                            headers.set(POLICY_HEADER, header);
                        });
                    }
                    context.next();
                },
                PRIORITY);
    }

    void start(@Observes StartupEvent event) {
        refresh();
    }

    /** Reads the sites again: after a change, and every 30 seconds. */
    @Scheduled(every = "30s", delayed = "30s", concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    public void refresh() {
        try {
            sites.set(Map.copyOf(reader.sites()));
        } catch (RuntimeException e) {
            // The previous list stays: never a wider one because the database did not answer.
            LOG.warnf("The sites that may frame the views of organizations cannot be read: %s", e.getMessage());
        }
    }
}

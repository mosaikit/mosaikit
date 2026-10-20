// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.search;

import dev.mosaikit.kernel.api.resource.ResolvedReference;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.core.ai.ActionInvoker;
import dev.mosaikit.kernel.core.ai.Caller;
import dev.mosaikit.kernel.core.ai.ExtensionCall;
import dev.mosaikit.kernel.core.ai.ExtensionResponse;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.resources.KernelResourceReferences;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.Function;
import java.util.regex.Pattern;
import org.jboss.logging.Logger;

/**
 * The global search of the shell (MK-040, ADR-0030). All asks every provider at once and keeps the
 * first results of each; a pill asks one provider, a page at a time. The providers of extensions are
 * called in parallel on their backend API, with the credentials of the person, so that their
 * row-level security and permission checks apply; one that does not answer within the time limit, or
 * fails, is shown as incomplete and the others are shown anyway. A result that names a resource of an
 * extension is kept only when the person may read that resource (MK-135, MK-136).
 */
@ApplicationScoped
public class GlobalSearch {

    /** The results of each provider under All. */
    static final int FIRST_RESULTS = 5;

    /** The results of a page of one provider, unless asked otherwise. */
    static final int PAGE = 20;

    /** The most results of a page. */
    static final int MAX_PAGE = 50;

    /** The furthest a page may start. */
    static final int MAX_OFFSET = 1000;

    private static final int MAX_TITLE = 200;
    private static final int MAX_DETAIL = 300;
    private static final int MAX_LINK = 2000;

    /** A path of the shell: one slash, then no backslash nor control character. */
    private static final Pattern LINK = Pattern.compile("^/(?![/\\\\])[^\\\\\\p{Cntrl}]*$");

    private static final Logger LOG = Logger.getLogger(GlobalSearch.class);

    private final SearchProviders providers;
    private final KernelSearch kernel;
    private final ActionInvoker invoker;
    private final Function<ResourceRef, ResolvedReference> references;
    private final Duration timeout;
    private final ExecutorService calls = Executors.newVirtualThreadPerTaskExecutor();

    @Inject
    public GlobalSearch(
            SearchProviders providers,
            KernelSearch kernel,
            ActionInvoker invoker,
            KernelResourceReferences references,
            KernelConfig config) {
        this(providers, kernel, invoker, references::resolve, config.search().timeout());
    }

    GlobalSearch(
            SearchProviders providers,
            KernelSearch kernel,
            ActionInvoker invoker,
            Function<ResourceRef, ResolvedReference> references,
            Duration timeout) {
        this.providers = Objects.requireNonNull(providers, "providers");
        this.kernel = kernel;
        this.invoker = Objects.requireNonNull(invoker, "invoker");
        this.references = Objects.requireNonNull(references, "references");
        this.timeout = Objects.requireNonNull(timeout, "timeout");
    }

    @PreDestroy
    void close() {
        calls.shutdownNow();
    }

    /**
     * Searches for the person of the request.
     *
     * @param text what the person typed
     * @param provider the provider of a pill, or {@code null} for All
     * @param offset where the page starts, with a provider
     * @param limit the results of the page, with a provider
     */
    public SearchSection.Answer search(String text, String provider, Integer offset, Integer limit, Caller caller) {
        SearchText query = SearchText.of(text)
                .orElseThrow(() -> new InvalidInputException(List.of("q must contain a word to search")));
        List<SearchProvider> asked;
        int from;
        int size;
        if (provider == null || provider.isBlank()) {
            if (offset != null || limit != null) {
                throw new InvalidInputException(List.of("offset and limit need a provider"));
            }
            asked = providers.all();
            from = 0;
            size = FIRST_RESULTS;
        } else {
            asked = List.of(providers
                    .find(provider)
                    .orElseThrow(() -> new ResourceNotFoundException("There is no search provider " + provider + ".")));
            from = offset == null ? 0 : offset;
            size = limit == null ? PAGE : limit;
            List<String> problems = new ArrayList<>();
            if (from < 0 || from > MAX_OFFSET) {
                problems.add("offset must be between 0 and " + MAX_OFFSET);
            }
            if (size < 1 || size > MAX_PAGE) {
                problems.add("limit must be between 1 and " + MAX_PAGE);
            }
            if (!problems.isEmpty()) {
                throw new InvalidInputException(problems);
            }
        }
        return new SearchSection.Answer(query.text(), sections(asked, query, from, size, caller));
    }

    private List<SearchSection> sections(
            List<SearchProvider> asked, SearchText query, int offset, int limit, Caller caller) {
        long deadline = System.nanoTime() + timeout.toNanos();
        // The extensions first, so that they work while the kernel searches its own tables.
        Map<SearchProvider, Future<ExtensionResponse>> pending = new LinkedHashMap<>();
        for (SearchProvider provider : asked) {
            if (!provider.ofKernel()) {
                ExtensionCall call = call(provider, query, offset, limit);
                pending.put(provider, calls.submit(() -> invoker.invoke(call, caller)));
            }
        }
        List<SearchSection> sections = new ArrayList<>();
        for (SearchProvider provider : asked) {
            sections.add(
                    provider.ofKernel()
                            ? ofKernel(provider, query, offset, limit)
                            : ofExtension(provider, pending.get(provider), deadline, limit));
        }
        return sections;
    }

    private SearchSection ofKernel(SearchProvider provider, SearchText query, int offset, int limit) {
        try {
            SearchHit.Page page = SearchProviders.PEOPLE.equals(provider.id())
                    ? kernel.people(query, offset, limit)
                    : kernel.teams(query, offset, limit);
            return SearchSection.complete(provider, page);
        } catch (RuntimeException e) {
            LOG.warnf(e, "The search of %s failed", provider.id());
            return SearchSection.incomplete(provider, SearchSection.FAILED);
        }
    }

    private SearchSection ofExtension(
            SearchProvider provider, Future<ExtensionResponse> answer, long deadline, int limit) {
        ExtensionResponse response;
        try {
            response = answer.get(Math.max(0, deadline - System.nanoTime()), TimeUnit.NANOSECONDS);
        } catch (TimeoutException _) {
            answer.cancel(true);
            LOG.infof("The search provider %s did not answer within %s", provider.id(), timeout);
            return SearchSection.incomplete(provider, SearchSection.TIMEOUT);
        } catch (ExecutionException e) {
            LOG.warnf(e.getCause(), "The search provider %s cannot be reached", provider.id());
            return SearchSection.incomplete(provider, SearchSection.FAILED);
        } catch (InterruptedException _) {
            Thread.currentThread().interrupt();
            answer.cancel(true);
            return SearchSection.incomplete(provider, SearchSection.FAILED);
        }
        if (!response.succeeded() || !(response.body() instanceof Map<?, ?> body)) {
            LOG.infof("The search provider %s answered %d", provider.id(), response.status());
            return SearchSection.incomplete(provider, SearchSection.FAILED);
        }
        List<SearchHit> hits = new ArrayList<>();
        if (body.get("results") instanceof List<?> results) {
            for (Object result : results) {
                if (hits.size() == limit) {
                    break;
                }
                hit(provider, result).ifPresent(hits::add);
            }
        }
        boolean more = Boolean.TRUE.equals(body.get("more"));
        return SearchSection.complete(provider, new SearchHit.Page(hits, more));
    }

    /** The call to the API of the provider: {@code GET <path>?q=…&tsquery=…&offset=…&limit=…}. */
    static ExtensionCall call(SearchProvider provider, SearchText query, int offset, int limit) {
        return new ExtensionCall(
                "GET",
                "/api/v1/ext/" + provider.api() + "/" + provider.path(),
                List.of(
                        Map.entry("q", query.text()),
                        Map.entry("tsquery", query.tsquery()),
                        Map.entry("offset", String.valueOf(offset)),
                        Map.entry("limit", String.valueOf(limit))),
                null);
    }

    /**
     * A result of an extension as the shell shows it, empty when it has no title or names a resource
     * that the person may not read, or that is no longer there.
     */
    private Optional<SearchHit> hit(SearchProvider provider, Object raw) {
        if (!(raw instanceof Map<?, ?> result)) {
            return Optional.empty();
        }
        String title = text(result.get("title"), MAX_TITLE);
        String detail = text(result.get("detail"), MAX_DETAIL);
        String link = link(result.get("link"));
        ResourceRef ref = null;
        if (result.get("resource") != null) {
            if (!(result.get("resource") instanceof Map<?, ?> resource)) {
                return Optional.empty();
            }
            try {
                Object extension = resource.get("extension");
                ref = new ResourceRef(
                        extension == null ? provider.extension() : String.valueOf(extension),
                        String.valueOf(resource.get("type")),
                        String.valueOf(resource.get("id")));
            } catch (IllegalArgumentException _) {
                return Optional.empty();
            }
            ResolvedReference resolved = references.apply(ref);
            if (!resolved.isAvailable()) {
                return Optional.empty();
            }
            title = title == null ? text(resolved.resource().title(), MAX_TITLE) : title;
            link = link == null ? link(resolved.resource().link()) : link;
        }
        if (title == null) {
            return Optional.empty();
        }
        return Optional.of(new SearchHit(title, detail, link, ref));
    }

    private static String text(Object value, int max) {
        if (!(value instanceof String text) || text.isBlank()) {
            return null;
        }
        String trimmed = text.strip();
        return trimmed.length() > max ? trimmed.substring(0, max) : trimmed;
    }

    /** A path of the shell, never an address elsewhere nor a script. */
    static String link(Object value) {
        if (!(value instanceof String link)
                || link.length() > MAX_LINK
                || !LINK.matcher(link).matches()) {
            return null;
        }
        return link;
    }
}

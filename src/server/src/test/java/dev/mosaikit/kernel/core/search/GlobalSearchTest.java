// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.search;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ExtensionManifests;
import dev.mosaikit.kernel.api.extension.ManifestParseResult;
import dev.mosaikit.kernel.api.resource.ResolvedReference;
import dev.mosaikit.kernel.api.resource.Resource;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.core.ai.ActionInvoker;
import dev.mosaikit.kernel.core.ai.Caller;
import dev.mosaikit.kernel.core.ai.ExtensionCall;
import dev.mosaikit.kernel.core.ai.ExtensionResponse;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Function;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The global search with fakes of the kernel tables, of the backends of extensions and of the
 * resolution of references (MK-040): All, the pills with paging, the results the person may not read,
 * and the providers that are slow or fail.
 */
@Tag("MK-040")
class GlobalSearchTest {

    private static final String FILES = "org.example.files";
    private static final String CONNECTIONS = "org.example.connections";
    private static final Caller CALLER = new Caller("ada@example.org", UUID.randomUUID(), "acme", "Basic x");

    /** Answers by path, with a delay or a failure when set. */
    private static final class Backends implements ActionInvoker {

        final Map<String, ExtensionResponse> answers = new ConcurrentHashMap<>();
        final Map<String, Duration> delays = new ConcurrentHashMap<>();
        final List<ExtensionCall> calls = new CopyOnWriteArrayList<>();
        volatile boolean unreachable;

        @Override
        public ExtensionResponse invoke(ExtensionCall call, Caller caller) {
            calls.add(call);
            if (unreachable) {
                throw new UncheckedIOException(new IOException("connection refused"));
            }
            Duration delay = delays.get(call.path());
            if (delay != null) {
                try {
                    Thread.sleep(delay);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new UncheckedIOException(new IOException(e));
                }
            }
            return answers.getOrDefault(call.path(), new ExtensionResponse(200, Map.of("results", List.of())));
        }
    }

    /** The people and the teams of the kernel, as lists of names. */
    private static class Tables extends KernelSearch {

        final List<String> people = new ArrayList<>();
        final List<String> teams = new ArrayList<>();

        Tables() {
            super(null, null, null, null);
        }

        @Override
        public SearchHit.Page people(SearchText text, int offset, int limit) {
            return page(people, offset, limit);
        }

        @Override
        public SearchHit.Page teams(SearchText text, int offset, int limit) {
            return page(teams, offset, limit);
        }

        private static SearchHit.Page page(List<String> names, int offset, int limit) {
            List<SearchHit> hits = names.stream()
                    .skip(offset)
                    .limit(limit + 1L)
                    .map(name -> new SearchHit(name, null, null, null))
                    .toList();
            return SearchHit.Page.of(hits, limit);
        }
    }

    private final Backends backends = new Backends();
    private final Tables tables = new Tables();
    private final Map<ResourceRef, ResolvedReference> resources = new HashMap<>();
    private final Function<ResourceRef, ResolvedReference> references = ref ->
            resources.getOrDefault(ref, ResolvedReference.unavailable(ref, ResolvedReference.Availability.DELETED));

    static ExtensionManifest manifest(String id, String api, Map<String, Object> contributes) {
        Map<String, Object> tree = new LinkedHashMap<>();
        tree.put("id", id);
        tree.put("version", "1.0.0");
        tree.put("name", id);
        tree.put("kind", List.of("app"));
        tree.put("platform", ">=0.1 <1");
        if (api != null) {
            tree.put("backend", Map.of("jar", "lib/x.jar", "api", api));
        }
        tree.put("contributes", contributes);
        return ((ManifestParseResult.Valid) ExtensionManifests.parse(tree)).manifest();
    }

    private static List<ExtensionManifest> extensions() {
        return List.of(
                manifest(
                        CONNECTIONS,
                        "connections",
                        Map.of(
                                SearchProviders.POINT,
                                List.of(Map.of("id", "connections", "title", "Connections", "path", "search")))),
                manifest(
                        FILES,
                        "files",
                        Map.of(
                                SearchProviders.POINT,
                                List.of(Map.of(
                                        "id",
                                        "files",
                                        "title",
                                        "Files",
                                        "path",
                                        "files/search",
                                        "order",
                                        10,
                                        "i18n",
                                        Map.of("it", Map.of("title", "File")))))));
    }

    private GlobalSearch search(Duration timeout) {
        return new GlobalSearch(
                new SearchProviders(GlobalSearchTest::extensions), tables, backends, references, timeout);
    }

    private static ExtensionResponse results(int count, boolean more) {
        List<Map<String, Object>> results = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            results.add(Map.of("title", "Result " + i, "link", "/app/x?item=" + i));
        }
        return new ExtensionResponse(200, Map.of("results", results, "more", more));
    }

    private static SearchSection section(SearchSection.Answer answer, String provider) {
        return answer.sections().stream()
                .filter(section -> section.provider().equals(provider))
                .findFirst()
                .orElseThrow();
    }

    @Test
    void allShowsTheFirstResultsOfEveryProviderInTheOrderOfThePills() {
        for (int i = 0; i < 8; i++) {
            tables.people.add("Ada " + i);
        }
        tables.teams.add("Roads");
        backends.answers.put("/api/v1/ext/files/files/search", results(5, true));
        backends.answers.put("/api/v1/ext/connections/search", results(2, false));

        SearchSection.Answer answer = search(Duration.ofSeconds(5)).search("  ada  ", null, null, null, CALLER);

        assertThat(answer.query()).isEqualTo("ada");
        assertThat(answer.sections())
                .extracting(SearchSection::provider)
                .containsExactly("people", "teams", FILES + "/files", CONNECTIONS + "/connections");
        assertThat(section(answer, "people").results()).hasSize(GlobalSearch.FIRST_RESULTS);
        assertThat(section(answer, "people").more()).isTrue();
        assertThat(section(answer, "teams").results())
                .extracting(SearchHit::title)
                .containsExactly("Roads");
        assertThat(section(answer, "teams").more()).isFalse();
        assertThat(section(answer, FILES + "/files").results()).hasSize(5);
        assertThat(section(answer, FILES + "/files").more()).isTrue();
        assertThat(answer.sections()).allMatch(section -> section.status().equals(SearchSection.COMPLETE));
        // Each extension is asked for the first results, with the text and the text as a tsquery.
        assertThat(backends.calls)
                .extracting(ExtensionCall::target)
                .containsExactlyInAnyOrder(
                        "/api/v1/ext/files/files/search?q=ada&tsquery=ada%3A*&offset=0&limit=5",
                        "/api/v1/ext/connections/search?q=ada&tsquery=ada%3A*&offset=0&limit=5");
    }

    @Test
    void aPillShowsOnlyItsProviderWithPaging() {
        for (int i = 0; i < 30; i++) {
            tables.people.add("Ada " + i);
        }
        SearchSection.Answer people = search(Duration.ofSeconds(5)).search("ada", "people", 20, 8, CALLER);
        assertThat(people.sections()).extracting(SearchSection::provider).containsExactly("people");
        assertThat(people.sections().getFirst().results())
                .extracting(SearchHit::title)
                .containsExactly("Ada 20", "Ada 21", "Ada 22", "Ada 23", "Ada 24", "Ada 25", "Ada 26", "Ada 27");
        assertThat(people.sections().getFirst().more()).isTrue();

        backends.answers.put("/api/v1/ext/files/files/search", results(25, true));
        SearchSection.Answer files = search(Duration.ofSeconds(5)).search("ada", FILES + "/files", 40, null, CALLER);
        assertThat(files.sections()).singleElement().satisfies(section -> {
            assertThat(section.provider()).isEqualTo(FILES + "/files");
            // The kernel keeps no more than the page, even when the extension sends more.
            assertThat(section.results()).hasSize(GlobalSearch.PAGE);
            assertThat(section.more()).isTrue();
        });
        assertThat(backends.calls)
                .extracting(ExtensionCall::target)
                .containsExactly("/api/v1/ext/files/files/search?q=ada&tsquery=ada%3A*&offset=40&limit=20");
    }

    @Test
    void aResultIsNeverShownWhenThePersonCannotReadItsResource() {
        ResourceRef readable = new ResourceRef(FILES, "file", "readable");
        ResourceRef elsewhere = new ResourceRef(CONNECTIONS, "connection", "c1");
        resources.put(
                readable,
                ResolvedReference.available(new Resource(
                        readable, UUID.randomUUID(), null, "Budget.xlsx", "/app/files?file=readable", null)));
        resources.put(
                elsewhere,
                ResolvedReference.available(
                        new Resource(elsewhere, UUID.randomUUID(), null, "Warehouse", "/app/connections/c1", null)));
        resources.put(
                new ResourceRef(FILES, "file", "secret"),
                ResolvedReference.unavailable(
                        new ResourceRef(FILES, "file", "secret"), ResolvedReference.Availability.FORBIDDEN));
        backends.answers.put(
                "/api/v1/ext/files/files/search",
                new ExtensionResponse(
                        200,
                        Map.of(
                                "results",
                                List.of(
                                        // Title and link come from the registry of resources.
                                        Map.of("resource", Map.of("type", "file", "id", "readable")),
                                        Map.of("title", "Salaries", "resource", Map.of("type", "file", "id", "secret")),
                                        Map.of("title", "Gone", "resource", Map.of("type", "file", "id", "deleted")),
                                        Map.of("title", "Bad", "resource", Map.of("type", "Not A Type", "id", "x")),
                                        Map.of("title", "Bad too", "resource", "file:x"),
                                        Map.of(
                                                "title",
                                                "Warehouse",
                                                "detail",
                                                "A connection",
                                                "resource",
                                                Map.of("extension", CONNECTIONS, "type", "connection", "id", "c1")),
                                        Map.of("detail", "no title")))));

        SearchSection files = search(Duration.ofSeconds(5))
                .search("budget", FILES + "/files", null, null, CALLER)
                .sections()
                .getFirst();

        assertThat(files.results())
                .containsExactly(
                        new SearchHit("Budget.xlsx", null, "/app/files?file=readable", readable),
                        new SearchHit("Warehouse", "A connection", "/app/connections/c1", elsewhere));
    }

    @Test
    void aProviderThatDoesNotAnswerInTimeIsIncompleteAndTheOthersAreShown() {
        tables.people.add("Ada");
        backends.answers.put("/api/v1/ext/files/files/search", results(1, false));
        backends.delays.put("/api/v1/ext/connections/search", Duration.ofSeconds(5));

        long started = System.nanoTime();
        SearchSection.Answer answer = search(Duration.ofMillis(300)).search("ada", null, null, null, CALLER);
        Duration took = Duration.ofNanos(System.nanoTime() - started);

        assertThat(took).isLessThan(Duration.ofSeconds(3));
        SearchSection slow = section(answer, CONNECTIONS + "/connections");
        assertThat(slow.status()).isEqualTo(SearchSection.INCOMPLETE);
        assertThat(slow.reason()).isEqualTo(SearchSection.TIMEOUT);
        assertThat(slow.results()).isEmpty();
        assertThat(section(answer, FILES + "/files").status()).isEqualTo(SearchSection.COMPLETE);
        assertThat(section(answer, FILES + "/files").results()).hasSize(1);
        assertThat(section(answer, "people").results())
                .extracting(SearchHit::title)
                .containsExactly("Ada");
    }

    @Test
    void aProviderThatFailsIsIncompleteAndTheOthersAreShown() {
        tables.people.add("Ada");
        backends.answers.put("/api/v1/ext/files/files/search", new ExtensionResponse(500, Map.of("title", "Boom")));
        backends.answers.put("/api/v1/ext/connections/search", new ExtensionResponse(200, "not json"));
        SearchSection.Answer answer = search(Duration.ofSeconds(5)).search("ada", null, null, null, CALLER);
        assertThat(section(answer, FILES + "/files").reason()).isEqualTo(SearchSection.FAILED);
        assertThat(section(answer, CONNECTIONS + "/connections").reason()).isEqualTo(SearchSection.FAILED);
        assertThat(section(answer, "people").status()).isEqualTo(SearchSection.COMPLETE);

        backends.unreachable = true;
        SearchSection unreachable = search(Duration.ofSeconds(5))
                .search("ada", FILES + "/files", null, null, CALLER)
                .sections()
                .getFirst();
        assertThat(unreachable.status()).isEqualTo(SearchSection.INCOMPLETE);
        assertThat(unreachable.reason()).isEqualTo(SearchSection.FAILED);

        GlobalSearch broken = new GlobalSearch(
                new SearchProviders(List::of),
                new Tables() {
                    @Override
                    public SearchHit.Page teams(SearchText text, int offset, int limit) {
                        throw new IllegalStateException("database down");
                    }
                },
                backends,
                references,
                Duration.ofSeconds(1));
        assertThat(section(broken.search("ada", null, null, null, CALLER), "teams")
                        .reason())
                .isEqualTo(SearchSection.FAILED);
    }

    @Test
    void aLinkLeadsOnlyToAPageOfTheShell() {
        assertThat(GlobalSearch.link("/app/files?file=1")).isEqualTo("/app/files?file=1");
        assertThat(GlobalSearch.link("https://example.org/")).isNull();
        assertThat(GlobalSearch.link("//example.org/")).isNull();
        assertThat(GlobalSearch.link("/\\example.org")).isNull();
        assertThat(GlobalSearch.link("javascript:alert(1)")).isNull();
        assertThat(GlobalSearch.link("/app/x\nSet-Cookie: a")).isNull();
        assertThat(GlobalSearch.link(42)).isNull();
    }

    @Test
    void refusesAQueryWithoutWordsAnUnknownProviderAndPagesOutOfBounds() {
        GlobalSearch search = search(Duration.ofSeconds(1));
        assertThatThrownBy(() -> search.search(" - ", null, null, null, CALLER))
                .isInstanceOf(InvalidInputException.class);
        assertThatThrownBy(() -> search.search(null, null, null, null, CALLER))
                .isInstanceOf(InvalidInputException.class);
        assertThatThrownBy(() -> search.search("ada", null, 5, null, CALLER)).isInstanceOf(InvalidInputException.class);
        assertThatThrownBy(() -> search.search("ada", "org.example.absent/x", null, null, CALLER))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThatThrownBy(() -> search.search("ada", "people", -1, 0, CALLER))
                .isInstanceOf(InvalidInputException.class)
                .hasMessageContaining("offset")
                .hasMessageContaining("limit");
        assertThatThrownBy(() -> search.search("ada", "people", GlobalSearch.MAX_OFFSET + 1, null, CALLER))
                .isInstanceOf(InvalidInputException.class);
    }

    @Test
    void theTextBecomesATsqueryOfPrefixes() {
        assertThat(SearchText.of("Ada  Rossi")).hasValueSatisfying(text -> {
            assertThat(text.text()).isEqualTo("Ada  Rossi");
            assertThat(text.tsquery()).isEqualTo("ada:* & rossi:*");
        });
        // Operators of tsquery never reach PostgreSQL.
        assertThat(SearchText.of("a&b | !c:* 'd'")).map(SearchText::tsquery).hasValue("a:* & b:* & c:* & d:*");
        assertThat(SearchText.of("Città 2026")).map(SearchText::tsquery).hasValue("città:* & 2026:*");
        assertThat(SearchText.of("one two three four five six seven eight nine"))
                .map(SearchText::tsquery)
                .hasValueSatisfying(query -> assertThat(query.split("&")).hasSize(SearchText.MAX_WORDS));
        assertThat(SearchText.of("x".repeat(500))).map(SearchText::text).hasValue("x".repeat(SearchText.MAX_LENGTH));
        assertThat(SearchText.of("  ...  ")).isEmpty();
        assertThat(SearchText.of(null)).isEmpty();
    }
}

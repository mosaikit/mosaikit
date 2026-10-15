// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.search;

import static dev.mosaikit.kernel.core.search.GlobalSearchTest.manifest;
import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The providers of the search, from the kernel and from the point search.provider (MK-040). */
@Tag("MK-040")
class SearchProvidersTest {

    private static Map<String, Object> provider(String id, Object... attributes) {
        Map<String, Object> contribution = new java.util.LinkedHashMap<>();
        contribution.put("id", id);
        for (int i = 0; i < attributes.length; i += 2) {
            contribution.put((String) attributes[i], attributes[i + 1]);
        }
        return contribution;
    }

    @Test
    void thePillsArePeopleAndTeamsThenTheProvidersOfTheExtensionsByOrder() {
        ExtensionManifest files = manifest(
                "org.example.files",
                "files",
                Map.of(
                        SearchProviders.POINT,
                        List.of(provider(
                                "files",
                                "title",
                                "Files",
                                "path",
                                "search",
                                "i18n",
                                Map.of("it", Map.of("title", "File"))))));
        ExtensionManifest cases = manifest(
                "org.example.cases",
                "cases",
                Map.of(
                        SearchProviders.POINT,
                        List.of(provider("cases", "title", "Cases", "path", "cases/search", "order", 5))));
        ExtensionManifest unrelated = manifest("org.example.other", "other", Map.of());

        List<SearchProvider> all = new SearchProviders(() -> List.of(files, cases, unrelated)).all();

        assertThat(all)
                .extracting(SearchProvider::id)
                .containsExactly("people", "teams", "org.example.cases/cases", "org.example.files/files");
        assertThat(all.get(0).ofKernel()).isTrue();
        SearchProvider ofFiles = all.get(3);
        assertThat(ofFiles.ofKernel()).isFalse();
        assertThat(ofFiles.title()).isEqualTo("Files");
        assertThat(ofFiles.i18n()).containsEntry("it", "File");
        assertThat(ofFiles.api()).isEqualTo("files");
        assertThat(ofFiles.path()).isEqualTo("search");
        assertThat(ofFiles.order()).isEqualTo(100);
        assertThat(SearchProviders.problems(files)).isEmpty();
    }

    @Test
    void aContributionThatDoesNotMatchTheSchemaOfThePointIsIgnoredWithAWarning() {
        ExtensionManifest wrong = manifest(
                "org.example.wrong",
                "wrong",
                Map.of(
                        SearchProviders.POINT,
                        List.of(
                                provider("untitled", "path", "search"),
                                provider("elsewhere", "title", "Elsewhere", "path", "https://example.org/search"),
                                provider("parent", "title", "Parent", "path", "../admin"),
                                provider("extra", "title", "Extra", "path", "search", "color", "red"),
                                provider("good", "title", "Good", "path", "search"))));
        ExtensionManifest frontendOnly = manifest(
                "org.example.frontend",
                null,
                Map.of(SearchProviders.POINT, List.of(provider("notes", "title", "Notes", "path", "search"))));

        assertThat(new SearchProviders(() -> List.of(wrong, frontendOnly)).find("org.example.wrong/good"))
                .isPresent();
        assertThat(new SearchProviders(() -> List.of(wrong, frontendOnly)).all())
                .extracting(SearchProvider::id)
                .containsExactly("people", "teams", "org.example.wrong/good");
        assertThat(SearchProviders.problems(wrong))
                .hasSize(4)
                .anySatisfy(problem -> assertThat(problem)
                        .startsWith("search.provider untitled is ignored:")
                        .contains("title"))
                .anySatisfy(problem -> assertThat(problem).startsWith("search.provider elsewhere is ignored:"))
                .anySatisfy(problem -> assertThat(problem).startsWith("search.provider parent is ignored:"))
                .anySatisfy(problem -> assertThat(problem).startsWith("search.provider extra is ignored:"));
        assertThat(SearchProviders.problems(frontendOnly))
                .containsExactly("search.provider notes is ignored: the extension has no backend to search");
    }

    @Test
    void theProvidersOfAnExtensionThePersonCannotUseAreLeftOut() {
        ExtensionManifest files = manifest(
                "org.example.files",
                "files",
                Map.of(SearchProviders.POINT, List.of(provider("files", "title", "Files", "path", "search"))));
        SearchProviders providers = new SearchProviders(() -> List.of(files), manifest -> false);
        assertThat(providers.all()).extracting(SearchProvider::id).containsExactly("people", "teams");
        assertThat(providers.find("org.example.files/files")).isEmpty();
    }
}

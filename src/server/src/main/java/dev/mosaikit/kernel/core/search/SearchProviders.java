// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.search;

import dev.mosaikit.kernel.api.extension.BackendEntry;
import dev.mosaikit.kernel.api.extension.Contribution;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ExtensionPoint;
import dev.mosaikit.kernel.api.extension.InputSchema;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.presence.KernelExtensionPresence;
import dev.mosaikit.kernel.core.teams.GuestExtensionAccess;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * The providers of the global search (MK-040): people and teams from the kernel, then those that the
 * extensions active in the organization of the request declare with the point {@code search.provider}
 * (ADR-0030). The point is typed as the points of extensions are (MK-134): a contribution that does not
 * match its schema is ignored, and the status of its extension says why.
 */
@ApplicationScoped
public class SearchProviders {

    /** The extension point of the providers of extensions. */
    public static final String POINT = "search.provider";

    /** The people of the organization. */
    public static final String PEOPLE = "people";

    /** The teams of the organization. */
    public static final String TEAMS = "teams";

    private static final int DEFAULT_ORDER = 100;

    /** A path under the API of the extension: no scheme, no parent, no query. */
    private static final Pattern PATH = Pattern.compile("^(?!/)(?!.*\\.\\.)[A-Za-z0-9._~/-]{1,200}$");

    /** The schema of the payload of a contribution, as an extension would declare it for its points. */
    static final ExtensionPoint SCHEMA = new ExtensionPoint(
            POINT,
            1,
            InputSchema.parse(
                    Map.of(
                            "type",
                            "object",
                            "required",
                            List.of("title", "path"),
                            "additionalProperties",
                            false,
                            "properties",
                            Map.of(
                                    "title", Map.of("type", "string", "minLength", 1, "maxLength", 40),
                                    "path", Map.of("type", "string", "minLength", 1, "maxLength", 200),
                                    "order", Map.of("type", "integer", "minimum", 0, "maximum", 1000))),
                    POINT,
                    (path, message) -> {
                        throw new IllegalStateException(path + " " + message);
                    }));

    private final Supplier<List<ExtensionManifest>> manifests;
    private final Predicate<ExtensionManifest> usable;

    @Inject
    public SearchProviders(
            ExtensionRegistry registry,
            KernelExtensionPresence presence,
            GuestExtensionAccess guests,
            RequestOrganization organization,
            SecurityIdentity identity) {
        this(
                () -> registry.active().stream()
                        .map(InstalledExtension::manifest)
                        .flatMap(Optional::stream)
                        .toList(),
                manifest -> presence.isActive(manifest.id()) && reachable(manifest, guests, organization, identity));
    }

    /** The providers of these manifests, all of them usable: for tests. */
    public SearchProviders(Supplier<List<ExtensionManifest>> manifests) {
        this(manifests, manifest -> true);
    }

    SearchProviders(Supplier<List<ExtensionManifest>> manifests, Predicate<ExtensionManifest> usable) {
        this.manifests = Objects.requireNonNull(manifests, "manifests");
        this.usable = Objects.requireNonNull(usable, "usable");
    }

    /** A guest calls only the APIs of the extensions given to them (MK-032); the others answer 403. */
    private static boolean reachable(
            ExtensionManifest manifest,
            GuestExtensionAccess guests,
            RequestOrganization organization,
            SecurityIdentity identity) {
        if (!organization.guest()) {
            return true;
        }
        Optional<UUID> account = RequestOrganization.account(identity);
        String api = manifest.backend().map(BackendEntry::api).orElse(null);
        return account.isPresent() && api != null && guests.allows(organization.require(), account.get(), api);
    }

    /** The providers for the person of the request, in the order of the pills. */
    public List<SearchProvider> all() {
        List<SearchProvider> found = new ArrayList<>();
        found.add(SearchProvider.kernel(PEOPLE, "People", 0));
        found.add(SearchProvider.kernel(TEAMS, "Teams", 1));
        List<SearchProvider> ofExtensions = new ArrayList<>();
        for (ExtensionManifest manifest : manifests.get()) {
            if (manifest.contributionsTo(POINT).isEmpty() || !usable.test(manifest)) {
                continue;
            }
            for (Contribution contribution : manifest.contributionsTo(POINT)) {
                of(manifest, contribution).ifPresent(ofExtensions::add);
            }
        }
        ofExtensions.sort(Comparator.comparingInt(SearchProvider::order).thenComparing(SearchProvider::id));
        found.addAll(ofExtensions);
        return List.copyOf(found);
    }

    /** The provider of that identifier, if the person of the request may use it. */
    public Optional<SearchProvider> find(String id) {
        return all().stream().filter(provider -> provider.id().equals(id)).findFirst();
    }

    /** The provider of a contribution, empty when it is not valid. */
    static Optional<SearchProvider> of(ExtensionManifest manifest, Contribution contribution) {
        if (!problems(manifest, contribution).isEmpty()) {
            return Optional.empty();
        }
        Map<String, Object> attributes = contribution.attributes();
        Object order = attributes.get("order");
        return Optional.of(new SearchProvider(
                manifest.id() + "/" + contribution.id(),
                (String) attributes.get("title"),
                titles(attributes.get("i18n")),
                manifest.id(),
                manifest.backend().orElseThrow().api(),
                (String) attributes.get("path"),
                order instanceof Number number ? number.intValue() : DEFAULT_ORDER));
    }

    /**
     * Why the contributions of an extension to {@code search.provider} are ignored, for the warnings in
     * its status; empty when they are all used.
     */
    public static List<String> problems(ExtensionManifest manifest) {
        List<String> problems = new ArrayList<>();
        for (Contribution contribution : manifest.contributionsTo(POINT)) {
            List<String> found = problems(manifest, contribution);
            if (!found.isEmpty()) {
                problems.add(POINT + " " + contribution.id() + " is ignored: " + String.join(", ", found));
            }
        }
        return problems;
    }

    private static List<String> problems(ExtensionManifest manifest, Contribution contribution) {
        List<String> problems = new ArrayList<>(SCHEMA.validate(contribution));
        if (manifest.backend().isEmpty()) {
            problems.add("the extension has no backend to search");
        }
        if (contribution.attributes().get("path") instanceof String path
                && !PATH.matcher(path).matches()) {
            problems.add(contribution.id() + ".path must be a path under the API of the extension, "
                    + "such as search, without a query");
        }
        return problems;
    }

    /** The titles in other languages: {@code i18n: {it: {title: Pratiche}}}. */
    private static Map<String, String> titles(Object i18n) {
        Map<String, String> titles = new LinkedHashMap<>();
        if (i18n instanceof Map<?, ?> languages) {
            languages.forEach((language, texts) -> {
                if (texts instanceof Map<?, ?> map && map.get("title") instanceof String title && !title.isBlank()) {
                    titles.put(String.valueOf(language), title);
                }
            });
        }
        return titles;
    }
}

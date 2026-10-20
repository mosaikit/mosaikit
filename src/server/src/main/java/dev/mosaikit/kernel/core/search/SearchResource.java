// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.search;

import com.fasterxml.jackson.annotation.JsonInclude;
import dev.mosaikit.kernel.core.account.SessionResource;
import dev.mosaikit.kernel.core.ai.Caller;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.ws.rs.CookieParam;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The global search of the shell (MK-040): the pills, and the results of All or of one pill, for the
 * person of the request in their organization.
 */
@Path("/api/v1/search")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Search")
public class SearchResource {

    /**
     * A pill of the search box.
     *
     * @param id what to pass as {@code provider}
     * @param title its label in English
     * @param i18n its label in other languages, by language tag
     * @param extension the extension that provides it, absent for the kernel
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ProviderView(String id, String title, Map<String, String> i18n, String extension) {

        static ProviderView of(SearchProvider provider) {
            return new ProviderView(provider.id(), provider.title(), provider.i18n(), provider.extension());
        }
    }

    private final SearchProviders providers;
    private final GlobalSearch search;
    private final SecurityIdentity identity;
    private final RequestOrganization organization;

    public SearchResource(
            SearchProviders providers,
            GlobalSearch search,
            SecurityIdentity identity,
            RequestOrganization organization) {
        this.providers = providers;
        this.search = search;
        this.identity = identity;
        this.organization = organization;
    }

    @GET
    @Path("/providers")
    @Operation(
            summary = "List the providers of the global search",
            description = "The pills of the search box: people and teams, then the providers of the extensions.")
    public List<ProviderView> providers() {
        organization.require();
        return providers.all().stream().map(ProviderView::of).toList();
    }

    @GET
    @Operation(
            summary = "Search the organization",
            description = "Without provider, the first results of every provider; with one, a page of its results. "
                    + "A provider that does not answer in time is marked incomplete.")
    public SearchSection.Answer search(
            @QueryParam("q") String text,
            @QueryParam("provider") String provider,
            @QueryParam("offset") Integer offset,
            @QueryParam("limit") Integer limit,
            @HeaderParam(HttpHeaders.AUTHORIZATION) String authorization,
            @CookieParam(SessionResource.COOKIE) String session) {
        Caller caller = Caller.of(identity, organization, authorization, session);
        return search.search(text, provider, offset, limit, caller);
    }
}

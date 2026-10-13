// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.docs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.docs.ApiTable.Operation;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The table of the endpoints of api.md, rewritten from the operations of the kernel. */
class ApiTableTest {

    private static final String PAGE = """
            # REST API

            | Method and path | Who | Purpose |
            |---|---|---|
            | `GET, POST /api/v1/teams` | signed in | the teams; create one |
            | `GET /api/v1/files/{extension}?name=` | signed in | the files |
            | `WS /api/v1/live` (WebSocket) | signed in | the live channel |
            | `DELETE /api/v1/gone` | anyone | gone |

            ## Errors
            """;

    @Test
    void keepsTheRowsOfServedEndpointsAndSortsThemByPath() {
        String page = ApiTable.rewrite(
                PAGE,
                List.of(
                        new Operation("GET", "/api/v1/teams", "signed in", "List the teams"),
                        new Operation("POST", "/api/v1/teams", "signed in", "Create a team"),
                        new Operation("GET", "/api/v1/files/{extension}", "signed in", "List the files")));

        assertThat(page).isEqualTo("""
                # REST API

                | Method and path | Who | Purpose |
                |---|---|---|
                | `GET /api/v1/files/{extension}?name=` | signed in | the files |
                | `WS /api/v1/live` (WebSocket) | signed in | the live channel |
                | `GET, POST /api/v1/teams` | signed in | the teams; create one |

                ## Errors
                """);
    }

    @Test
    void addsARowForAnEndpointWithoutOneAndDropsTheMethodsThatAreGone() {
        String page = ApiTable.rewrite(
                PAGE,
                List.of(
                        new Operation("GET", "/api/v1/teams", "signed in", "List the teams"),
                        new Operation("DELETE", "/api/v1/teams/{id}", "`platform-admin`", "Delete | a team"),
                        new Operation("PUT", "/api/v1/teams", "signed in", "Replace the teams"),
                        new Operation("GET", "/api/v1/files/{extension}", "signed in", "List the files")));

        assertThat(page).contains("""
                        | `GET /api/v1/teams` | signed in | the teams; create one |
                        | `PUT /api/v1/teams` | signed in | Replace the teams |
                        | `DELETE /api/v1/teams/{id}` | `platform-admin` | Delete \\| a team |
                        """).doesNotContain("gone");
    }

    @Test
    void isStableOnceRewritten() {
        List<Operation> served = List.of(
                new Operation("GET", "/api/v1/teams", "signed in", "List the teams"),
                new Operation("GET", "/api/v1/teams-archive", "anyone", "The archive"),
                new Operation("GET", "/api/v1/teams/{id}", "signed in", "One team"));
        String once = ApiTable.rewrite(PAGE, served);

        assertThat(ApiTable.rewrite(once, served)).isEqualTo(once);
        // A path comes right before the paths under it.
        assertThat(once.indexOf("/api/v1/teams/{id}")).isLessThan(once.indexOf("/api/v1/teams-archive"));
    }

    @Test
    void readsWhoMayCallAnOperationFromItsSecurity() {
        assertThat(ApiTable.access(List.of(), false)).isEqualTo("anyone");
        assertThat(ApiTable.access(List.of(), true)).isEqualTo("signed in");
        assertThat(ApiTable.access(List.of("platform-admin"), true)).isEqualTo("`platform-admin`");
    }

    @Test
    void refusesARowThatDocumentsTwoPaths() {
        String page = PAGE.replace("| `DELETE /api/v1/gone` |", "| `GET /api/v1/a`, `GET /api/v1/b` |");

        assertThatThrownBy(() -> ApiTable.rewrite(page, List.of()))
                .hasMessageContaining("one path")
                .hasMessageContaining("/api/v1/b");
    }

    @Test
    void needsTheTable() {
        assertThatThrownBy(() -> ApiTable.rewrite("# REST API\n", List.of())).hasMessageContaining(ApiTable.HEADER);
    }
}

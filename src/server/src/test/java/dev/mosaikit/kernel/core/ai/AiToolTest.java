// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.api.plugin.ActionEntry;
import dev.mosaikit.kernel.api.plugin.ActionRisk;
import dev.mosaikit.kernel.api.plugin.InputSchema;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("MK-015")
class AiToolTest {

    private static AiTool tool(String method, String path) {
        InputSchema any = InputSchema.parse(Map.of("type", "object"), "input", (field, message) -> {});
        return AiTool.of(
                "dev.mosaikit.test",
                "things",
                new ActionEntry("do-it", "Do it", null, ActionRisk.EXECUTE, any, method, path));
    }

    private static Map<String, Object> arguments(Object... pairs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            map.put((String) pairs[i], pairs[i + 1]);
        }
        return map;
    }

    @Test
    void putsArgumentsInThePathTheQueryOrTheBody() {
        AiTool get = tool("GET", "things/{id}/parts");
        PluginCall read = get.call(arguments("id", "a b/c", "tag", List.of("x", "y"), "limit", 5, "none", null));

        assertThat(get.name()).isEqualTo("things__do-it");
        assertThat(get.needsConfirmation()).isTrue();
        assertThat(read.target()).isEqualTo("/api/v1/p/things/things/a%20b%2Fc/parts?tag=x&tag=y&limit=5");
        assertThat(read.body()).isNull();

        PluginCall write = tool("PUT", "things/{id}").call(arguments("id", 7, "name", "seven"));
        assertThat(write.target()).isEqualTo("/api/v1/p/things/things/7");
        assertThat(write.body()).isEqualTo(Map.of("name", "seven"));
    }

    @Test
    void refusesArgumentsThatCannotBeSent() {
        AiTool get = tool("DELETE", "things/{id}");

        Map<String, Object> withoutId = arguments("name", "x");
        Map<String, Object> withObject = arguments("id", 1, "filter", Map.of("a", 1));
        assertThatThrownBy(() -> get.call(withoutId))
                .isInstanceOf(InvalidInputException.class)
                .hasMessageContaining("input.id is required");
        assertThatThrownBy(() -> get.call(withObject))
                .isInstanceOf(InvalidInputException.class)
                .satisfies(e -> assertThat(((InvalidInputException) e).fieldErrors())
                        .singleElement()
                        .satisfies(error -> assertThat(error.field()).isEqualTo("input.filter")));
        assertThatThrownBy(() -> get.arguments(List.of()))
                .isInstanceOf(InvalidInputException.class)
                .hasMessageContaining("input must be an object");
        assertThat(get.arguments(null)).isEmpty();
    }

    @Test
    void callsTheKernelOnItsLoopbackAddress() {
        assertThat(HttpActionInvoker.base("0.0.0.0", 8080)).isEqualTo(URI.create("http://localhost:8080"));
        assertThat(HttpActionInvoker.base("::", 8080)).isEqualTo(URI.create("http://localhost:8080"));
        assertThat(HttpActionInvoker.base("::1", 9000)).isEqualTo(URI.create("http://[::1]:9000"));
        assertThat(HttpActionInvoker.base("10.0.0.5", 80)).isEqualTo(URI.create("http://10.0.0.5:80"));
    }

    @Test
    void acceptsOnlyRequestsFromTheSameOrigin() {
        assertThat(McpResource.sameOrigin(null, "mosaikit.example")).isTrue();
        assertThat(McpResource.sameOrigin("https://mosaikit.example", "mosaikit.example"))
                .isTrue();
        assertThat(McpResource.sameOrigin("http://localhost:8080", "localhost:8080"))
                .isTrue();
        assertThat(McpResource.sameOrigin("http://localhost:8081", "localhost:8080"))
                .isFalse();
        assertThat(McpResource.sameOrigin("null", "localhost:8080")).isFalse();
        assertThat(McpResource.sameOrigin("http://[bad", "localhost:8080")).isFalse();
    }

    @Test
    void knowsWhetherADraftCanStillBeDecided() {
        var now = java.time.Instant.parse("2026-09-30T10:00:00Z");
        ActionDraft draft = new ActionDraft("ada", java.util.UUID.randomUUID(), "t", "{}", now, now.plusSeconds(60));

        assertThat(draft.statusAt(now)).isEqualTo(ActionDraft.Status.PENDING);
        assertThat(draft.statusAt(now.plusSeconds(60))).isEqualTo(ActionDraft.Status.EXPIRED);
        var later = now.plusSeconds(61);
        assertThatThrownBy(() -> draft.reject(later)).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> draft.complete(true, 200, "{}")).isInstanceOf(IllegalStateException.class);
        draft.confirm(now);
        draft.complete(false, 500, "boom");
        assertThat(draft.statusAt(now)).isEqualTo(ActionDraft.Status.FAILED);
        assertThat(draft.getResultStatus()).contains(500);
        assertThat(draft.getDecidedAt()).contains(now);
    }
}

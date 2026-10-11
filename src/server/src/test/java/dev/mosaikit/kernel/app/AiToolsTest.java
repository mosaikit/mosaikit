// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;

import dev.mosaikit.kernel.api.plugin.ManifestParseResult;
import dev.mosaikit.kernel.api.plugin.PluginManifests;
import dev.mosaikit.kernel.core.ai.ActionCatalog;
import dev.mosaikit.kernel.core.ai.PluginResponse;
import dev.mosaikit.kernel.core.plugin.InstalledPlugin;
import dev.mosaikit.kernel.core.plugin.PluginStatus;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The tools of plugins for assistants and MCP clients (MK-015), with a plugin that offers a read
 * and a write action and a fake of its backend. The real call to a plugin is exercised by
 * JavaPluginInstallationIT.
 */
@QuarkusTest
@Tag("MK-015")
class AiToolsTest {

    private static final String ORGANIZATION = "ai-tools";
    private static final String OTHER_ORGANIZATION = "ai-tools-other";
    private static final String PASSWORD = "a long enough password";
    private static final String LIST = "traffic__list-closures";
    private static final String CLOSE = "traffic__close-road";

    @Inject
    FakeActionInvoker backend;

    private String person;

    @BeforeEach
    void setUp() {
        QuarkusMock.installMockForType(new ActionCatalog(() -> List.of(trafficPlugin())), ActionCatalog.class);
        backend.reset();
        for (String slug : List.of(ORGANIZATION, OTHER_ORGANIZATION)) {
            asAdmin()
                    .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                    .post("/api/v1/organizations");
        }
        person = register(ORGANIZATION);
    }

    private static InstalledPlugin trafficPlugin() {
        Map<String, Object> tree = Map.of(
                "id", "dev.mosaikit.test.traffic",
                "version", "1.0.0",
                "name", "Traffic (test)",
                "kind", List.of("service"),
                "platform", ">=0.1 <1",
                "backend", Map.of("jar", "lib/traffic.jar", "api", "traffic"),
                "actions",
                        List.of(
                                Map.of(
                                        "name", "list-closures",
                                        "title", "List closures",
                                        "description", "Lists the closed roads.",
                                        "risk", "read",
                                        "input",
                                                Map.of(
                                                        "type",
                                                        "object",
                                                        "properties",
                                                        Map.of("area", Map.of("type", "string"))),
                                        "call", Map.of("method", "GET", "path", "closures")),
                                Map.of(
                                        "name", "close-road",
                                        "title", "Close a road",
                                        "risk", "write",
                                        "input",
                                                Map.of(
                                                        "type",
                                                        "object",
                                                        "properties",
                                                        Map.of(
                                                                "road", Map.of("type", "string"),
                                                                "reason", Map.of("type", "string")),
                                                        "required",
                                                        List.of("road", "reason"),
                                                        "additionalProperties",
                                                        false),
                                        "call", Map.of("method", "POST", "path", "roads/{road}/closure"))));
        var manifest = ((ManifestParseResult.Valid) PluginManifests.parse(tree)).manifest();
        return new InstalledPlugin(
                manifest.id(),
                Path.of("plugins", "traffic"),
                java.util.Optional.of(manifest),
                PluginStatus.ACTIVE,
                List.of());
    }

    private static String register(String organization) {
        String email = unique("ai") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "Ada", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static RequestSpecification in(String organization, String email) {
        return as(email, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    private RequestSpecification member() {
        return in(ORGANIZATION, person);
    }

    @Test
    void listsTheToolsOfTheActivePlugins() {
        member().get("/api/v1/ai/tools")
                .then()
                .statusCode(200)
                .body("name", equalTo(List.of(LIST, CLOSE)))
                .body("[0].risk", equalTo("read"))
                .body("[0].needsConfirmation", equalTo(false))
                .body("[1].needsConfirmation", equalTo(true))
                .body("[1].plugin", equalTo("dev.mosaikit.test.traffic"))
                .body("[1].inputSchema.required", equalTo(List.of("road", "reason")));

        anonymous().get("/api/v1/ai/tools").then().statusCode(401);
        asAdmin().get("/api/v1/ai/tools").then().statusCode(403);
    }

    @Test
    void runsAReadToolAtOnceWithTheCredentialsOfThePerson() {
        member().body(Map.of("area", "north"))
                .post("/api/v1/ai/tools/{tool}/invocations", LIST)
                .then()
                .statusCode(200)
                .body("outcome", equalTo("executed"))
                .body("result.status", equalTo(200))
                .body("result.body[0].road", equalTo("A1"))
                .body("draft", nullValue());

        assertThat(backend.sent()).singleElement().satisfies(call -> {
            assertThat(call.call().target()).isEqualTo("/api/v1/p/traffic/closures?area=north");
            assertThat(call.caller().username()).isEqualTo(person);
            assertThat(call.caller().organizationSlug()).isEqualTo(ORGANIZATION);
            assertThat(call.caller().authorization()).startsWith("Basic ");
        });
        asAdmin()
                .get("/api/v1/audit-events?limit=20")
                .then()
                .statusCode(200)
                .body("findAll { it.actor == '" + person + "' }.action", hasItem("ai.action.executed"));
    }

    @Test
    void keepsAWriteToolAsADraftUntilThePersonConfirmsIt() {
        String draft = member().body(Map.of("road", "A1", "reason", "works"))
                .post("/api/v1/ai/tools/{tool}/invocations", CLOSE)
                .then()
                .statusCode(202)
                .body("outcome", equalTo("drafted"))
                .body("draft.status", equalTo("pending"))
                .body("draft.title", equalTo("Close a road"))
                .body("draft.input.road", equalTo("A1"))
                .body("draft.expiresAt", notNullValue())
                .extract()
                .path("draft.id");
        assertThat(backend.sent()).as("nothing runs before the confirmation").isEmpty();
        member().get("/api/v1/ai/drafts").then().statusCode(200).body("id", equalTo(List.of(draft)));

        // Another person, or the same person in another organization, does not see the draft.
        String other = register(ORGANIZATION);
        in(ORGANIZATION, other).get("/api/v1/ai/drafts").then().statusCode(200).body("$", hasSize(0));
        in(ORGANIZATION, other)
                .post("/api/v1/ai/drafts/{id}/confirmation", draft)
                .then()
                .statusCode(404);

        backend.answer(new PluginResponse(201, Map.of("road", "A1", "closed", true)));
        member().post("/api/v1/ai/drafts/{id}/confirmation", draft)
                .then()
                .statusCode(200)
                .body("outcome", equalTo("executed"))
                .body("result.status", equalTo(201))
                .body("draft.status", equalTo("executed"));
        assertThat(backend.sent()).singleElement().satisfies(call -> {
            assertThat(call.call().method()).isEqualTo("POST");
            assertThat(call.call().target()).isEqualTo("/api/v1/p/traffic/roads/A1/closure");
            assertThat(call.call().body()).isEqualTo(Map.of("reason", "works"));
        });

        member().post("/api/v1/ai/drafts/{id}/confirmation", draft)
                .then()
                .statusCode(409)
                .body("detail", containsString("executed"));
        member().get("/api/v1/ai/drafts").then().body("$", hasSize(0));
        member().get("/api/v1/ai/drafts/{id}", draft).then().statusCode(200).body("status", equalTo("executed"));
        asAdmin()
                .get("/api/v1/audit-events")
                .then()
                .body(
                        "findAll { it.actor == '" + person + "' }.action",
                        equalTo(List.of("ai.action.confirmed", "ai.action.proposed")));
    }

    @Test
    void discardsARejectedDraft() {
        String draft = member().body(Map.of("road", "A2", "reason", "snow"))
                .post("/api/v1/ai/tools/{tool}/invocations", CLOSE)
                .path("draft.id");

        member().delete("/api/v1/ai/drafts/{id}", draft).then().statusCode(200).body("status", equalTo("rejected"));
        member().post("/api/v1/ai/drafts/{id}/confirmation", draft).then().statusCode(409);
        assertThat(backend.sent()).isEmpty();
    }

    @Test
    void recordsAFailedConfirmationWhenThePluginDoesNotAnswer() {
        String draft = member().body(Map.of("road", "A3", "reason", "flood"))
                .post("/api/v1/ai/tools/{tool}/invocations", CLOSE)
                .path("draft.id");
        backend.unreachable();

        member().post("/api/v1/ai/drafts/{id}/confirmation", draft).then().statusCode(503);
        member().get("/api/v1/ai/drafts/{id}", draft).then().body("status", equalTo("failed"));
    }

    @Test
    void refusesInvalidArgumentsAndUnknownTools() {
        member().body(Map.of("road", "A1", "speed", 30))
                .post("/api/v1/ai/tools/{tool}/invocations", CLOSE)
                .then()
                .statusCode(400)
                .body("errors.field", hasItem("input.reason"))
                .body("errors.field", hasItem("input.speed"));
        member().body(Map.of())
                .post("/api/v1/ai/tools/{tool}/invocations", "traffic__unknown")
                .then()
                .statusCode(404);
        member().get("/api/v1/ai/drafts/{id}", "00000000-0000-0000-0000-000000000000")
                .then()
                .statusCode(404);
        assertThat(backend.sent()).isEmpty();
    }

    @Test
    void servesTheToolsOverMcp() {
        mcp(Map.of(
                        "jsonrpc",
                        "2.0",
                        "id",
                        1,
                        "method",
                        "initialize",
                        "params",
                        Map.of("protocolVersion", "2025-06-18", "capabilities", Map.of())))
                .then()
                .statusCode(200)
                .body("id", equalTo(1))
                .body("result.protocolVersion", equalTo("2025-06-18"))
                .body("result.serverInfo.name", equalTo("mosaikit"))
                .body("result.capabilities.tools.listChanged", equalTo(false));
        mcp(Map.of("jsonrpc", "2.0", "method", "notifications/initialized"))
                .then()
                .statusCode(202);
        mcp(Map.of("jsonrpc", "2.0", "id", 2, "method", "ping")).then().body("result", equalTo(Map.of()));

        mcp(Map.of("jsonrpc", "2.0", "id", 3, "method", "build/list"))
                .then()
                .body("result.tools.name", equalTo(List.of(LIST, CLOSE)))
                .body("result.tools[0].annotations.readOnlyHint", equalTo(true))
                .body("result.tools[1].description", containsString("confirms it in Mosaikit"));

        mcp(call(4, LIST, Map.of()))
                .then()
                .body("result.isError", equalTo(false))
                .body("result.structuredContent.body[0].road", equalTo("A1"))
                .body("result.content[0].type", equalTo("text"));
        mcp(call(5, CLOSE, Map.of("road", "A4", "reason", "event")))
                .then()
                .body("result.isError", equalTo(false))
                .body("result.structuredContent.draft.status", equalTo("pending"))
                .body("result.content[0].text", containsString("Nothing has changed yet"));
        assertThat(backend.sent()).hasSize(1);

        backend.answer(new PluginResponse(403, Map.of("detail", "not allowed")));
        mcp(call(6, LIST, Map.of())).then().body("result.isError", equalTo(true));
        mcp(call(7, CLOSE, Map.of("road", "A4"))).then().body("error.code", equalTo(-32602));
        mcp(call(8, "traffic__unknown", Map.of())).then().body("error.code", equalTo(-32602));
        mcp(Map.of("jsonrpc", "2.0", "id", 9, "method", "resources/list"))
                .then()
                .body("error.code", equalTo(-32601));
        mcp(Map.of("jsonrpc", "1.0", "id", 10, "method", "ping")).then().body("error.code", equalTo(-32600));
        mcp(List.of(Map.of("jsonrpc", "2.0", "id", 11, "method", "ping")))
                .then()
                .body("error.code", equalTo(-32600));
        mcp(Map.of("jsonrpc", "2.0", "id", 12, "result", Map.of())).then().statusCode(202);
    }

    @Test
    void protectsTheMcpServer() {
        anonymous()
                .body(Map.of("jsonrpc", "2.0", "id", 1, "method", "ping"))
                .post("/mcp")
                .then()
                .statusCode(401);
        asAdmin()
                .body(Map.of("jsonrpc", "2.0", "id", 1, "method", "build/list"))
                .post("/mcp")
                .then()
                .body("error.code", equalTo(-32001));
        member().header("Origin", "https://attacker.example")
                .body(Map.of("jsonrpc", "2.0", "id", 1, "method", "ping"))
                .post("/mcp")
                .then()
                .statusCode(403);
        member().get("/mcp").then().statusCode(405);
    }

    private static Map<String, Object> call(int id, String tool, Map<String, Object> arguments) {
        return Map.of(
                "jsonrpc",
                "2.0",
                "id",
                id,
                "method",
                "build/call",
                "params",
                Map.of("name", tool, "arguments", arguments));
    }

    private io.restassured.response.Response mcp(Object message) {
        return member().accept("application/json, text/event-stream")
                .body(message)
                .post("/mcp");
    }
}

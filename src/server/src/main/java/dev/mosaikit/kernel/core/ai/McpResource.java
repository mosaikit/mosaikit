// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.mosaikit.kernel.api.context.NoOrganizationException;
import dev.mosaikit.kernel.core.error.DomainException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.system.KernelVersion;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * An MCP server (Streamable HTTP transport, JSON responses) with the tools of the active plugins
 * (MK-015). MCP clients authenticate like any API client and act on the organization of the
 * request; the tools that change data return a draft that the person confirms in Mosaikit.
 */
@Path("/mcp")
@Authenticated
public class McpResource {

    /** Protocol versions this server speaks, the preferred first. */
    static final List<String> PROTOCOL_VERSIONS = List.of("2025-06-18", "2025-03-26");

    private static final String JSONRPC = "jsonrpc";
    private static final String VERSION_2 = "2.0";
    private static final String TITLE = "title";

    static final int INVALID_REQUEST = -32600;
    static final int METHOD_NOT_FOUND = -32601;
    static final int INVALID_PARAMS = -32602;
    static final int NO_ORGANIZATION = -32001;

    private static final String INSTRUCTIONS = """
            Tools of the Mosaikit plugins, acting on one organization with the permissions of the \
            signed-in person. Tools that change data do not run at once: they return a draft that \
            the person confirms or rejects in Mosaikit, under Pending actions.""";

    private final AiActions actions;
    private final SecurityIdentity identity;
    private final RequestOrganization organization;
    private final ObjectMapper json;
    private final String version;

    public McpResource(
            AiActions actions,
            SecurityIdentity identity,
            RequestOrganization organization,
            ObjectMapper json,
            KernelVersion version) {
        this.actions = actions;
        this.identity = identity;
        this.organization = organization;
        this.json = json;
        this.version = version.get().toString();
    }

    /** A JSON-RPC error, answered in place of a result. */
    private static final class RpcError extends RuntimeException {

        private static final long serialVersionUID = 1L;

        private final int code;
        private final transient Object data;

        RpcError(int code, String message, Object data) {
            super(message);
            this.code = code;
            this.data = data;
        }
    }

    /** The server does not open event streams of its own, as the transport allows. */
    @GET
    public Response stream() {
        return Response.status(Response.Status.METHOD_NOT_ALLOWED)
                .header(HttpHeaders.ALLOW, "POST")
                .build();
    }

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response handle(
            JsonNode message,
            @HeaderParam(HttpHeaders.AUTHORIZATION) String authorization,
            @HeaderParam("Origin") String origin,
            @HeaderParam(HttpHeaders.HOST) String host) {
        if (!sameOrigin(origin, host)) {
            // Against DNS rebinding, as the transport requires.
            return Response.status(Response.Status.FORBIDDEN).build();
        }
        if (message == null || !message.isObject()) {
            return answer(error(null, INVALID_REQUEST, "Send one JSON-RPC request per message.", null));
        }
        JsonNode id = message.get("id");
        JsonNode method = message.get("method");
        if (method == null) {
            // A response or an error from the client: nothing to answer.
            return Response.accepted().build();
        }
        if (!VERSION_2.equals(message.path(JSONRPC).asText()) || !method.isTextual()) {
            return answer(error(id, INVALID_REQUEST, "Not a JSON-RPC 2.0 request.", null));
        }
        if (id == null) {
            // A notification, such as notifications/initialized.
            return Response.accepted().build();
        }
        try {
            return answer(result(id, dispatch(method.asText(), message.path("params"), authorization)));
        } catch (RpcError e) {
            return answer(error(id, e.code, e.getMessage(), e.data));
        }
    }

    private Object dispatch(String method, JsonNode params, String authorization) {
        return switch (method) {
            case "initialize" -> initialize(params);
            case "ping" -> Map.of();
            case "build/list" -> Map.of("tools", tools());
            case "build/call" -> call(params, authorization);
            default -> throw new RpcError(METHOD_NOT_FOUND, "Method not found: " + method, null);
        };
    }

    private Map<String, Object> initialize(JsonNode params) {
        String requested = params.path("protocolVersion").asText();
        return Map.of(
                "protocolVersion",
                PROTOCOL_VERSIONS.contains(requested) ? requested : PROTOCOL_VERSIONS.getFirst(),
                "capabilities",
                Map.of("tools", Map.of("listChanged", false)),
                "serverInfo",
                Map.of("name", "mosaikit", TITLE, "Mosaikit", "version", version),
                "instructions",
                INSTRUCTIONS);
    }

    private List<Map<String, Object>> tools() {
        caller(null);
        return actions.tools().stream()
                .map(tool -> Map.of(
                        "name",
                        tool.name(),
                        TITLE,
                        tool.action().title(),
                        "description",
                        description(tool),
                        "inputSchema",
                        tool.action().input().tree(),
                        "annotations",
                        Map.of(
                                TITLE,
                                tool.action().title(),
                                "readOnlyHint",
                                !tool.needsConfirmation(),
                                "destructiveHint",
                                tool.needsConfirmation(),
                                "openWorldHint",
                                false)))
                .toList();
    }

    private static String description(AiTool tool) {
        String description = tool.action().description().isBlank()
                ? tool.action().title() + "."
                : tool.action().description();
        return tool.needsConfirmation()
                ? description + " Returns a draft: it runs only once the person confirms it in Mosaikit."
                : description;
    }

    private Map<String, Object> call(JsonNode params, String authorization) {
        String name = params.path("name").asText(null);
        if (name == null) {
            throw new RpcError(INVALID_PARAMS, "Give the name of the tool.", null);
        }
        Object arguments = params.has("arguments") ? json.convertValue(params.get("arguments"), Object.class) : null;
        Invocation invocation;
        try {
            invocation = actions.invoke(name, arguments, caller(authorization));
        } catch (ResourceNotFoundException _) {
            throw new RpcError(INVALID_PARAMS, "Unknown tool: " + name, null);
        } catch (InvalidInputException e) {
            throw new RpcError(INVALID_PARAMS, e.getMessage(), Map.of("errors", e.problems()));
        } catch (DomainException e) {
            return toolResult(Map.of("error", e.getMessage()), e.getMessage(), true);
        }
        if (invocation.isDrafted()) {
            DraftView draft = invocation.draft();
            String text = "Draft " + draft.id() + " waits for "
                    + identity.getPrincipal().getName()
                    + " to confirm it in Mosaikit, under Pending actions, before " + draft.expiresAt()
                    + ". Nothing has changed yet.";
            return toolResult(Map.of("draft", draft), text, false);
        }
        PluginResponse response = invocation.result();
        Map<String, Object> structured = new LinkedHashMap<>();
        structured.put("status", response.status());
        structured.put("body", response.body());
        return toolResult(structured, write(structured), !response.succeeded());
    }

    private static Map<String, Object> toolResult(Map<String, Object> structured, String text, boolean isError) {
        return Map.of(
                "content",
                List.of(Map.of("type", "text", "text", text)),
                "structuredContent",
                structured,
                "isError",
                isError);
    }

    private Caller caller(String authorization) {
        try {
            return Caller.of(identity, organization, authorization);
        } catch (NoOrganizationException _) {
            throw new RpcError(
                    NO_ORGANIZATION,
                    "Choose an organization: send its slug in the X-Mosaikit-Organization header.",
                    null);
        }
    }

    private ObjectNode result(JsonNode id, Object result) {
        ObjectNode answer = json.createObjectNode().put(JSONRPC, VERSION_2);
        answer.set("id", id);
        answer.set("result", json.valueToTree(result));
        return answer;
    }

    private ObjectNode error(JsonNode id, int code, String message, Object data) {
        ObjectNode error = json.createObjectNode().put("code", code).put("message", message);
        if (data != null) {
            error.set("data", json.valueToTree(data));
        }
        ObjectNode answer = json.createObjectNode().put(JSONRPC, VERSION_2);
        answer.set("id", id == null ? json.nullNode() : id);
        answer.set("error", error);
        return answer;
    }

    private static Response answer(ObjectNode body) {
        return Response.ok(body, MediaType.APPLICATION_JSON_TYPE).build();
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException _) {
            return String.valueOf(value);
        }
    }

    /** Whether a browser origin, if any, is the host the request was sent to. */
    static boolean sameOrigin(String origin, String host) {
        if (origin == null || origin.isBlank()) {
            return true;
        }
        try {
            URI uri = URI.create(origin);
            String authority = uri.getPort() < 0 ? uri.getHost() : uri.getHost() + ":" + uri.getPort();
            return authority != null && authority.equalsIgnoreCase(host);
        } catch (IllegalArgumentException _) {
            return false;
        }
    }
}

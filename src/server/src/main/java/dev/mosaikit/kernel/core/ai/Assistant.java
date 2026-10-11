// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.DomainException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import jakarta.enterprise.context.ApplicationScoped;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The assistant of Mosaikit (MK-024, ADR-0022): a language model that answers the person with the
 * tools of the active plugins (MK-015). It runs the tools with the rights of the person; tools that
 * change data become drafts that the person confirms, so the model never changes data by itself.
 */
@ApplicationScoped
public class Assistant {

    /** Longest conversation accepted, in messages. */
    static final int MAX_MESSAGES = 40;

    /** Longest message accepted, in characters. */
    static final int MAX_MESSAGE = 8_000;

    private static final Set<String> ROLES = Set.of("user", "assistant");

    private static final String CONTENT = "content";
    private static final String FUNCTION = "function";

    private static final String SYSTEM = """
            You are the assistant of Mosaikit, a platform of apps for public administrations. \
            Answer in the language of the person, briefly. Use the tools to read and change the data \
            of the apps; never invent data. Tools that change data do not run at once: they return a \
            draft, which the person confirms or rejects under Pending actions. When you create a \
            draft, say what it will do and that it waits for confirmation. If no tool fits, say so.""";

    private final LanguageModel model;
    private final AiActions actions;
    private final ObjectMapper json;
    private final int maxSteps;

    public Assistant(LanguageModel model, AiActions actions, ObjectMapper json, KernelConfig config) {
        this.model = model;
        this.actions = actions;
        this.json = json;
        this.maxSteps = Math.max(1, config.assistant().maxSteps());
    }

    /** A message of the conversation, as the person and the assistant exchange them. */
    public record Message(String role, String content) {}

    /**
     * What the assistant did for a question.
     *
     * @param reply the answer of the assistant
     * @param tools the tools it used, in order
     * @param drafts the drafts it created, which wait for the confirmation of the person
     */
    public record Reply(String reply, List<ToolUse> tools, List<DraftView> drafts) {}

    /**
     * A tool that the assistant used.
     *
     * @param name name of the tool
     * @param outcome {@code executed}, {@code drafted} or {@code failed}
     */
    public record ToolUse(String name, String outcome) {}

    /** Whether an assistant is configured, and its model. */
    public java.util.Optional<String> model() {
        return model.model();
    }

    /**
     * Answers the last message of a conversation.
     *
     * @throws ServiceUnavailableException when no model is configured or it cannot be reached
     */
    public Reply answer(List<Message> conversation, Caller caller) {
        if (model.model().isEmpty()) {
            throw new ServiceUnavailableException(
                    "No assistant is configured: set mosaikit.assistant.url to an OpenAI-compatible API.");
        }
        check(conversation);
        List<AiTool> tools = actions.tools();
        ArrayNode messages = json.createArrayNode();
        messages.addObject().put("role", "system").put(CONTENT, SYSTEM);
        conversation.forEach(
                message -> messages.addObject().put("role", message.role()).put(CONTENT, message.content()));
        List<ToolUse> used = new ArrayList<>();
        List<DraftView> drafts = new ArrayList<>();
        for (int step = 0; step < maxSteps; step++) {
            ObjectNode request = json.createObjectNode();
            request.set("messages", messages);
            if (!tools.isEmpty()) {
                request.set("tools", definitions(tools));
            }
            JsonNode message = call(request);
            JsonNode calls = message.path("tool_calls");
            if (!calls.isArray() || calls.isEmpty()) {
                return new Reply(message.path(CONTENT).asText(""), used, drafts);
            }
            ObjectNode echoed = messages.addObject().put("role", "assistant");
            echoed.put(CONTENT, message.path(CONTENT).asText(""));
            echoed.set("tool_calls", calls);
            for (JsonNode toolCall : calls) {
                messages.add(run(toolCall, caller, used, drafts));
            }
        }
        return new Reply(
                "I stopped after " + maxSteps + " rounds of tools without a final answer. Try a narrower question.",
                used,
                drafts);
    }

    private static void check(List<Message> conversation) {
        List<String> problems = new ArrayList<>();
        if (conversation == null || conversation.isEmpty()) {
            problems.add("messages must not be empty");
        } else {
            if (conversation.size() > MAX_MESSAGES) {
                problems.add("messages must be at most " + MAX_MESSAGES);
            }
            for (int i = 0; i < conversation.size(); i++) {
                String problem = problem(conversation.get(i));
                if (problem != null) {
                    problems.add("messages[" + i + "]." + problem);
                }
            }
            if (problems.isEmpty() && !"user".equals(conversation.getLast().role())) {
                problems.add("messages must end with a message of the user");
            }
        }
        if (!problems.isEmpty()) {
            throw new InvalidInputException(problems);
        }
    }

    /** What is wrong with a message, or {@code null}. */
    private static String problem(Message message) {
        if (message == null || !ROLES.contains(message.role())) {
            return "role must be user or assistant";
        }
        if (message.content() == null || message.content().isBlank()) {
            return "content must not be empty";
        }
        if (message.content().length() > MAX_MESSAGE) {
            return "content must have at most " + MAX_MESSAGE + " characters";
        }
        return null;
    }

    private JsonNode call(ObjectNode request) {
        try {
            return model.complete(request);
        } catch (UncheckedIOException | IllegalStateException e) {
            throw new ServiceUnavailableException("The assistant cannot answer now: " + e.getMessage());
        }
    }

    private ArrayNode definitions(List<AiTool> tools) {
        ArrayNode definitions = json.createArrayNode();
        for (AiTool tool : tools) {
            ObjectNode function = definitions.addObject().put("type", FUNCTION).putObject(FUNCTION);
            String description = tool.action().description().isBlank()
                    ? tool.action().title()
                    : tool.action().description();
            function.put("name", tool.name());
            function.put(
                    "description",
                    tool.needsConfirmation()
                            ? description + " Creates a draft that the person confirms."
                            : description);
            function.set("parameters", json.valueToTree(tool.action().input().tree()));
        }
        return definitions;
    }

    /** Runs one tool call of the model; returns the tool message for the model. */
    private ObjectNode run(JsonNode toolCall, Caller caller, List<ToolUse> used, List<DraftView> drafts) {
        String name = toolCall.path(FUNCTION).path("name").asText();
        ObjectNode result = json.createObjectNode().put("role", "tool");
        result.put("tool_call_id", toolCall.path("id").asText(name));
        Object content;
        try {
            Object arguments = arguments(toolCall.path(FUNCTION).path("arguments"));
            Invocation invocation = actions.invoke(name, arguments, caller);
            if (invocation.isDrafted()) {
                drafts.add(invocation.draft());
                used.add(new ToolUse(name, Invocation.DRAFTED));
                content = Map.of(
                        "draft", invocation.draft().id(), "status", "waiting for the confirmation of the person");
            } else {
                used.add(new ToolUse(name, Invocation.EXECUTED));
                content = invocation.result();
            }
        } catch (DomainException e) {
            used.add(new ToolUse(name, "failed"));
            content = Map.of("error", e.getMessage());
        }
        result.put(CONTENT, write(content));
        return result;
    }

    /** The arguments of a tool call: a JSON string in the OpenAI format, an object for some models. */
    private Object arguments(JsonNode raw) {
        try {
            JsonNode tree = raw;
            if (raw.isTextual()) {
                tree = json.readTree(raw.asText().isBlank() ? "{}" : raw.asText());
            }
            return tree.isMissingNode() || tree.isNull() ? Map.of() : json.convertValue(tree, Object.class);
        } catch (JsonProcessingException _) {
            throw new InvalidInputException(List.of("arguments are not JSON"));
        }
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException _) {
            return String.valueOf(value);
        }
    }
}

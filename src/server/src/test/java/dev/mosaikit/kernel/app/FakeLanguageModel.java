// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.mosaikit.kernel.core.ai.LanguageModel;
import io.quarkus.test.Mock;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Function;

/** Stands for the language model in tests: answers with a script and records the requests. */
@Mock
@ApplicationScoped
public class FakeLanguageModel implements LanguageModel {

    private final List<ObjectNode> requests = new CopyOnWriteArrayList<>();
    private volatile Function<ObjectNode, JsonNode> script;

    public void script(Function<ObjectNode, JsonNode> answers) {
        requests.clear();
        this.script = answers;
    }

    public List<ObjectNode> requests() {
        return List.copyOf(requests);
    }

    @Override
    public Optional<String> model() {
        return Optional.of("fake");
    }

    @Override
    public JsonNode complete(ObjectNode request) {
        requests.add(request.deepCopy());
        return script.apply(request);
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.core.ai.ActionInvoker;
import dev.mosaikit.kernel.core.ai.Caller;
import dev.mosaikit.kernel.core.ai.ExtensionCall;
import dev.mosaikit.kernel.core.ai.ExtensionResponse;
import io.quarkus.test.Mock;
import jakarta.enterprise.context.ApplicationScoped;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/** Stands for the backends of extensions in tests: records the calls and gives a set answer. */
@Mock
@ApplicationScoped
public class FakeActionInvoker implements ActionInvoker {

    /** A call and the person it was sent for. */
    public record Sent(ExtensionCall call, Caller caller) {}

    private final List<Sent> sent = new CopyOnWriteArrayList<>();
    private volatile ExtensionResponse answer;
    private volatile boolean unreachable;
    /** Answers and delays by path, for the providers of the global search (MK-040). */
    private final Map<String, ExtensionResponse> answers = new ConcurrentHashMap<>();

    private final Map<String, Duration> delays = new ConcurrentHashMap<>();

    public FakeActionInvoker() {
        reset();
    }

    /** Forgets the calls and answers 200 with one closure again. */
    public final void reset() {
        sent.clear();
        answer = new ExtensionResponse(200, List.of(Map.of("road", "A1")));
        unreachable = false;
        answers.clear();
        delays.clear();
    }

    /** Gives this answer to the calls of one path, after the delay given, if any. */
    public void answer(String path, ExtensionResponse response) {
        answers.put(path, response);
    }

    /** Answers the calls of one path only after a while, as a slow backend. */
    public void delay(String path, Duration delay) {
        delays.put(path, delay);
    }

    public void answer(ExtensionResponse response) {
        this.answer = response;
    }

    public void unreachable() {
        this.unreachable = true;
    }

    public List<Sent> sent() {
        return List.copyOf(sent);
    }

    @Override
    public ExtensionResponse invoke(ExtensionCall call, Caller caller) {
        if (unreachable) {
            throw new UncheckedIOException(new IOException("connection refused"));
        }
        sent.add(new Sent(call, caller));
        Duration delay = delays.get(call.path());
        if (delay != null) {
            try {
                Thread.sleep(delay);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new UncheckedIOException(new IOException("interrupted", e));
            }
        }
        return answers.getOrDefault(call.path(), answer);
    }
}

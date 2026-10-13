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
import java.util.List;
import java.util.Map;
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

    public FakeActionInvoker() {
        reset();
    }

    /** Forgets the calls and answers 200 with one closure again. */
    public final void reset() {
        sent.clear();
        answer = new ExtensionResponse(200, List.of(Map.of("road", "A1")));
        unreachable = false;
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
        return answer;
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import static org.assertj.core.api.Assertions.assertThat;

import io.quarkus.mailer.Mail;
import io.quarkus.mailer.reactive.ReactiveMailer;
import io.smallrye.mutiny.Uni;
import io.vertx.core.Context;
import io.vertx.core.Vertx;
import io.vertx.core.impl.ContextInternal;
import io.vertx.core.impl.VertxInternal;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The mail client starts on an event loop of Vert.x, never on the thread of the request (#94): on a
 * worker thread, a new connection could get the handler of its replies after the greeting of the
 * server had been read and dropped, and the mail waited until its timeout.
 */
@Tag("MK-048")
class EventLoopMailerTest {

    private Vertx vertx;
    private ExecutorService requests;
    private final AtomicReference<Thread> sentOn = new AtomicReference<>();
    private final AtomicReference<Context> sentIn = new AtomicReference<>();

    @BeforeEach
    void start() {
        vertx = Vertx.vertx();
        requests = Executors.newSingleThreadExecutor(runnable -> new Thread(runnable, "executor-thread-1"));
    }

    @AfterEach
    void stop() throws Exception {
        requests.shutdownNow();
        vertx.close().toCompletionStage().toCompletableFuture().get(10, TimeUnit.SECONDS);
    }

    /** A mail client that notes where it is called. */
    private EventLoopMailer delivery() {
        ReactiveMailer mailer = mails -> Uni.createFrom().item(() -> {
            sentOn.set(Thread.currentThread());
            sentIn.set(Vertx.currentContext());
            return null;
        });
        return new EventLoopMailer(mailer, vertx);
    }

    private static Mail mail() {
        return Mail.withText("ada@example.org", "Confirm your email address", "A link");
    }

    @Test
    void aMailSentFromTheWorkerThreadOfARequestStartsOnTheEventLoopOfTheRequest() throws Exception {
        // As Quarkus runs a blocking request: on a worker thread, in a context duplicated from an
        // event loop.
        ContextInternal request =
                ((VertxInternal) vertx).createEventLoopContext().duplicate();
        EventLoopMailer delivery = delivery();
        CompletableFuture<Void> sent = CompletableFuture.runAsync(
                () -> {
                    ContextInternal previous = request.beginDispatch();
                    try {
                        delivery.send(mail()).await().atMost(Duration.ofSeconds(5));
                    } finally {
                        request.endDispatch(previous);
                    }
                },
                requests);
        sent.get(10, TimeUnit.SECONDS);

        assertThat(sentOn.get().getName()).startsWith("vert.x-eventloop-thread-");
        assertThat(sentIn.get()).isSameAs(request);
    }

    @Test
    void aMailSentFromAThreadWithoutContextStartsOnAnEventLoop() throws Exception {
        EventLoopMailer delivery = delivery();
        CompletableFuture<Void> sent =
                CompletableFuture.runAsync(() -> delivery.send(mail()).await().atMost(Duration.ofSeconds(5)), requests);
        sent.get(10, TimeUnit.SECONDS);

        assertThat(sentOn.get().getName()).startsWith("vert.x-eventloop-thread-");
        assertThat(sentIn.get().isEventLoopContext()).isTrue();
    }

    @Test
    void aMailSentFromAWorkerContextStartsOnAnEventLoop() throws Exception {
        EventLoopMailer delivery = delivery();
        vertx.executeBlocking(() -> {
                    delivery.send(mail()).await().atMost(Duration.ofSeconds(5));
                    return null;
                })
                .toCompletionStage()
                .toCompletableFuture()
                .get(10, TimeUnit.SECONDS);

        assertThat(sentOn.get().getName()).startsWith("vert.x-eventloop-thread-");
        assertThat(sentIn.get().isEventLoopContext()).isTrue();
    }
}

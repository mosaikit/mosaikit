// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import io.quarkus.mailer.Mail;
import io.quarkus.mailer.reactive.ReactiveMailer;
import io.smallrye.mutiny.Uni;
import io.vertx.core.Context;
import io.vertx.core.Vertx;
import io.vertx.core.impl.VertxInternal;
import jakarta.enterprise.context.ApplicationScoped;

/**
 * Sends the mails of the kernel from an event loop of Vert.x, never from the thread of a request.
 *
 * <p>The mail client of Vert.x reads the greeting of the server only once the handler of the new
 * connection is set, and a greeting that arrives before is dropped: the client then waits for it
 * until the timeout (#94). The handler is set in the callback of the connection, on the event loop
 * of the connection. When the mail starts on a worker thread, a connection that opens before that
 * thread has registered the callback gets it later, as a task of the event loop that can run after
 * the greeting has been read and dropped. Started on the event loop itself, the connection completes
 * only after the callback is registered, and the handler is set before anything is read. The first
 * mail of an installation never had the problem, because the mail client looks up the name of the
 * host first and goes on from the event loop.
 */
@ApplicationScoped
public class EventLoopMailer {

    private final ReactiveMailer mailer;
    private final Vertx vertx;

    public EventLoopMailer(ReactiveMailer mailer, Vertx vertx) {
        this.mailer = mailer;
        this.vertx = vertx;
    }

    /** Sends a mail, the mail client starting on an event loop of Vert.x. */
    public Uni<Void> send(Mail mail) {
        Context context = eventLoop();
        return Uni.createFrom()
                .deferred(() -> mailer.send(mail))
                .runSubscriptionOn(task -> context.runOnContext(ignored -> task.run()));
    }

    /**
     * The context of the request when it runs on an event loop, as it does on the worker thread of a
     * request (a duplicated context); otherwise a context on an event loop.
     */
    Context eventLoop() {
        Context current = Vertx.currentContext();
        if (current != null && current.isEventLoopContext()) {
            return current;
        }
        return ((VertxInternal) vertx).createEventLoopContext();
    }
}

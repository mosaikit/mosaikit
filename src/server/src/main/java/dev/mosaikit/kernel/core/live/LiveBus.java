// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.live;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.agroal.api.AgroalDataSource;
import io.quarkus.runtime.ShutdownEvent;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.persistence.EntityManager;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Statement;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;
import org.jboss.logging.Logger;
import org.postgresql.PGConnection;
import org.postgresql.PGNotification;

/**
 * Carries the events of the real-time channel between the kernels of an installation (ADR-0028):
 * PostgreSQL NOTIFY in the transaction of the request, so that an event leaves only if the change
 * commits, and LISTEN on a connection of its own, which hands the events to the sockets of this
 * kernel. A cluster can replace it with NATS behind the same methods.
 */
@ApplicationScoped
public class LiveBus {

    static final String CHANNEL = "mosaikit_live";
    private static final Logger LOG = Logger.getLogger(LiveBus.class);

    private final EntityManager entityManager;
    private final AgroalDataSource dataSource;
    private final ObjectMapper json;
    private final List<Consumer<LiveEvent>> listeners = new CopyOnWriteArrayList<>();
    private volatile boolean running;
    private Thread listener;

    public LiveBus(EntityManager entityManager, AgroalDataSource dataSource, ObjectMapper json) {
        this.entityManager = entityManager;
        this.dataSource = dataSource;
        this.json = json;
    }

    /** Sends an event when the current transaction commits (at once outside a transaction). */
    public void publish(LiveEvent event) {
        String payload;
        try {
            payload = json.writeValueAsString(event);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalArgumentException("The data of a live event must be JSON", e);
        }
        if (payload.getBytes(StandardCharsets.UTF_8).length
                > dev.mosaikit.kernel.api.live.LiveEvents.MAX_BYTES + 1000) {
            throw new IllegalArgumentException("A live event says what changed in a few bytes, not the whole of it");
        }
        entityManager
                .createNativeQuery("select cast(pg_notify(:channel, :payload) as text)")
                .setParameter("channel", CHANNEL)
                .setParameter("payload", payload)
                .getSingleResult();
    }

    /** Receives the events of every kernel of the installation. */
    public void listen(Consumer<LiveEvent> listener) {
        listeners.add(listener);
    }

    void onStart(@Observes StartupEvent event) {
        running = true;
        listener = Thread.ofPlatform().name("mosaikit-live").daemon().start(this::loop);
    }

    void onStop(@Observes ShutdownEvent event) {
        running = false;
        if (listener != null) {
            listener.interrupt();
        }
    }

    private void loop() {
        while (running) {
            try (Connection connection = dataSource.getConnection();
                    Statement statement = connection.createStatement()) {
                statement.execute("LISTEN " + CHANNEL);
                PGConnection postgres = connection.unwrap(PGConnection.class);
                while (running) {
                    PGNotification[] received = postgres.getNotifications(500);
                    if (received != null) {
                        for (PGNotification notification : received) {
                            deliver(notification.getParameter());
                        }
                    }
                }
            } catch (Exception e) {
                if (running) {
                    LOG.warnf("The real-time channel lost the database, listening again: %s", e.getMessage());
                    pause();
                }
            }
        }
    }

    private void deliver(String payload) {
        LiveEvent event;
        try {
            event = json.readValue(payload, LiveEvent.class);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            LOG.warnf("A live event that is not valid was ignored: %s", e.getMessage());
            return;
        }
        for (Consumer<LiveEvent> consumer : listeners) {
            try {
                consumer.accept(event);
            } catch (RuntimeException e) {
                LOG.warnf("A live event could not be delivered: %s", e.getMessage());
            }
        }
    }

    private static void pause() {
        try {
            Thread.sleep(1000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}

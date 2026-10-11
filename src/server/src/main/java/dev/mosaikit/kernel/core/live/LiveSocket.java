// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.live;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.account.AccountDirectory;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.teams.TeamService;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.websockets.next.OnClose;
import io.quarkus.websockets.next.OnOpen;
import io.quarkus.websockets.next.OnTextMessage;
import io.quarkus.websockets.next.OpenConnections;
import io.quarkus.websockets.next.WebSocket;
import io.quarkus.websockets.next.WebSocketConnection;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The WebSocket of the shell (MK-031, ADR-0028): one per page, authenticated like the API, for the
 * organization of the query parameter {@code organization}. The page sends {@code {"type":
 * "subscribe", "topic": "…"}} and {@code unsubscribe}; the kernel answers {@code subscribed} or
 * {@code refused}, and sends {@code {"type": "event", "topic", "data"}} for every event of a
 * subscribed topic that reaches the person.
 */
@WebSocket(path = "/api/v1/live")
@Authenticated
public class LiveSocket {

    @Inject
    SecurityIdentity identity;

    @Inject
    WebSocketConnection connection;

    @Inject
    LiveTopics topics;

    @Inject
    AccountDirectory accounts;

    @Inject
    LivePages pages;

    @Inject
    ObjectMapper json;

    @OnOpen
    void open() {
        UUID account = accounts.idOf(identity.getPrincipal().getName()).orElseThrow();
        pages.open(connection.id(), account, RequestOrganization.of(identity), RequestOrganization.guest(identity));
    }

    @OnTextMessage
    void message(String text) {
        JsonNode message;
        try {
            message = json.readTree(text);
        } catch (JsonProcessingException e) {
            return;
        }
        LivePages.Page page = pages.get(connection.id()).orElse(null);
        if (page == null) {
            return;
        }
        String type = message.path("type").asText();
        String topic = message.path("topic").asText();
        if ("subscribe".equals(type)) {
            Optional<String> refusal = topics.refusal(topic, page.organization());
            if (refusal.isPresent()) {
                pages.send(page, Map.of("type", "refused", "topic", topic, "reason", refusal.get()));
            } else {
                page.topics().add(topic);
                pages.send(page, Map.of("type", "subscribed", "topic", topic));
            }
        } else if ("unsubscribe".equals(type)) {
            page.topics().remove(topic);
        }
    }

    @OnClose
    void close() {
        pages.close(connection.id());
    }

    /**
     * The pages connected to this kernel, and the delivery of the events of the bus to them. The
     * connections are looked up by identifier when sending: the injected connection of the endpoint
     * is a proxy that works only while one of its callbacks runs.
     */
    @ApplicationScoped
    public static class LivePages {

        /** A page connected to the channel. */
        record Page(String connection, UUID account, Optional<UUID> organization, boolean guest, Set<String> topics) {}

        private final Map<String, Page> pages = new ConcurrentHashMap<>();
        private final OpenConnections connections;
        private final ObjectMapper json;

        private final TeamService teams;

        public LivePages(OpenConnections connections, ObjectMapper json, LiveBus bus, TeamService teams) {
            this.teams = teams;
            this.connections = connections;
            this.json = json;
            bus.listen(this::deliver);
        }

        void open(String connection, UUID account, Optional<UUID> organization, boolean guest) {
            pages.put(connection, new Page(connection, account, organization, guest, ConcurrentHashMap.newKeySet()));
        }

        Optional<Page> get(String connection) {
            return Optional.ofNullable(pages.get(connection));
        }

        void close(String connection) {
            pages.remove(connection);
        }

        /** The accounts with at least one open page, for the presence (MK-033). */
        public Set<UUID> accountsOnline() {
            return pages.values().stream().map(Page::account).collect(java.util.stream.Collectors.toSet());
        }

        private void deliver(LiveEvent event) {
            if (pages.values().stream().noneMatch(page -> page.topics().contains(event.topic()))) {
                return;
            }
            // The people of the team of the event, read once for every page.
            Set<UUID> team = event.team() == null ? Set.of() : teams.accountsOf(event.team());
            for (Page page : pages.values()) {
                boolean organization = page.organization()
                        .filter(id -> event.reaches(id, page.account(), page.guest(), team))
                        .isPresent();
                boolean personal = LiveTopics.NOTIFICATIONS.equals(event.topic())
                        && event.audience() != null
                        && event.audience().contains(page.account());
                if ((organization || personal) && page.topics().contains(event.topic())) {
                    send(page, Map.of("type", "event", "topic", event.topic(), "data", event.data()));
                }
            }
        }

        void send(Page page, Map<String, Object> message) {
            Optional<WebSocketConnection> target = connections.findByConnectionId(page.connection());
            if (target.isEmpty()) {
                pages.remove(page.connection());
                return;
            }
            String text;
            try {
                text = json.writeValueAsString(message);
            } catch (JsonProcessingException e) {
                throw new IllegalStateException("Messages of the channel are plain values", e);
            }
            target.get().sendText(text).subscribe().with(sent -> {}, failure -> {
                // A page that went away: its socket closes by itself.
            });
        }
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.live;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.account.AccountDirectory;
import dev.mosaikit.kernel.core.account.SessionRegistry;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.teams.TeamService;
import io.quarkus.scheduler.Scheduled;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.websockets.next.CloseReason;
import io.quarkus.websockets.next.OnClose;
import io.quarkus.websockets.next.OnOpen;
import io.quarkus.websockets.next.OnTextMessage;
import io.quarkus.websockets.next.OpenConnections;
import io.quarkus.websockets.next.WebSocket;
import io.quarkus.websockets.next.WebSocketConnection;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * The WebSocket of the shell (MK-031, ADR-0028): one per page, authenticated like the API, for the
 * organization of the query parameter {@code organization}. The page sends {@code {"type":
 * "subscribe", "topic": "…"}} and {@code unsubscribe}; the kernel answers {@code subscribed} or
 * {@code refused}, and sends {@code {"type": "event", "topic", "data"}} for every event of a
 * subscribed topic that reaches the person.
 *
 * <p>A page opened with a session of the kernel lives as long as that session (MK-125): when the
 * session ends (sign-out, ended in the settings, suspension of the account, removal from the
 * organization) the kernel sends it nothing more and closes the socket with {@link
 * LivePages#SESSION_ENDED}, at once on the kernel that ended it and within {@link
 * LivePages#CHECK_EVERY} on the others. A suspension closes every page of the account, also those
 * opened without a session.
 */
@WebSocket(path = "/api/v1/live")
@Authenticated
public class LiveSocket {

    private final SecurityIdentity identity;
    private final WebSocketConnection connection;
    private final LiveTopics topics;
    private final AccountDirectory accounts;
    private final LivePages pages;
    private final ObjectMapper json;

    public LiveSocket(
            SecurityIdentity identity,
            WebSocketConnection connection,
            LiveTopics topics,
            AccountDirectory accounts,
            LivePages pages,
            ObjectMapper json) {
        this.identity = identity;
        this.connection = connection;
        this.topics = topics;
        this.accounts = accounts;
        this.pages = pages;
        this.json = json;
    }

    @OnOpen
    void open() {
        UUID account = accounts.idOf(identity.getPrincipal().getName()).orElseThrow();
        pages.open(
                connection.id(),
                account,
                SessionRegistry.of(identity),
                RequestOrganization.of(identity),
                RequestOrganization.guest(identity));
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

        /** The close code of a socket whose session ended: the page must not connect again with it. */
        public static final int SESSION_ENDED = 4401;

        /** How often the sessions of the pages are read again, for the ends of other kernels. */
        public static final String CHECK_EVERY = "5s";

        /**
         * A page connected to the channel.
         *
         * @param session the session of the kernel it was opened with, if any (MK-125)
         */
        record Page(
                String connection,
                UUID account,
                Optional<UUID> session,
                Optional<UUID> organization,
                boolean guest,
                Set<String> topics) {}

        private final Map<String, Page> pages = new ConcurrentHashMap<>();
        private final OpenConnections connections;
        private final ObjectMapper json;
        private final TeamService teams;
        private final SessionRegistry sessions;

        public LivePages(
                OpenConnections connections,
                ObjectMapper json,
                LiveBus bus,
                TeamService teams,
                SessionRegistry sessions) {
            this.teams = teams;
            this.connections = connections;
            this.json = json;
            this.sessions = sessions;
            bus.listen(this::deliver);
            sessions.onEnd(this::ended);
        }

        void open(String connection, UUID account, Optional<UUID> session, Optional<UUID> organization, boolean guest) {
            pages.put(
                    connection,
                    new Page(connection, account, session, organization, guest, ConcurrentHashMap.newKeySet()));
        }

        Optional<Page> get(String connection) {
            return Optional.ofNullable(pages.get(connection));
        }

        void close(String connection) {
            pages.remove(connection);
        }

        /** The accounts with at least one open page, for the presence (MK-033). */
        public Set<UUID> accountsOnline() {
            return pages.values().stream().map(Page::account).collect(Collectors.toSet());
        }

        /** Closes the pages of the sessions this kernel just ended, before another event reaches them. */
        void ended(SessionRegistry.Ended end) {
            List<Page> closing =
                    pages.values().stream().filter(page -> endedBy(end, page)).toList();
            closing.forEach(this::end);
        }

        private boolean endedBy(SessionRegistry.Ended end, Page page) {
            if (end.session() != null) {
                return page.session().filter(end.session()::equals).isPresent();
            }
            if (!page.account().equals(end.accountId())) {
                return false;
            }
            if (end.organizationId() == null) {
                // A suspension: every page of the account, whatever opened it.
                return true;
            }
            // The removal from an organization: the pages in it, and those whose session it ended.
            return page.organization().filter(end.organizationId()::equals).isPresent()
                    || page.session()
                            .filter(id -> sessions.liveAmong(Set.of(id)).isEmpty())
                            .isPresent();
        }

        /** Closes the pages whose session another kernel ended, or that expired. */
        @Scheduled(every = CHECK_EVERY, delayed = CHECK_EVERY, concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
        void closeEndedSessions() {
            Set<UUID> open = pages.values().stream()
                    .flatMap(page -> page.session().stream())
                    .collect(Collectors.toSet());
            if (open.isEmpty()) {
                return;
            }
            Set<UUID> live = sessions.liveAmong(open);
            pages.values().stream()
                    .filter(page ->
                            page.session().filter(id -> !live.contains(id)).isPresent())
                    .toList()
                    .forEach(this::end);
        }

        private void end(Page page) {
            pages.remove(page.connection());
            connections
                    .findByConnectionId(page.connection())
                    .ifPresent(connection -> connection
                            .close(new CloseReason(SESSION_ENDED, "The session ended"))
                            .subscribe()
                            .with(closed -> {}, failure -> {
                                // The page went away by itself.
                            }));
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
            if (pages.get(page.connection()) != page) {
                // Closed meanwhile, such as when its session ended.
                return;
            }
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

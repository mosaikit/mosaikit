// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * A mail server that greets and then never answers: the registration answers 503 within {@code
 * mosaikit.accounts.mail-timeout}, not 500 when the transaction times out, and the account stays, so
 * that the link can be asked for again once the server works.
 */
@QuarkusTest
@TestProfile(StuckMailServerTest.StuckServer.class)
@Tag("MK-048")
class StuckMailServerTest {

    static final String ORGANIZATION = "stuck-mail-town";
    static final String PASSWORD = "a long enough password";

    /** A real mail client, sending to the port of {@link Smtp}, with a short timeout. */
    public static class StuckServer implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            int port;
            try (var socket = new ServerSocket(0, 50, InetAddress.getLoopbackAddress())) {
                port = socket.getLocalPort();
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
            return Map.of(
                    "mosaikit.accounts.confirm-email", "true",
                    "mosaikit.accounts.mail-timeout", "6s",
                    // A new connection for each mail, so that the connections the tests make stuck
                    // are the ones each mail uses.
                    "quarkus.mailer.keep-alive", "false",
                    "quarkus.mailer.mock", "false",
                    "quarkus.mailer.host", "127.0.0.1",
                    "quarkus.mailer.port", String.valueOf(port),
                    "quarkus.mailer.start-tls", "DISABLED",
                    // The first mail would otherwise look up the name of this computer, slow on some.
                    "quarkus.mailer.own-host-name", "localhost");
        }
    }

    static Smtp smtp;

    @ConfigProperty(name = "quarkus.mailer.port")
    int port;

    @BeforeEach
    void open() {
        if (smtp == null) {
            smtp = new Smtp(port);
        }
        smtp.mails.clear();
        asAdmin()
                .body(Map.of("registration", true))
                .put("/api/v1/platform/settings")
                .then()
                .statusCode(200);
        asAdmin()
                .body(Map.of("slug", ORGANIZATION, "name", "Stuck Mail Town", "selfRegistration", true))
                .post("/api/v1/organizations");
    }

    @AfterAll
    static void close() throws IOException {
        if (smtp != null) {
            smtp.server.close();
        }
    }

    @Test
    void aStuckMailServerAnswers503InTimeAndTheLinkCanBeAskedForAgain() {
        smtp.answering = false;
        String email = unique("stuck") + "@example.org";
        long started = System.nanoTime();
        anonymous()
                .body(Map.of(
                        "organization", ORGANIZATION, "email", email, "displayName", "Green", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(503)
                .body("detail", containsString("Ask for the link again"));
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(15));
        assertThat(smtp.mails).isEmpty();

        // The account stays, not confirmed: it cannot sign in, and cannot be registered twice.
        as(email, PASSWORD).get("/api/v1/accounts/me").then().statusCode(401);
        anonymous()
                .body(Map.of(
                        "organization", ORGANIZATION, "email", email, "displayName", "Green", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(409);

        // Once the mail server works, the person asks for the link again and signs in.
        smtp.answering = true;
        anonymous()
                .body(Map.of("email", email))
                .post("/api/v1/accounts/confirmations/requests")
                .then()
                .statusCode(202);
        assertThat(smtp.mails).hasSize(1);
        Matcher link = RegistrationTest.LINK.matcher(smtp.mails.getFirst());
        assertThat(link.find()).as("a link in %s", smtp.mails.getFirst()).isTrue();
        anonymous()
                .body(Map.of("token", link.group(1)))
                .post("/api/v1/accounts/confirmations")
                .then()
                .statusCode(204);
        as(email, PASSWORD).get("/api/v1/accounts/me").then().statusCode(200);
    }

    @Test
    void aConnectionThatHangsAfterTheGreetingIsTriedOnceMoreOnAnotherOne() {
        smtp.answering = true;
        smtp.stuckConnections.set(1);
        int before = smtp.connections.get();
        String email = unique("retry") + "@example.org";
        long started = System.nanoTime();
        anonymous()
                .body(Map.of("organization", ORGANIZATION, "email", email, "displayName", "Acme", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(202);
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(6));
        assertThat(smtp.stuckConnections.get())
                .as("the first connection was the stuck one")
                .isLessThanOrEqualTo(0);
        assertThat(smtp.connections.get() - before).isEqualTo(2);
        assertThat(smtp.mails).hasSize(1);
        Matcher link = RegistrationTest.LINK.matcher(smtp.mails.getFirst());
        assertThat(link.find()).isTrue();
        anonymous()
                .body(Map.of("token", link.group(1)))
                .post("/api/v1/accounts/confirmations")
                .then()
                .statusCode(204);
        as(email, PASSWORD).get("/api/v1/accounts/me").then().statusCode(200);
    }

    @Test
    void askingForTheLinkAgainAnswers503InTimeWhileTheMailServerIsStuck() {
        smtp.answering = true;
        String email = unique("again") + "@example.org";
        anonymous()
                .body(Map.of("organization", ORGANIZATION, "email", email, "displayName", "Acme", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(202);

        smtp.answering = false;
        long started = System.nanoTime();
        anonymous()
                .body(Map.of("email", email))
                .post("/api/v1/accounts/confirmations/requests")
                .then()
                .statusCode(503);
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(15));
    }

    /**
     * A mail server on the loopback: it greets every connection; while {@link #answering} is false
     * it then reads the commands and never answers them, otherwise it takes every mail. The next
     * {@link #stuckConnections} connections never answer, whatever {@link #answering} says. The bodies
     * of the mails taken are in {@link #mails}, quoted-printable soft breaks joined.
     */
    static final class Smtp {

        final ServerSocket server;
        final List<String> mails = new CopyOnWriteArrayList<>();
        volatile boolean answering;
        final AtomicInteger stuckConnections = new AtomicInteger();
        final AtomicInteger connections = new AtomicInteger();

        Smtp(int port) {
            try {
                server = new ServerSocket(port, 50, InetAddress.getLoopbackAddress());
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
            Thread.ofVirtual().start(() -> {
                while (!server.isClosed()) {
                    try {
                        Socket socket = server.accept();
                        connections.incrementAndGet();
                        boolean stuck = stuckConnections.getAndDecrement() > 0;
                        Thread.ofVirtual().start(() -> serve(socket, stuck));
                    } catch (IOException e) {
                        return;
                    }
                }
            });
        }

        private void serve(Socket socket, boolean stuck) {
            try (socket) {
                var in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                OutputStream out = socket.getOutputStream();
                reply(out, "220 localhost test mail server");
                StringBuilder data = null;
                String line;
                while ((line = in.readLine()) != null) {
                    // A command read while not answering stays without a reply, even on a connection
                    // that the client keeps open for the next mail.
                    if (stuck || !answering) {
                        continue;
                    }
                    if (data != null) {
                        if (line.equals(".")) {
                            mails.add(data.toString().replace("=\n", "").replace("=3D", "="));
                            data = null;
                            reply(out, "250 OK");
                        } else {
                            data.append(line).append('\n');
                        }
                        continue;
                    }
                    String command =
                            line.length() < 4 ? line : line.substring(0, 4).toUpperCase();
                    switch (command) {
                        case "EHLO" -> reply(out, "250-localhost\r\n250 8BITMIME");
                        case "DATA" -> {
                            data = new StringBuilder();
                            reply(out, "354 End data with <CR><LF>.<CR><LF>");
                        }
                        case "QUIT" -> {
                            reply(out, "221 Bye");
                            return;
                        }
                        default -> reply(out, "250 OK");
                    }
                }
            } catch (IOException e) {
                // The client went away.
            }
        }

        private static void reply(OutputStream out, String line) throws IOException {
            out.write((line + "\r\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
        }
    }
}

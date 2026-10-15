// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.ExtensionDependencyTest.BASE;
import static dev.mosaikit.kernel.app.ExtensionDependencyTest.CATALOG;
import static dev.mosaikit.kernel.app.ExtensionDependencyTest.EXTENSIONS;
import static dev.mosaikit.kernel.app.ExtensionDependencyTest.VIEWER;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.nullValue;

import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.app.PresenceProbe.Received;
import dev.mosaikit.kernel.core.events.PlatformEventDispatcher;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.live.LiveBus;
import dev.mosaikit.kernel.core.live.LiveEvent;
import dev.mosaikit.kernel.core.live.LiveTopics;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * An extension knows whether another one is present and active in an organization, and is told when
 * it changes (MK-133): the {@code ExtensionPresence} bean answers in the organization of the request,
 * the shell reads the same list, and installing, updating, removing and turning an extension off or on
 * raise events of the platform for the subscribed backends and events of the real-time channel for
 * the open pages. It shares the kernel of {@link ExtensionDependencyTest}, whose extensions have only
 * apps, so that each operation takes effect at once.
 */
@QuarkusTest
@TestProfile(ExtensionDependencyTest.Catalog.class)
@Tag("MK-133")
class ExtensionPresenceTest {

    static final String PASSWORD = "a long enough password";
    static final String ABSENT = "dev.mosaikit.test.absent";
    static final Duration WAIT = Duration.ofSeconds(30);

    @Inject
    ExtensionRegistry registry;

    @Inject
    PlatformEventDispatcher dispatcher;

    @Inject
    LiveBus bus;

    private final List<LiveEvent> live = new CopyOnWriteArrayList<>();

    @AfterEach
    void uninstallEverything() throws IOException {
        try (Stream<Path> files = Files.list(EXTENSIONS)) {
            for (Path file :
                    files.filter(path -> path.toString().endsWith(".zip")).toList()) {
                Files.delete(file);
            }
        }
        registry.reload();
    }

    @Test
    void answersInTheOrganizationOfTheRequestAndTellsEveryChange() {
        bus.listen(event -> {
            if (LiveTopics.EXTENSIONS.equals(event.topic())) {
                live.add(event);
            }
        });
        String green = organization();
        String acme = organization();
        UUID greenId = id(green);
        String ada = person(green);
        String bob = person(acme);
        install(VIEWER, "1.0.0");

        // Any extension asks about any other: not installed, it is only absent.
        ask(ada, green, BASE).body("active", equalTo(false)).body("version", nullValue());
        ask(ada, green, ABSENT).body("active", equalTo(false)).body("version", nullValue());
        ask(ada, green, VIEWER).body("active", equalTo(true)).body("version", equalTo("1.0.0"));

        install(BASE, "1.0.0");
        ask(ada, green, BASE).body("active", equalTo(true)).body("version", equalTo("1.0.0"));
        activeInShell(ada, green).body("find { it.id == '" + BASE + "' }.version", equalTo("1.0.0"));
        Received installed = await(greenId, PlatformEvents.EXTENSION_ACTIVATED, BASE, "installed");
        assertThat(installed.event().payload())
                .containsEntry("version", "1.0.0")
                .containsEntry("active", true);
        assertThat(installed.currentOrganization()).isEqualTo(greenId);
        assertThat(installed.activeInHandler()).isTrue();
        awaitLive(greenId, BASE, "installed");

        // Turned off in one organization: absent there, still active in the other.
        apps(green, false);
        ask(ada, green, BASE).body("active", equalTo(false)).body("version", nullValue());
        activeInShell(ada, green).body("find { it.id == '" + BASE + "' }", nullValue());
        ask(bob, acme, BASE).body("active", equalTo(true));
        await(greenId, PlatformEvents.EXTENSION_DEACTIVATED, BASE, "disabled");
        awaitLive(greenId, BASE, "disabled");

        apps(green, true);
        ask(ada, green, BASE).body("active", equalTo(true));
        await(greenId, PlatformEvents.EXTENSION_ACTIVATED, BASE, "enabled");
        awaitLive(greenId, BASE, "enabled");

        install(BASE, "2.0.0");
        ask(ada, green, BASE).body("version", equalTo("2.0.0"));
        Received updated = await(greenId, PlatformEvents.EXTENSION_ACTIVATED, BASE, "updated");
        assertThat(updated.event().payload())
                .containsEntry("version", "2.0.0")
                .containsEntry("previousVersion", "1.0.0");
        awaitLive(greenId, BASE, "updated");

        // Removed: told where it was active, not where the organization had turned it off.
        UUID acmeId = id(acme);
        apps(acme, false);
        asAdmin().delete("/api/v1/extensions/{id}", BASE).then().statusCode(200);
        ask(ada, green, BASE).body("active", equalTo(false));
        Received removed = await(greenId, PlatformEvents.EXTENSION_DEACTIVATED, BASE, "removed");
        assertThat(removed.event().payload()).containsEntry("version", "2.0.0").containsEntry("active", false);
        awaitLive(greenId, BASE, "removed");
        assertThat(received(acmeId, PlatformEvents.EXTENSION_DEACTIVATED, BASE, "removed"))
                .isEmpty();
        assertThat(live)
                .noneMatch(event -> event.organization().equals(acmeId)
                        && "removed".equals(data(event).get("reason")));
    }

    @Test
    void answersAboutTheInstallationWithoutAnOrganization() {
        install(BASE, "1.0.0");
        asAdmin()
                .get("/api/v1/test/presence/{extension}", BASE)
                .then()
                .statusCode(200)
                .body("active", equalTo(true))
                .body("version", equalTo("1.0.0"));
        asAdmin().get("/api/v1/shell/extensions/active").then().statusCode(200).body("id", equalTo(List.of(BASE)));
        anonymous().get("/api/v1/shell/extensions/active").then().statusCode(401);
    }

    private static void install(String id, String version) {
        asAdmin()
                .body(Map.of("source", CATALOG.toUri().toString(), "id", id, "version", version))
                .post("/api/v1/marketplace/installations")
                .then()
                .statusCode(202);
    }

    private static String organization() {
        String slug = unique("presence");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static UUID id(String slug) {
        return UUID.fromString(
                asAdmin().get("/api/v1/organizations/{slug}", slug).path("id"));
    }

    private static String person(String organization) {
        String email = unique("presence") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    private static io.restassured.response.ValidatableResponse ask(
            String person, String organization, String extension) {
        return in(person, organization)
                .get("/api/v1/test/presence/{extension}", extension)
                .then()
                .statusCode(200);
    }

    private static io.restassured.response.ValidatableResponse activeInShell(String person, String organization) {
        return in(person, organization)
                .get("/api/v1/shell/extensions/active")
                .then()
                .statusCode(200);
    }

    /** Turns the app of the base extension on or off in an organization. */
    private static void apps(String organization, boolean on) {
        asAdmin()
                .body(List.of(Map.of(
                        "extensionId", BASE, "appId", "base", "enabled", on, "pinned", false, "roles", List.of())))
                .put("/api/v1/organizations/{slug}/apps", organization)
                .then()
                .statusCode(200);
    }

    private List<Received> received(UUID organization, String type, String extension, String reason) {
        return PresenceProbe.RECEIVED.stream()
                .filter(found -> found.event().organization().equals(organization)
                        && found.event().type().equals(type)
                        && extension.equals(found.event().text("extension"))
                        && reason.equals(found.event().text("reason")))
                .toList();
    }

    /** Delivers what is due until the subscriber received a matching event. */
    private Received await(UUID organization, String type, String extension, String reason) {
        Instant end = Instant.now().plus(WAIT);
        while (Instant.now().isBefore(end)) {
            CompletableFuture.supplyAsync(() -> dispatcher.dispatch(Instant.now()))
                    .join();
            Optional<Received> found =
                    received(organization, type, extension, reason).stream().findFirst();
            if (found.isPresent()) {
                return found.get();
            }
            pause();
        }
        throw new AssertionError("No " + type + " of " + extension + " (" + reason + ") reached the subscriber");
    }

    /** Waits for the event of the real-time channel of an organization. */
    private void awaitLive(UUID organization, String extension, String reason) {
        Instant end = Instant.now().plus(WAIT);
        while (Instant.now().isBefore(end)) {
            if (live.stream()
                    .anyMatch(event -> event.organization().equals(organization)
                            && event.audience() == null
                            && extension.equals(data(event).get("extension"))
                            && reason.equals(data(event).get("reason")))) {
                return;
            }
            pause();
        }
        throw new AssertionError("No live event of " + extension + " (" + reason + ")");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> data(LiveEvent event) {
        return event.data() instanceof Map<?, ?> map ? (Map<String, Object>) map : Map.of();
    }

    private static void pause() {
        try {
            Thread.sleep(100);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}

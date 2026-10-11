// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import jakarta.enterprise.context.ApplicationScoped;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Collection;
import java.util.Objects;
import java.util.Optional;

/**
 * Creates the Keycloak realm of a new organization (MK-018) from {@code realm-template.json}: the
 * public client of the kernel UI with PKCE, the {@code organization-admin} role and, when asked,
 * a first manager with a temporary password. The realm is named after the organization slug.
 */
@ApplicationScoped
public class RealmProvisioning {

    /** Realm role of the managers of an organization. */
    public static final String ORGANIZATION_ADMIN_ROLE = "organization-admin";

    private static final String TEMPLATE = "realm-template.json";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final KeycloakAdministration keycloak;
    private final KernelConfig.Identity config;
    private final ObjectMapper json;

    public RealmProvisioning(KeycloakAdministration keycloak, KernelConfig config, ObjectMapper json) {
        this.keycloak = keycloak;
        this.config = config.identity();
        this.json = json;
    }

    /** A first manager to create in the realm. */
    public record Manager(String email, String firstName, String lastName) {}

    /**
     * Creates the realm.
     *
     * @param realm realm name, the slug of the organization
     * @param displayName name of the organization, shown on the sign-in page
     * @param redirectUris addresses of the kernel UI, such as {@code https://acme.example.org/*}
     * @param manager first manager, if any
     * @return the temporary password of the manager, if one was created
     * @throws ServiceUnavailableException if the kernel cannot administer Keycloak
     */
    public Optional<String> create(
            String realm, String displayName, Collection<String> redirectUris, Optional<Manager> manager) {
        if (!keycloak.available()) {
            throw new ServiceUnavailableException(
                    "The kernel cannot create realms: set mosaikit.identity.keycloak-url and mosaikit.identity.admin.");
        }
        ObjectNode template = template();
        template.put("realm", realm).put("displayName", displayName);
        ObjectNode client = (ObjectNode) template.withArray("clients").get(0);
        client.put("clientId", config.clientId());
        ArrayNode uris = client.putArray("redirectUris");
        redirectUris.forEach(uris::add);

        Optional<String> password = manager.map(found -> addManager(template, found));
        keycloak.createRealm(template);
        return password;
    }

    /** Deletes a realm created by {@link #create}, when the organization could not be saved. */
    public void undo(String realm) {
        keycloak.deleteRealm(realm);
    }

    private static String addManager(ObjectNode realm, Manager manager) {
        String password = temporaryPassword();
        ObjectNode user = realm.putArray("users").addObject();
        user.put("username", manager.email().toLowerCase(java.util.Locale.ROOT))
                .put("email", manager.email())
                .put("emailVerified", true)
                .put("enabled", true)
                .put("firstName", manager.firstName())
                .put("lastName", manager.lastName());
        // A temporary credential alone is not enough in a realm import: the action is explicit.
        user.putArray("requiredActions").add("UPDATE_PASSWORD");
        user.putArray("credentials")
                .addObject()
                .put("type", "password")
                .put("value", password)
                .put("temporary", true);
        user.putArray("realmRoles")
                .add("default-roles-" + realm.path("realm").asText())
                .add(ORGANIZATION_ADMIN_ROLE);
        return password;
    }

    private ObjectNode template() {
        try (InputStream in =
                Objects.requireNonNull(RealmProvisioning.class.getResourceAsStream(TEMPLATE), "missing " + TEMPLATE)) {
            return (ObjectNode) json.readTree(in);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read " + TEMPLATE, e);
        }
    }

    private static String temporaryPassword() {
        byte[] bytes = new byte[15];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}

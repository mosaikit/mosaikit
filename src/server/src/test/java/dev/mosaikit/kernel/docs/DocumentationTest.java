// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.docs;

import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.config.KernelConfig;
import io.quarkus.test.junit.QuarkusTest;
import io.smallrye.config.ConfigMappings;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * The reference parts of the documentation follow the code (ADR-0023): every endpoint of the
 * kernel is in the API guide, and every setting of the kernel is in the configuration guide.
 */
@QuarkusTest
class DocumentationTest {

    private static final Path DOCS = Path.of("..", "..", "docs");
    private static final Pattern DOCUMENTED =
            Pattern.compile("`((?:GET|POST|PUT|DELETE|PATCH)(?:, (?:GET|POST|PUT|DELETE|PATCH))*) (/[^`\\s]*)`");

    @Test
    void describesEveryEndpointOfTheKernel() throws IOException {
        Set<String> documented = new TreeSet<>();
        Matcher matcher = DOCUMENTED.matcher(Files.readString(DOCS.resolve("development/api.md")));
        while (matcher.find()) {
            for (String method : matcher.group(1).split(", ")) {
                documented.add(method + " " + matcher.group(2).replaceFirst("\\?.*", ""));
            }
        }
        JsonNode openApi = new ObjectMapper()
                .readTree(given().queryParam("format", "json").get("/q/openapi").asString());
        Set<String> served = new TreeSet<>();
        for (Iterator<String> paths = openApi.path("paths").fieldNames(); paths.hasNext(); ) {
            String path = paths.next();
            if (path.startsWith("/api/v1/test/") || path.startsWith("/api/v1/p/")) {
                continue; // resources of the tests, and APIs of plugins, documented by the plugins
            }
            openApi.path("paths").path(path).fieldNames().forEachRemaining(method -> {
                if (Set.of("get", "post", "put", "delete", "patch").contains(method)) {
                    served.add(method.toUpperCase(Locale.ROOT) + " " + path);
                }
            });
        }

        assertThat(served).as("endpoints missing from docs/development/api.md").isSubsetOf(documented);
        assertThat(documented).as("documented endpoints that do not exist").isSubsetOf(served);
    }

    @Test
    void describesEverySettingOfTheKernel() throws IOException {
        String guide = Files.readString(DOCS.resolve("guide/configuration.md"));
        Set<String> missing = new TreeSet<>();
        for (String property : ConfigMappings.getProperties(
                        ConfigMappings.ConfigClass.configClass(KernelConfig.class, "mosaikit"))
                .keySet()) {
            String name = property.replace("[*]", "");
            if (!guide.contains("`" + name + "`")) {
                missing.add(name);
            }
        }
        assertThat(missing)
                .as("settings missing from docs/guide/configuration.md")
                .isEmpty();
    }
}

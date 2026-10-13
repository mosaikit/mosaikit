// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.docs;

import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.config.KernelConfig;
import io.quarkus.test.junit.QuarkusTest;
import io.smallrye.config.ConfigMappings;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * The reference parts of the documentation follow the code (ADR-0023): every endpoint of the
 * kernel is in the API guide, and every setting of the kernel is in the configuration guide.
 *
 * <p>The table of the endpoints of docs/development/api.md is generated from the OpenAPI document of
 * the kernel ({@link ApiTable}): when it is not up to date the test fails and names the command that
 * rewrites it, {@value #REWRITE}.
 */
@QuarkusTest
class DocumentationTest {

    static final String REWRITE = "./mvnw -pl sdk/java,src/server test -Dskip.npm -Dtest=DocumentationTest"
            + " -Dsurefire.failIfNoSpecifiedTests=false -Ddocs.write=true";

    private static final Path DOCS = Path.of("..", "..", "docs");
    private static final Path API = DOCS.resolve("development/api.md");
    private static final Pattern DOCUMENTED =
            Pattern.compile("`((?:GET|POST|PUT|DELETE|PATCH)(?:, (?:GET|POST|PUT|DELETE|PATCH))*) (/[^`\\s]*)`");

    @Test
    void theTableOfEndpointsFollowsTheKernel() throws IOException {
        String page = Files.readString(API);
        String expected = ApiTable.rewrite(page, served());
        if (expected.equals(page)) {
            return;
        }
        if (Boolean.getBoolean("docs.write")) {
            Files.writeString(API, expected);
            return;
        }
        List<String> now = List.of(page.split("\n"));
        List<String> next = List.of(expected.split("\n"));
        StringBuilder diff = new StringBuilder();
        next.stream()
                .filter(line -> !now.contains(line))
                .forEach(line -> diff.append("\n+ ").append(line));
        now.stream()
                .filter(line -> !next.contains(line))
                .forEach(line -> diff.append("\n- ").append(line));
        fail("docs/development/api.md does not follow the endpoints of the kernel. Rewrite its table with\n  "
                + REWRITE
                + "\nthen complete the rows it added (who may call the endpoint, what it does)."
                + (diff.isEmpty() ? "\nThe rows are not in order." : "\nRows that change:" + diff));
    }

    @Test
    void everyEndpointNamedInTheApiGuideExists() throws IOException {
        String page = Files.readString(API);
        if (Boolean.getBoolean("docs.write")) {
            page = ApiTable.rewrite(page, served()); // whichever test runs first
        }
        Set<String> documented = new TreeSet<>();
        Matcher matcher = DOCUMENTED.matcher(page);
        while (matcher.find()) {
            for (String method : matcher.group(1).split(", ")) {
                documented.add(method + " " + matcher.group(2).replaceFirst("\\?.*", ""));
            }
        }
        Set<String> served = new TreeSet<>();
        served().forEach(operation -> served.add(operation.method() + " " + operation.path()));

        assertThat(served).as("endpoints missing from docs/development/api.md").isSubsetOf(documented);
        assertThat(documented)
                .as("endpoints named in docs/development/api.md, in the table or in the text, that do not exist")
                .isSubsetOf(served);
    }

    /** The operations of the kernel, without the resources of the tests and the APIs of extensions. */
    private static List<ApiTable.Operation> served() throws IOException {
        JsonNode openApi = new ObjectMapper()
                .readTree(given().queryParam("format", "json").get("/q/openapi").asString());
        List<ApiTable.Operation> served = new ArrayList<>();
        for (Iterator<String> paths = openApi.path("paths").fieldNames(); paths.hasNext(); ) {
            String path = paths.next();
            if (path.startsWith("/api/v1/test/") || path.startsWith("/api/v1/ext/")) {
                continue; // resources of the tests, and APIs of extensions, documented by the extensions
            }
            openApi.path("paths").path(path).fields().forEachRemaining(entry -> {
                String method = entry.getKey().toUpperCase(Locale.ROOT);
                if (ApiTable.METHODS.contains(method)) {
                    served.add(operation(method, path, entry.getValue()));
                }
            });
        }
        return served;
    }

    private static ApiTable.Operation operation(String method, String path, JsonNode operation) {
        String access = operation.path("x-mosaikit-access").asText("");
        if (access.isBlank()) {
            JsonNode security = operation.path("security");
            List<String> roles = new ArrayList<>();
            security.forEach(
                    requirement -> requirement.forEach(scopes -> scopes.forEach(role -> roles.add(role.asText()))));
            access = ApiTable.access(roles, !security.isMissingNode() && !security.isEmpty());
        }
        return new ApiTable.Operation(
                method, path, access, operation.path("summary").asText(""));
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

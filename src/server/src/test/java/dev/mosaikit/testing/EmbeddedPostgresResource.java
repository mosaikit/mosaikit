// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.testing;

import io.quarkus.test.common.QuarkusTestResource;
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import java.util.Map;

/**
 * The database of every {@code @QuarkusTest}: an {@link EmbeddedPostgres} started before the kernel,
 * instead of Dev Services, which need Docker. Being on a class of the test sources, the annotation
 * applies to all tests.
 */
@QuarkusTestResource(EmbeddedPostgresResource.class)
public class EmbeddedPostgresResource implements QuarkusTestResourceLifecycleManager {

    private EmbeddedPostgres server;

    @Override
    public Map<String, String> start() {
        server = EmbeddedPostgres.start();
        return Map.of(
                "quarkus.datasource.jdbc.url", server.createDatabase("mosaikit"),
                "quarkus.datasource.username", EmbeddedPostgres.USER,
                "quarkus.datasource.password", EmbeddedPostgres.PASSWORD);
    }

    @Override
    public void stop() {
        if (server != null) {
            server.close();
            server = null;
        }
    }
}

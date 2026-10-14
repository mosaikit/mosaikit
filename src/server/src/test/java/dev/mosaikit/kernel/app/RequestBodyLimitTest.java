// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static org.assertj.core.api.Assertions.assertThat;

import io.quarkus.test.common.http.TestHTTPResource;
import io.quarkus.test.junit.QuarkusTest;
import io.vertx.core.json.JsonObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * A request body over {@code quarkus.http.limits.max-body-size} is refused with 413 as a problem detail
 * that names the limit (#115). The request declares a body of 1 GB and sends a few bytes, as a client
 * does before the server stops it; a raw socket keeps the test from writing the whole body.
 */
@QuarkusTest
@Tag("MK-010")
class RequestBodyLimitTest {

    @TestHTTPResource("/")
    URL server;

    @Test
    void refusesABodyOverTheLimitWithAProblemDetailNamingIt() throws IOException {
        String response = post("/api/v1/organizations", 1_073_741_824L);

        String[] parts = response.split("\r\n\r\n", 2);
        String head = parts[0].toLowerCase(Locale.ROOT);
        assertThat(head).startsWith("http/1.1 413").contains("content-type: application/problem+json");
        JsonObject problem = new JsonObject(parts[1]);
        assertThat(problem.getInteger("status")).isEqualTo(413);
        assertThat(problem.getString("title")).isEqualTo("Content too large");
        assertThat(problem.getString("detail"))
                .contains("quarkus.http.limits.max-body-size")
                .contains("10485760 bytes");
    }

    @Test
    void letsABodyWithinTheLimitThrough() throws IOException {
        String response = post("/api/v1/organizations", 2);

        assertThat(response).startsWith("HTTP/1.1 401");
    }

    private String post(String path, long declaredLength) throws IOException {
        try (Socket socket = new Socket(server.getHost(), server.getPort())) {
            socket.setSoTimeout(10_000);
            String request = "POST " + path + " HTTP/1.1\r\n"
                    + "Host: " + server.getHost() + ":" + server.getPort() + "\r\n"
                    + "Content-Type: application/json\r\n"
                    + "Content-Length: " + declaredLength + "\r\n"
                    + "Connection: close\r\n\r\n{}";
            socket.getOutputStream().write(request.getBytes(StandardCharsets.US_ASCII));
            socket.getOutputStream().flush();
            return read(socket.getInputStream());
        }
    }

    private static String read(InputStream in) throws IOException {
        var out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int n;
        while ((n = in.read(buffer)) > 0) {
            out.write(buffer, 0, n);
        }
        return out.toString(StandardCharsets.UTF_8);
    }
}

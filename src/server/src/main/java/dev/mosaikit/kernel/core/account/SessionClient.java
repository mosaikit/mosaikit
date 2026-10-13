// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import io.vertx.core.http.HttpServerRequest;
import io.vertx.core.net.SocketAddress;
import io.vertx.ext.web.RoutingContext;

/**
 * The browser or client that opened a session, as people see it in their list of sessions (MK-125).
 *
 * @param userAgent the {@code User-Agent} header, shortened, or {@code null}
 * @param address the address of the client as the kernel sees it (behind a proxy, with {@code
 *     quarkus.http.proxy.proxy-address-forwarding}), or {@code null}
 */
public record SessionClient(String userAgent, String address) {

    static final int MAX_USER_AGENT = 300;
    static final int MAX_ADDRESS = 64;

    /** A client the kernel knows nothing about. */
    public static final SessionClient UNKNOWN = new SessionClient(null, null);

    public SessionClient {
        userAgent = shorten(userAgent, MAX_USER_AGENT);
        address = shorten(address, MAX_ADDRESS);
    }

    /** The client of a request. */
    public static SessionClient of(RoutingContext routing) {
        return routing == null ? UNKNOWN : of(routing.request());
    }

    /** The client of a request. */
    public static SessionClient of(HttpServerRequest request) {
        if (request == null) {
            return UNKNOWN;
        }
        SocketAddress remote = request.remoteAddress();
        return new SessionClient(request.getHeader("User-Agent"), remote == null ? null : remote.hostAddress());
    }

    private static String shorten(String value, int max) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String trimmed = value.strip();
        return trimmed.length() <= max ? trimmed : trimmed.substring(0, max);
    }
}

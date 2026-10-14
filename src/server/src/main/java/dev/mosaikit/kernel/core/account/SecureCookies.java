// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.config.KernelConfig;
import io.vertx.core.http.HttpServerRequest;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/**
 * Whether a cookie of the kernel carries {@code Secure}. The scheme is the one Quarkus resolved for
 * the request: behind a reverse proxy that terminates TLS, the scheme of {@code X-Forwarded-Proto}
 * or {@code Forwarded} when {@code quarkus.http.proxy.proxy-address-forwarding} is on and the
 * proxy is trusted ({@code quarkus.http.proxy.trusted-proxies}), the scheme of the connection
 * otherwise, so that a client that reaches the kernel directly cannot choose it. {@code
 * mosaikit.accounts.secure-cookies=true} sets {@code Secure} whatever the scheme.
 */
@ApplicationScoped
public class SecureCookies {

    private final boolean always;

    @Inject
    public SecureCookies(KernelConfig config) {
        this(config.accounts().secureCookies());
    }

    SecureCookies(boolean always) {
        this.always = always;
    }

    /** Whether the cookies set in the answer to this request carry {@code Secure}. */
    public boolean secure(HttpServerRequest request) {
        return secure(request == null ? null : request.scheme());
    }

    /** Whether cookies set for a request with this scheme, as Quarkus resolved it, carry {@code Secure}. */
    boolean secure(String scheme) {
        return always || "https".equalsIgnoreCase(scheme);
    }
}

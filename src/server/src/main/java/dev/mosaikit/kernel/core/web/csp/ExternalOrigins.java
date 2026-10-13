// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web.csp;

import java.net.IDN;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * What the kernel accepts as an external origin of the content security policy (MK-128): a scheme
 * ({@code https}, {@code wss}, {@code http} or {@code ws}), a host and an optional port, nothing
 * else. The host is a DNS name or an IPv4 address; one leading {@code *.} stands for every
 * sub-domain of a name of at least two labels ({@code https://*.tiles.example.org}, never {@code
 * https://*.org}). No path, query, user, other wildcard, keyword such as {@code 'unsafe-inline'},
 * scheme alone ({@code https:}), {@code data:} nor {@code blob:}: each could open the policy to far
 * more than one service, or let a value end the directive and add another.
 */
public final class ExternalOrigins {

    /** Longest origin, as stored. */
    public static final int MAX_LENGTH = 300;

    private static final Set<String> SCHEMES = Set.of("https", "wss", "http", "ws");
    private static final Pattern ORIGIN = Pattern.compile("([a-z]+)://(\\*\\.)?([a-z0-9.-]+)(?::([0-9]{1,5}))?/?");
    private static final Pattern LABEL = Pattern.compile("[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?");
    private static final Pattern IPV4 = Pattern.compile("[0-9]{1,3}(\\.[0-9]{1,3}){3}");

    private ExternalOrigins() {}

    /**
     * The origin in its normal form: in lower case, without a trailing slash, and without the default
     * port of its scheme.
     *
     * @return empty when it is not an origin the policy accepts
     */
    public static Optional<String> normalize(String origin) {
        if (origin == null || origin.isBlank() || origin.length() > MAX_LENGTH) {
            return Optional.empty();
        }
        String ascii;
        try {
            ascii = origin.trim().toLowerCase(Locale.ROOT);
            int hostStart = ascii.indexOf("://");
            if (hostStart > 0) {
                // A name in another script is written in ASCII (punycode), as browsers compare it.
                ascii = ascii.substring(0, hostStart + 3) + IDN.toASCII(ascii.substring(hostStart + 3));
            }
        } catch (IllegalArgumentException _) {
            return Optional.empty();
        }
        Matcher matcher = ORIGIN.matcher(ascii);
        if (!matcher.matches() || !SCHEMES.contains(matcher.group(1))) {
            return Optional.empty();
        }
        String scheme = matcher.group(1);
        boolean wildcard = matcher.group(2) != null;
        String host = matcher.group(3);
        if (!validHost(host, wildcard)) {
            return Optional.empty();
        }
        String port = matcher.group(4);
        if (port != null) {
            int number = Integer.parseInt(port);
            if (number < 1 || number > 65_535) {
                return Optional.empty();
            }
            boolean usual = (number == 443 && (scheme.equals("https") || scheme.equals("wss")))
                    || (number == 80 && (scheme.equals("http") || scheme.equals("ws")));
            port = usual ? null : String.valueOf(number);
        }
        return Optional.of(scheme + "://" + (wildcard ? "*." : "") + host + (port == null ? "" : ":" + port));
    }

    private static boolean validHost(String host, boolean wildcard) {
        if (host.length() > 253 || host.startsWith(".") || host.endsWith(".")) {
            return false;
        }
        if (IPV4.matcher(host).matches()) {
            if (wildcard) {
                return false;
            }
            for (String part : host.split("\\.")) {
                if (Integer.parseInt(part) > 255) {
                    return false;
                }
            }
            return true;
        }
        String[] labels = host.split("\\.", -1);
        for (String label : labels) {
            if (!LABEL.matcher(label).matches()) {
                return false;
            }
        }
        // A name of digits only would be an address; a wildcard covers sub-domains of a name of at
        // least two labels.
        boolean numeric = labels[labels.length - 1].chars().allMatch(Character::isDigit);
        return !numeric && (!wildcard || labels.length >= 2);
    }
}

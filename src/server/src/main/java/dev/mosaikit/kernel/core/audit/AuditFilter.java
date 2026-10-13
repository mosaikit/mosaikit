// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import dev.mosaikit.kernel.core.error.InvalidInputException;
import jakarta.ws.rs.DefaultValue;
import jakarta.ws.rs.QueryParam;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/** The filters of a list of the audit log, from the query string (MK-059). */
public class AuditFilter {

    @QueryParam("actor")
    String actor;

    @QueryParam("action")
    String action;

    @QueryParam("subject")
    String subject;

    @QueryParam("channel")
    String channel;

    @QueryParam("from")
    String from;

    @QueryParam("to")
    String to;

    @QueryParam("offset")
    @DefaultValue("0")
    int offset;

    @QueryParam("limit")
    @DefaultValue("100")
    int limit;

    /** The query for the entries of one organization, of every one, or of the platform. */
    AuditQuery query(Optional<UUID> organization, boolean platform) {
        List<String> problems = new ArrayList<>();
        AuditEvent.Channel parsedChannel = null;
        if (text(channel) != null) {
            try {
                parsedChannel = AuditEvent.Channel.valueOf(
                        channel.trim().toUpperCase(Locale.ROOT).replace('-', '_'));
            } catch (IllegalArgumentException _) {
                problems.add("channel must be one of " + List.of(AuditEvent.Channel.values()));
            }
        }
        Instant parsedFrom = time("from", from, problems);
        Instant parsedTo = time("to", to, problems);
        if (offset < 0) {
            problems.add("offset must not be negative");
        }
        if (!problems.isEmpty()) {
            throw new InvalidInputException(problems);
        }
        return new AuditQuery(
                organization,
                platform,
                text(actor),
                text(action),
                text(subject),
                parsedChannel,
                parsedFrom,
                parsedTo,
                offset,
                limit);
    }

    private static Instant time(String name, String value, List<String> problems) {
        if (text(value) == null) {
            return null;
        }
        try {
            return Instant.parse(value.trim());
        } catch (DateTimeParseException _) {
            problems.add(name + " must be a time such as 2026-10-13T08:00:00Z");
            return null;
        }
    }

    /** The value, or null when it is missing or blank. */
    private static String text(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}

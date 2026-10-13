// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.UUID;

/**
 * The hash chain of the audit log (MK-059). Each organization has one chain, and the platform one
 * for the entries without organization. The hash of an entry is the SHA-256 of its canonical
 * content, which includes its position and the hash of the entry before it: changing, removing or
 * inserting an entry breaks the chain from that position on. The migration V20 computes the same
 * hash in SQL ({@code audit_entry_hash}) for the entries written before.
 *
 * <p>The canonical content is {@code mosaikit-audit-v1} followed, for each field, by a new line and
 * either {@code ~} for null or the length of the value in UTF-8 bytes, {@code :} and the value. The
 * fields are, in order: id, position, organization, time in microseconds since the epoch, channel,
 * actor, action, object, outcome, details, hash of the previous entry.
 */
public final class AuditChain {

    /** The chain of the entries without organization, the platform ones. */
    public static final UUID PLATFORM = new UUID(0, 0);

    /** The hash before the first entry of a chain. */
    public static final String GENESIS = "0".repeat(64);

    private static final String VERSION = "mosaikit-audit-v1";

    private AuditChain() {}

    /** The chain of an organization, or of the platform for none. */
    static UUID of(UUID organization) {
        return organization == null ? PLATFORM : organization;
    }

    /** The precision of the times kept by the database, at which they are hashed. */
    static Instant truncate(Instant time) {
        return time.truncatedTo(ChronoUnit.MICROS);
    }

    /** The hash of an entry, from its content and the hash of the entry before it. */
    static String hash(AuditEvent entry) {
        Instant at = entry.getOccurredAt();
        long micros = Math.addExact(Math.multiplyExact(at.getEpochSecond(), 1_000_000L), at.getNano() / 1000L);
        StringBuilder canonical = new StringBuilder(VERSION);
        for (String field : new String[] {
            entry.getId().toString(),
            Long.toString(entry.getChainIndex()),
            entry.getOrganizationId().map(UUID::toString).orElse(null),
            Long.toString(micros),
            entry.getChannel().name(),
            entry.getActor(),
            entry.getAction(),
            entry.getSubject().orElse(null),
            entry.getOutcome().name(),
            entry.getDetail().orElse(null),
            entry.getPreviousHash()
        }) {
            canonical.append('\n');
            if (field == null) {
                canonical.append('~');
            } else {
                canonical
                        .append(field.getBytes(StandardCharsets.UTF_8).length)
                        .append(':')
                        .append(field);
            }
        }
        return sha256(canonical.toString());
    }

    private static String sha256(String text) {
        try {
            return HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("Every Java runtime has SHA-256", e);
        }
    }
}

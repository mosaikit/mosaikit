// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.audit;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * The audit log of the organization (MK-059): an extension records the sensitive actions it performs,
 * such as an export, a deletion or a change of settings, in the same tamper-evident log the kernel
 * writes, instead of keeping its own. The administrators of the organization read, filter and verify
 * it in one place.
 *
 * <p>The kernel provides this bean to extensions. Each entry is written for the organization of the
 * request ({@link dev.mosaikit.kernel.api.context.CurrentOrganization}), with the person of the request
 * as actor ({@code system} when the request has no person), the time of the kernel and the channel
 * {@code EXTENSION}; the extension says the action, its object and optional details. The entry is
 * written in its own transaction: it is kept even when the transaction of the caller rolls back, so
 * that a failed or refused attempt can be recorded too. Entries are never changed nor deleted, except
 * by the retention the administrators set.
 *
 * <p><strong>The caller names its extension.</strong> All Java extensions run in the same process, so
 * the calling extension names itself in every call, as {@code Notifications.send} does. The kernel
 * checks that it is an active extension and refuses any other name with
 * {@link IllegalArgumentException}. The action is recorded as {@code <extension>:<action>}, such as
 * {@code dev.example.dashboards:dashboard.exported}, so that administrators find the entries of an
 * extension by that prefix.
 *
 * <p><strong>API preview</strong>: the kernel implements it with MK-059.
 */
public interface AuditLog {

    /** Longest object of an entry. */
    int MAX_OBJECT = 255;

    /** Longest action, extension identifier and {@code :} included. */
    int MAX_QUALIFIED_ACTION = 100;

    /** Longest details, as JSON. */
    int MAX_DETAILS = 8192;

    /** How the action ended. */
    enum Outcome {
        /** It was done. */
        SUCCEEDED,
        /** It was attempted and failed. */
        FAILED,
        /** It was refused, for example for lack of a permission. */
        DENIED
    }

    /**
     * What an extension records.
     *
     * @param action stable name of what was done, such as {@code dashboard.exported}: lowercase
     *     letters, digits, '.' and '-', starting with a letter
     * @param object what it was done to, such as {@code dashboard/42}, at most {@value #MAX_OBJECT}
     *     characters, or {@code null}
     * @param outcome how it ended
     * @param details more about it, such as the format of an export, written as JSON, at most
     *     {@value #MAX_DETAILS} characters once written; empty or {@code null} for none. Never put
     *     secrets or personal data the administrators may not read.
     */
    record Entry(String action, String object, Outcome outcome, Map<String, ?> details) {

        private static final Pattern ACTION = Pattern.compile("^[a-z][a-z0-9.-]{0,63}$");

        /**
         * Checks the entry.
         *
         * @throws IllegalArgumentException when the action, the object or the outcome are not valid
         */
        public Entry {
            if (action == null || !ACTION.matcher(action).matches()) {
                throw new IllegalArgumentException(
                        "The action must be lowercase letters, digits, '.' and '-', such as dashboard.exported");
            }
            if (object != null && (object.isBlank() || object.length() > MAX_OBJECT)) {
                throw new IllegalArgumentException("The object must be at most " + MAX_OBJECT + " characters");
            }
            if (outcome == null) {
                throw new IllegalArgumentException("The outcome is required");
            }
            details = details == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(details));
        }

        /** An action that succeeded, on an object, without details. */
        public static Entry of(String action, String object) {
            return new Entry(action, object, Outcome.SUCCEEDED, Map.of());
        }
    }

    /**
     * Records an entry in the audit log of the organization of the request, as the given extension.
     *
     * @param extension identifier of the calling extension
     * @throws IllegalArgumentException when the extension is not active, or the action, with its
     *     extension, is longer than {@value #MAX_QUALIFIED_ACTION} characters, or the details are too long
     * @throws dev.mosaikit.kernel.api.context.NoOrganizationException when the request has no
     *     organization
     */
    void record(String extension, Entry entry);
}

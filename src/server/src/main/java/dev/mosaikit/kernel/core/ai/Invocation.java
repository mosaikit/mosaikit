// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * The outcome of invoking a tool or confirming a draft.
 *
 * @param outcome {@code executed} when the plugin was called, {@code drafted} when the person must
 *     confirm first
 * @param result what the plugin answered, when it was called
 * @param draft the draft, when there is one
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record Invocation(String outcome, PluginResponse result, DraftView draft) {

    public static final String EXECUTED = "executed";
    public static final String DRAFTED = "drafted";

    static Invocation executed(PluginResponse result, DraftView draft) {
        return new Invocation(EXECUTED, result, draft);
    }

    static Invocation drafted(DraftView draft) {
        return new Invocation(DRAFTED, null, draft);
    }

    /** Whether the person must confirm before anything happens. */
    @JsonIgnore
    public boolean isDrafted() {
        return DRAFTED.equals(outcome);
    }
}

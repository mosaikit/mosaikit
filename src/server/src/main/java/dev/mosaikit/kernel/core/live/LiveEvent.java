// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.live;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * An event of the real-time channel (MK-031).
 *
 * @param topic what it is about, such as {@code documents.<plugin>.<collection>}
 * @param organization the organization whose pages may receive it
 * @param audience the accounts that receive it, or {@code null} for every member of the organization,
 *     but not its guests (MK-032)
 * @param team the team whose members only receive it, or {@code null} (MK-032)
 * @param data the content, as a JSON object
 */
public record LiveEvent(String topic, UUID organization, List<UUID> audience, UUID team, Object data) {

    /** An event for some accounts of an organization, or for all its members. */
    public LiveEvent(String topic, UUID organization, List<UUID> audience, Object data) {
        this(topic, organization, audience, null, data);
    }

    /**
     * Whether a page of an account in an organization receives the event.
     *
     * @param guest whether the account is only a guest of the organization
     * @param team the accounts of the team of the event, when it has one
     */
    public boolean reaches(UUID organization, UUID account, boolean guest, Set<UUID> team) {
        if (!this.organization.equals(organization)) {
            return false;
        }
        if (this.team != null) {
            return team.contains(account);
        }
        return audience == null ? !guest : audience.contains(account);
    }
}

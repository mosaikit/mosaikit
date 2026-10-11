// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.activity;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.live.Notifications;
import dev.mosaikit.kernel.core.account.AccountService;
import dev.mosaikit.kernel.core.apps.AppSettings;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.live.LiveBus;
import dev.mosaikit.kernel.core.live.LiveEvent;
import dev.mosaikit.kernel.core.live.LiveTopics;
import dev.mosaikit.kernel.core.plugin.PluginRegistry;
import jakarta.data.Limit;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * The activity feed of people (MK-038): notifications that plugins send to people of their
 * organization, kept in the feed, pushed on the real-time channel and left out for the people who
 * turned their kind off.
 */
@ApplicationScoped
@Transactional
public class ActivityService implements Notifications {

    static final Pattern KIND = Pattern.compile("^[a-z][a-z0-9-]{0,63}$");
    static final Pattern LINK = Pattern.compile("^/(?!/)[A-Za-z0-9/_.~?=&%-]{0,499}$");
    private static final int MAX_FEED = 100;

    private final NotificationRepository notifications;
    private final CurrentOrganization organization;
    private final AccountService accounts;
    private final PluginRegistry registry;
    private final LiveBus live;
    private final AppSettings apps;
    private final Clock clock;

    @Inject
    public ActivityService(
            NotificationRepository notifications,
            CurrentOrganization organization,
            AccountService accounts,
            PluginRegistry registry,
            LiveBus live,
            AppSettings apps) {
        this(notifications, organization, accounts, registry, live, apps, Clock.systemUTC());
    }

    ActivityService(
            NotificationRepository notifications,
            CurrentOrganization organization,
            AccountService accounts,
            PluginRegistry registry,
            LiveBus live,
            AppSettings apps,
            Clock clock) {
        this.apps = apps;
        this.notifications = notifications;
        this.organization = organization;
        this.accounts = accounts;
        this.registry = registry;
        this.live = live;
        this.clock = clock;
    }

    @Override
    public void send(String pluginId, Collection<UUID> addressees, Notification notification) {
        UUID org = organization.require();
        List<String> problems = new ArrayList<>();
        if (registry.findActive(pluginId).isEmpty()) {
            problems.add("plugin " + pluginId + " is not an active plugin");
        } else if (apps.isOff(org, pluginId)) {
            throw new ForbiddenOperationException("The plugin is turned off for your organization.");
        }
        if (notification.kind() == null || !KIND.matcher(notification.kind()).matches()) {
            problems.add("kind must be lowercase letters, digits and '-', such as mention");
        }
        if (notification.title() == null
                || notification.title().isBlank()
                || notification.title().length() > 200) {
            problems.add("title must be one line of at most 200 characters");
        }
        String body = notification.body() == null ? "" : notification.body();
        if (body.length() > 1000) {
            problems.add("body must be at most 1000 characters");
        }
        if (notification.link() != null && !LINK.matcher(notification.link()).matches()) {
            problems.add("link must be a path of the shell, such as /app/notes");
        }
        if (!problems.isEmpty()) {
            throw new InvalidInputException(problems);
        }
        String muted = pluginId + "/" + notification.kind();
        Instant now = Instant.now(clock);
        for (UUID account : addressees) {
            if (!accounts.isMemberOf(account, org) || accounts.mutes(account, muted)) {
                continue;
            }
            var stored = new dev.mosaikit.kernel.core.activity.Notification(
                    org,
                    account,
                    pluginId,
                    notification.kind(),
                    notification.title().strip(),
                    body,
                    notification.link(),
                    now);
            notifications.insert(stored);
            live.publish(new LiveEvent(
                    LiveTopics.NOTIFICATIONS,
                    org,
                    List.of(account),
                    Map.of("id", stored.getId().toString(), "title", stored.getTitle())));
        }
    }

    /** Notifies people by email address: for frontend plugins, which do not know account identifiers. */
    public void sendToAddresses(String pluginId, Collection<String> emails, Notification notification) {
        UUID org = organization.require();
        List<UUID> addressees = new ArrayList<>();
        for (String email : emails) {
            accounts.idIn(email, org).ifPresent(addressees::add);
        }
        send(pluginId, addressees, notification);
    }

    /** The latest notifications of a person in the organization of the request, newest first. */
    public List<NotificationView> feed(UUID account) {
        return notifications.feed(account, organization.require(), Limit.of(MAX_FEED)).stream()
                .map(NotificationView::of)
                .toList();
    }

    public long unread(UUID account) {
        return notifications.unread(account, organization.require());
    }

    /** Marks a notification of the person as read. */
    public void markRead(UUID account, UUID id) {
        var notification = notifications
                .findById(id)
                .filter(found -> found.getAccountId().equals(account))
                .orElseThrow(() -> new ResourceNotFoundException("No such notification."));
        notification.markRead(Instant.now(clock));
        notifications.update(notification);
    }

    /** Marks every notification of the person in the organization of the request as read. */
    public void markAllRead(UUID account) {
        Instant now = Instant.now(clock);
        for (var notification : notifications.feed(account, organization.require(), Limit.of(1000))) {
            if (notification.getReadAt() == null) {
                notification.markRead(now);
                notifications.update(notification);
            }
        }
    }
}

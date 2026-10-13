// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.apps;

import dev.mosaikit.kernel.api.extension.Contribution;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ExtensionManifests;
import dev.mosaikit.kernel.api.extension.PermissionEntry;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The permission that opens each app (MK-030 on MK-056, ADR-0038): every app that an extension adds
 * to the app bar has one, {@code use-<app>}, which the kernel declares for the extension next to the
 * permissions of its manifest. While the organization shows an app to everyone the permission does
 * not matter; when it limits the app to the people who hold its permission, profiles, teams and
 * personal exceptions grant it like any other, and the administrators of the organization hold it.
 */
public final class AppPermissions {

    /** The prefix of the permission of an app. */
    public static final String PREFIX = "use-";

    private static final int MAX_NAME = 48;

    private AppPermissions() {}

    /**
     * The name of the permission of an app, {@code use-} and the identifier of the app in lowercase,
     * with any character other than letters, digits and {@code -} as {@code -}, at most 48 characters.
     */
    public static String nameOf(String appId) {
        String clean = appId.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9-]", "-");
        String name = PREFIX + clean;
        return name.length() > MAX_NAME ? name.substring(0, MAX_NAME) : name;
    }

    /**
     * The permissions of the apps of a manifest, in the order of its contributions, without those
     * whose name the manifest already declares: a declared permission of the same name is the one
     * that counts, with its title.
     */
    public static List<PermissionEntry> of(ExtensionManifest manifest) {
        Set<String> declared = new HashSet<>();
        manifest.permissions().forEach(entry -> declared.add(entry.name()));
        List<PermissionEntry> found = new ArrayList<>();
        for (String point : AppSettings.POINTS) {
            for (Contribution contribution : manifest.contributionsTo(point)) {
                if (!(contribution.attributes().get("route") instanceof String)) {
                    continue;
                }
                String name = nameOf(contribution.id());
                if (!ExtensionManifests.PERMISSION_PATTERN.matcher(name).matches() || !declared.add(name)) {
                    continue;
                }
                String title = contribution.attributes().get("title") instanceof String text ? text : contribution.id();
                found.add(new PermissionEntry(
                        name,
                        "Use " + title,
                        "Opens the app " + title + " when the organization shows it only to the people who hold"
                                + " its permission.",
                        Map.of()));
            }
        }
        return found;
    }

    /** The app whose permission this is, when it is the permission of an app of the manifest. */
    public static Optional<String> appOf(ExtensionManifest manifest, String permission) {
        if (!permission.startsWith(PREFIX)
                || manifest.permissions().stream()
                        .anyMatch(entry -> entry.name().equals(permission))) {
            return Optional.empty();
        }
        for (String point : AppSettings.POINTS) {
            for (Contribution contribution : manifest.contributionsTo(point)) {
                if (contribution.attributes().get("route") instanceof String
                        && nameOf(contribution.id()).equals(permission)) {
                    return Optional.of(contribution.id());
                }
            }
        }
        return Optional.empty();
    }

    /**
     * The permissions of a manifest as the kernel grants them: those it declares and those of its
     * apps.
     */
    public static List<PermissionEntry> withApps(ExtensionManifest manifest) {
        List<PermissionEntry> all = new ArrayList<>(manifest.permissions());
        all.addAll(of(manifest));
        return all;
    }
}

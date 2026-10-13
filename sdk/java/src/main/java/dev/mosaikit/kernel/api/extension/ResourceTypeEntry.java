// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import dev.mosaikit.kernel.api.sharing.SubjectKind;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * A type of resource that an extension registers with the kernel (MK-054) and shares (MK-055), such
 * as {@code dashboard}.
 *
 * @param type identifier within the extension, such as {@code dashboard}
 * @param title short human readable name of the type, such as {@code Dashboard}
 * @param levels the levels at which a resource of the type is shared, from the lowest to the
 *     highest; each includes those before it, and the owner has the last one
 * @param subjects the kinds of subjects a resource of the type may be shared with
 * @param i18n {@code title} in other languages, by language tag (MK-053)
 */
public record ResourceTypeEntry(
        String type,
        String title,
        List<SharingLevelEntry> levels,
        Set<SubjectKind> subjects,
        Map<String, Map<String, String>> i18n) {

    public ResourceTypeEntry {
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(title, "title");
        levels = List.copyOf(levels);
        if (levels.isEmpty()) {
            throw new IllegalArgumentException("a resource type has at least one level");
        }
        subjects = Set.copyOf(subjects);
        i18n = Translations.copy(i18n);
    }

    /** The names of the levels, from the lowest to the highest. */
    public List<String> levelNames() {
        return levels.stream().map(SharingLevelEntry::name).toList();
    }

    /** Whether the type declares this level. */
    public boolean declares(String level) {
        return levelNames().contains(level);
    }

    /**
     * Whether a level includes another: {@code edit} includes {@code view} when {@code view} comes
     * first. A level that the type does not declare includes nothing and is included by nothing.
     */
    public boolean includes(String level, String other) {
        List<String> names = levelNames();
        int rank = names.indexOf(level);
        int otherRank = names.indexOf(other);
        return rank >= 0 && otherRank >= 0 && rank >= otherRank;
    }

    /** Whether a resource of the type may be shared with this kind of subject. */
    public boolean accepts(SubjectKind kind) {
        return subjects.contains(kind);
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * A type of resource that an extension registers with the kernel (MK-054) and shares (MK-055), such
 * as {@code dashboard}.
 *
 * <p>Links and the public reach people outside the organization, so they get little: the public
 * always gets the lowest level of the type, and a link gets at most {@link #linkLevel()}, which is the
 * lowest level unless the manifest raises it, never to a level that {@link SharingLevelEntry#edits()
 * edits}. A link always expires, within a longest validity set by the installation.
 *
 * <p>An update of the extension that removes a type or a level on which grants exist is refused by the
 * kernel, with the list of those grants ({@link ExtensionManifest#sharingRemovedBy}).
 *
 * @param type identifier within the extension, such as {@code dashboard}
 * @param title short human readable name of the type, such as {@code Dashboard}
 * @param levels the levels at which a resource of the type is shared, from the lowest to the
 *     highest; each includes those before it, and the owner has the last one
 * @param subjects the kinds of subjects a resource of the type may be shared with
 * @param linkLevel the highest level a link may give, such as {@code use}; {@code null} for the lowest
 *     level
 * @param i18n {@code title} in other languages, by language tag (MK-053)
 */
public record ResourceTypeEntry(
        String type,
        String title,
        List<SharingLevelEntry> levels,
        Set<SubjectKind> subjects,
        String linkLevel,
        Map<String, Map<String, String>> i18n) {

    /**
     * Checks the entry.
     *
     * @throws IllegalArgumentException when there is no level, a level that does not edit comes after
     *     one that edits, or the link level is not declared or edits
     */
    public ResourceTypeEntry {
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(title, "title");
        levels = List.copyOf(levels);
        if (levels.isEmpty()) {
            throw new IllegalArgumentException("a resource type has at least one level");
        }
        if (!editingLevelsLast(levels)) {
            throw new IllegalArgumentException("the levels that edit come after those that do not");
        }
        subjects = Set.copyOf(subjects);
        if (linkLevel == null) {
            linkLevel = levels.getFirst().name();
        }
        String link = linkLevel;
        SharingLevelEntry raised = levels.stream()
                .filter(level -> level.name().equals(link))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("the link level is not a level of the type"));
        if (raised.edits()) {
            throw new IllegalArgumentException("a link never gives a level that edits");
        }
        i18n = Translations.copy(i18n);
    }

    /** Whether every level that edits comes after every level that does not. */
    static boolean editingLevelsLast(List<SharingLevelEntry> levels) {
        boolean editing = false;
        for (SharingLevelEntry level : levels) {
            if (editing && !level.edits()) {
                return false;
            }
            editing = level.edits();
        }
        return true;
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

    /**
     * The highest level a subject of this kind may be given: the lowest level for the public, the
     * {@link #linkLevel()} for a link, the highest level for people, groups and the organization.
     */
    public String highestLevelFor(SubjectKind kind) {
        return switch (kind) {
            case PUBLIC -> levels.getFirst().name();
            case LINK -> linkLevel;
            case PERSON, GROUP, ORGANIZATION -> levels.getLast().name();
        };
    }

    /**
     * Whether a subject of this kind may be given this level: the type accepts the kind, declares the
     * level, and the level is not above {@link #highestLevelFor} the kind.
     */
    public boolean grantable(SubjectKind kind, String level) {
        return accepts(kind) && declares(level) && includes(highestLevelFor(kind), level);
    }
}

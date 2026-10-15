// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.resource;

import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;

/**
 * Free tags on the resources of extensions (MK-097): people label the resources of any extension
 * with their own words, and the lists of every extension filter by those labels with the same
 * suggestions. The kernel keeps the tags next to the {@link Resource entry} of the registry
 * ({@link Resources}), so a resource is tagged once it is registered, and its tags go with it when it
 * is removed.
 *
 * <p>The kernel provides this bean to extensions. Every method acts on the organization of the
 * request and joins the transaction of the caller. As in {@link Resources}, the calling extension
 * names itself in the reference or as the {@code extension} argument, and only an active extension
 * that declares the type in {@code resources} of its manifest reads and writes its tags; any other
 * reference is refused with {@link IllegalArgumentException}.
 *
 * <p><strong>Form.</strong> A tag is stored {@link #normalize normalized}: trimmed, its inner spaces
 * collapsed to one, in lowercase. A resource has each tag at most once and at most
 * {@value #MAX_PER_RESOURCE} tags; a tag has at most {@value #MAX_LENGTH} characters.
 *
 * <p><strong>Who sees them.</strong> {@link #of}, {@link #attach}, {@link #replace} and
 * {@link #tagged} do not check sharing: they serve the extension, which answers a person only about
 * the resources {@link dev.mosaikit.kernel.api.sharing.Sharing} lets them read. {@link #suggest}
 * draws only from the resources the request may read, so that a tag never reveals a resource. The
 * kernel's REST API, {@code /api/v1/resources/tags}, applies the same rule for the frontends.
 */
public interface Tags {

    /** The most characters of a tag. */
    int MAX_LENGTH = 48;

    /** The most tags of a resource. */
    int MAX_PER_RESOURCE = 20;

    /** The most suggestions in one answer. */
    int MAX_SUGGESTIONS = 50;

    /**
     * A tag in the form the kernel stores it: trimmed, inner spaces collapsed to one, in lowercase.
     *
     * @throws IllegalArgumentException when the tag is blank, longer than {@value #MAX_LENGTH}
     *     characters, or holds a control character or a comma
     */
    static String normalize(String tag) {
        Objects.requireNonNull(tag, "tag");
        String normalized = tag.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        if (normalized.isEmpty() || normalized.length() > MAX_LENGTH) {
            throw new IllegalArgumentException("a tag must have 1 to " + MAX_LENGTH + " characters");
        }
        if (normalized.chars().anyMatch(c -> Character.isISOControl(c) || c == ',')) {
            throw new IllegalArgumentException("a tag cannot hold control characters or commas");
        }
        return normalized;
    }

    /**
     * Tags normalized, without duplicates, in alphabetical order.
     *
     * @throws IllegalArgumentException when a tag is not valid
     */
    static List<String> normalizeAll(Collection<String> tags) {
        Objects.requireNonNull(tags, "tags");
        Set<String> normalized = new TreeSet<>();
        for (String tag : tags) {
            normalized.add(normalize(tag));
        }
        return List.copyOf(normalized);
    }

    /**
     * The tags of a resource, in alphabetical order; empty when it has none.
     *
     * @throws NoSuchElementException when the resource is not registered in the organization
     */
    List<String> of(ResourceRef ref);

    /**
     * Adds tags to a resource, keeping those it has.
     *
     * @return every tag of the resource, in alphabetical order
     * @throws NoSuchElementException when the resource is not registered in the organization
     * @throws IllegalArgumentException when a tag is not valid, or the resource would have more than
     *     {@value #MAX_PER_RESOURCE} tags
     */
    List<String> attach(ResourceRef ref, Collection<String> tags);

    /**
     * Replaces the tags of a resource; an empty collection removes them all.
     *
     * @return every tag of the resource, in alphabetical order
     * @throws NoSuchElementException when the resource is not registered in the organization
     * @throws IllegalArgumentException when a tag is not valid, or there are more than
     *     {@value #MAX_PER_RESOURCE}
     */
    List<String> replace(ResourceRef ref, Collection<String> tags);

    /**
     * The identifiers of the resources of one type that carry any of the tags, for the list pages of
     * an extension, which filter their query with them. Sharing is not checked: intersect with
     * {@link dev.mosaikit.kernel.api.sharing.Sharing#visible}.
     *
     * @param extension identifier of the calling extension
     * @param type a resource type the extension declares
     * @param tags the tags, in any form; an empty collection finds nothing
     */
    Set<String> tagged(String extension, String type, Collection<String> tags);

    /**
     * The tags used in the organization that start with what a person is typing, on resources of any
     * extension that the request may read: the most used first, then in alphabetical order.
     *
     * @param prefix what was typed, in any form; empty for the most used tags
     * @param limit at most this many, up to {@value #MAX_SUGGESTIONS}
     */
    List<String> suggest(String prefix, int limit);
}

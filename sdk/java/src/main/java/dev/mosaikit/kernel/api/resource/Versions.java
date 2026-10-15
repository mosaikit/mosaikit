// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.resource;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.UUID;

/**
 * The version history of the resources of extensions (MK-096): each save of a resource keeps a
 * version with its author and time, and a person with edit rights opens an earlier version and
 * restores it as the current one. The kernel keeps the versions next to the {@link Resource entry} of
 * the registry ({@link Resources}), so a resource has versions once it is registered, and they go with
 * it when it is removed.
 *
 * <p>The kernel provides this bean to extensions. Every method acts on the organization of the
 * request and joins the transaction of the caller, so that a save and its version are written or
 * rolled back together. As in {@link Resources}, the calling extension names itself in the reference,
 * and only an active extension that declares the type in {@code resources} of its manifest keeps
 * versions of it; any other reference is refused with {@link IllegalArgumentException}. A documented
 * exception is thrown before anything is written and leaves the transaction of the caller usable.
 *
 * <p><strong>What a version holds.</strong> Either a snapshot that the kernel keeps, such as the JSON
 * of a dashboard, of at most {@value #MAX_SNAPSHOT} bytes, or a file that the extension stored with
 * {@link dev.mosaikit.kernel.api.files.FileStorage} (MK-041), for content too large for a snapshot. The
 * data of the resource stay in the extension: the version is a copy, and the extension decides what
 * it holds.
 *
 * <p><strong>A versioned resource</strong> is one whose extension calls {@link #save} every time it
 * saves it, after its own checks ({@link dev.mosaikit.kernel.api.sharing.Sharing#require}): {@link
 * #save} does not check sharing, so that a job or an import may save versions too. The author is the
 * person of the request, absent for code that runs without one.
 *
 * <p><strong>Who reads and restores.</strong> {@link #list} and {@link #open} need the request to hold a
 * level on the resource, the lowest of its type at least; {@link #restore} needs edit rights: the
 * lowest level of the type that {@link dev.mosaikit.kernel.api.extension.SharingLevelEntry#edits()
 * edits}, or its highest level when none edits. The levels inherited from the resources above count
 * (MK-136), and the administrators of the organization hold every level. A request without the level
 * gets {@link dev.mosaikit.kernel.api.permission.AccessDeniedException}, concealed when it holds no
 * level at all.
 *
 * <p><strong>Restoring</strong> does not rewrite the history: it saves a new version, the newest, with
 * the content of the restored one and {@link Version#restoredFrom()} naming it, and writes the restore
 * in the audit log (MK-059). The extension then makes that content its current data, in the same
 * transaction: the kernel does not hold the data of the resource.
 *
 * <p><strong>How many versions are kept</strong> follows the setting {@code
 * mosaikit.versions.max-per-resource} of the installation: a save that goes over it removes the oldest
 * versions of the resource, never the newest. A value below 1 is a mistake of configuration, and then
 * nothing is removed. A removed version that held a file is in {@link Saved#pruned()}: the file stays
 * the extension's, which deletes it when no longer needed; the kernel never deletes it.
 */
public interface Versions {

    /** The most bytes of a snapshot. */
    int MAX_SNAPSHOT = 1024 * 1024;

    /** The media type of a snapshot that does not name one. */
    String OCTET_STREAM = "application/octet-stream";

    /**
     * What a version holds: a snapshot kept by the kernel, or a file stored by the extension.
     *
     * @param mediaType the media type of the snapshot, such as {@code application/json}; of a file, the
     *     one it was stored with
     * @param snapshot the bytes of the snapshot, or {@code null} for a file
     * @param file the identifier of the stored file, or {@code null} for a snapshot
     */
    record Content(String mediaType, byte[] snapshot, UUID file) {

        /**
         * Checks the content.
         *
         * @throws IllegalArgumentException when it holds both a snapshot and a file, or neither, or
         *     the snapshot is larger than {@value #MAX_SNAPSHOT} bytes
         */
        public Content {
            if ((snapshot == null) == (file == null)) {
                throw new IllegalArgumentException("a version holds either a snapshot or a file");
            }
            if (snapshot != null && snapshot.length > MAX_SNAPSHOT) {
                throw new IllegalArgumentException("a snapshot has at most " + MAX_SNAPSHOT + " bytes");
            }
            if (mediaType == null || mediaType.isBlank()) {
                mediaType = OCTET_STREAM;
            }
        }

        /** A snapshot of the given media type; the bytes are not copied. */
        public static Content snapshot(String mediaType, byte[] bytes) {
            return new Content(mediaType, Objects.requireNonNull(bytes, "bytes"), null);
        }

        /** A snapshot in JSON. */
        public static Content json(String json) {
            return snapshot(
                    "application/json", Objects.requireNonNull(json, "json").getBytes(StandardCharsets.UTF_8));
        }

        /** A file that the extension stored with the file service of the kernel. */
        public static Content file(UUID file) {
            return new Content(null, null, Objects.requireNonNull(file, "file"));
        }

        /** Whether the version holds a file rather than a snapshot. */
        public boolean isFile() {
            return file != null;
        }

        /** The snapshot as text in UTF-8, such as JSON. */
        public String text() {
            if (snapshot == null) {
                throw new IllegalStateException("the version holds a file, not a snapshot");
            }
            return new String(snapshot, StandardCharsets.UTF_8);
        }
    }

    /**
     * A version of a resource, without its content ({@link #open}).
     *
     * @param id its identifier
     * @param resource the resource it is a version of
     * @param number its number among the versions of the resource, from 1, the newest the highest
     * @param author the account of the person who saved it, or {@code null} for code without a person
     * @param created when it was saved
     * @param mediaType the media type of its content
     * @param size the bytes of its content
     * @param file the stored file it holds, or {@code null} for a snapshot
     * @param restoredFrom the number of the version it restores, or {@code null} for a save
     */
    record Version(
            UUID id,
            ResourceRef resource,
            int number,
            UUID author,
            Instant created,
            String mediaType,
            long size,
            UUID file,
            Integer restoredFrom) {}

    /**
     * What a save did.
     *
     * @param version the version saved, the newest of the resource
     * @param pruned the versions removed to keep the configured number, oldest first; the files they
     *     held stay, for the extension to delete those it no longer needs
     */
    record Saved(Version version, List<Version> pruned) {

        public Saved {
            Objects.requireNonNull(version, "version");
            pruned = List.copyOf(pruned);
        }
    }

    /**
     * Saves a version of a resource, authored by the person of the request, as the newest. Sharing is
     * not checked: the extension saves after its own checks.
     *
     * @throws IllegalArgumentException when the type is not declared by the extension, or the file is
     *     not a file of the extension that the request reads
     * @throws NoSuchElementException when the resource is not registered in the organization
     */
    Saved save(ResourceRef ref, Content content);

    /**
     * The versions of a resource, newest first; empty when it has none.
     *
     * @throws NoSuchElementException when the resource is not registered in the organization
     * @throws dev.mosaikit.kernel.api.permission.AccessDeniedException when the request holds no level
     *     on it
     */
    List<Version> list(ResourceRef ref);

    /**
     * The content of a version of a resource.
     *
     * @throws NoSuchElementException when the resource is not registered, or has no such version
     * @throws dev.mosaikit.kernel.api.permission.AccessDeniedException when the request holds no level
     *     on it
     */
    Content open(ResourceRef ref, UUID version);

    /**
     * Restores a version of a resource as the current one: saves a new version with its content,
     * authored by the person of the request, and writes the restore in the audit log. The extension
     * then makes {@link #open the content} of the new version its current data.
     *
     * @return what the save of the new version did
     * @throws NoSuchElementException when the resource is not registered, or has no such version
     * @throws dev.mosaikit.kernel.api.permission.AccessDeniedException when the request has no edit
     *     rights on it
     */
    Saved restore(ResourceRef ref, UUID version);
}

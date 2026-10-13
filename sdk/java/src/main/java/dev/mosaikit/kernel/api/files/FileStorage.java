// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.files;

import dev.mosaikit.kernel.api.resource.ResourceRef;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.UUID;

/**
 * The file service of the kernel (MK-041, ADR-0029): an extension stores and reads files through it,
 * and never through the store of the installation, a directory or an S3-compatible bucket whose
 * credentials only the kernel holds. The content is streamed both ways, never held in memory.
 *
 * <p>The kernel provides this bean to extensions. Every method acts on the organization of the
 * request ({@link dev.mosaikit.kernel.api.context.CurrentOrganization}) and joins the transaction of
 * the caller when there is one, so that a file and the data that refer to it are recorded or rolled
 * back together; a file whose transaction rolls back leaves the store too. A refusal leaves the
 * transaction of the caller as it was.
 *
 * <p><strong>The caller names its extension.</strong> All Java extensions run in the same process, so
 * the calling extension names itself in every call, as {@code Resources} and
 * {@code Notifications.send} do. The kernel checks that it is an active extension; any other name is
 * refused with {@link IllegalArgumentException}. An extension sees only its own files.
 *
 * <p><strong>Rights.</strong> The kernel applies the rights of the person of the request, with the
 * same checks as its REST API ({@code /api/v1/files/<extension>}): a file is of the whole
 * organization or of one of its teams (MK-032); a person reads a file of their organization, and of a
 * team only when they are in it; a guest of the organization reads only the files of their teams and
 * stores files only for them. A file that the person may not read does not exist for them: an
 * identifier of another organization, or of a team they are not in, is not found. Code that runs
 * without a person, such as a job of the extension, acts for the organization: it reads the files of
 * the organization, not those of its teams.
 *
 * <p><strong>Limits.</strong> A file has at most the size the installation allows
 * ({@code mosaikit.files.max-size}); its name has 1 to {@value #MAX_NAME} characters and may be a path
 * such as {@code tiles/3/4/2.png}. Storing and deleting are recorded in the audit log.
 *
 * <p><strong>API preview</strong>: the kernel implements it with MK-041.
 */
public interface FileStorage {

    /** The longest name of a file. */
    int MAX_NAME = 255;

    /**
     * What an extension says of a file it stores.
     *
     * @param name its name, or a path such as {@code tiles/3/4/2.png} whose segments are neither
     *     empty nor {@code .} or {@code ..}
     * @param contentType its media type, such as {@code image/png}; {@code null} for {@code
     *     application/octet-stream}
     * @param team the team of the person to share it with, or {@code null} for the whole organization
     * @param resource a registered resource of the same extension that the file belongs to (MK-054),
     *     or {@code null}
     */
    record NewFile(String name, String contentType, UUID team, ResourceRef resource) {

        /** A file of the whole organization, not attached to a resource. */
        public static NewFile of(String name, String contentType) {
            return new NewFile(name, contentType, null, null);
        }

        /** The same file, shared with one team of the person only. */
        public NewFile forTeam(UUID team) {
            return new NewFile(name, contentType, team, resource);
        }

        /** The same file, attached to a registered resource of the extension. */
        public NewFile attachedTo(ResourceRef resource) {
            return new NewFile(name, contentType, team, resource);
        }
    }

    /**
     * Stores a file, owned by the person of the request. The content is read to its end, written to
     * the store, and its size and SHA-256 recorded; the stream is not closed.
     *
     * @param extension identifier of the calling extension
     * @throws IllegalArgumentException when the extension is not active, the name or the type are not
     *     valid, the resource is not a registered resource of the extension, the content is larger
     *     than the installation allows, or it cannot be read to its end
     * @throws NoSuchElementException when the team is not a team of the person
     * @throws SecurityException when a guest stores a file for the whole organization
     * @throws UncheckedIOException when the store cannot be reached
     */
    StoredFile store(String extension, NewFile file, InputStream content);

    /**
     * A file of the extension that the person of the request reads, if there is one.
     *
     * @param extension identifier of the calling extension
     */
    Optional<StoredFile> find(String extension, UUID id);

    /**
     * Opens the content of a file that the person of the request reads; the caller closes it.
     *
     * @param extension identifier of the calling extension
     * @throws NoSuchElementException when there is no such file, or the person may not read it
     * @throws UncheckedIOException when the store cannot give the content
     */
    FileContent read(String extension, UUID id);

    /**
     * The files of the extension that the person of the request reads, newest first: of the
     * organization and of their teams, or of one team of theirs.
     *
     * @param extension identifier of the calling extension
     * @param team a team of the person, or {@code null} for every file they read
     * @param offset how many files to skip
     * @param limit how many files at most, up to 500
     * @throws NoSuchElementException when the team is not a team of the person
     */
    List<StoredFile> list(String extension, UUID team, int offset, int limit);

    /**
     * Deletes a file: the person who stored it, an owner of its team or an administrator of the
     * organization may, and so may code that runs without a person. The content leaves the store when
     * the transaction commits.
     *
     * @param extension identifier of the calling extension
     * @throws NoSuchElementException when there is no such file, or the person may not read it
     * @throws SecurityException when the person reads the file but may not delete it
     */
    void delete(String extension, UUID id);
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.files.FileContent;
import dev.mosaikit.kernel.api.files.FileStorage;
import dev.mosaikit.kernel.api.files.StoredFile;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.ContentTooLargeException;
import dev.mosaikit.kernel.core.error.DomainException;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.resources.RegisteredResource;
import dev.mosaikit.kernel.core.resources.RegisteredResources;
import jakarta.enterprise.context.ApplicationScoped;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * The kernel's {@link FileStorage} bean (MK-041): the Java API of the file service for extensions,
 * on {@link FileService}, which applies the same checks as the REST API. The failures of the
 * service become the exceptions of the Java API.
 */
@ApplicationScoped
public class ExtensionFiles implements FileStorage {

    private final FileService files;
    private final ExtensionRegistry extensions;
    private final RegisteredResources resources;
    private final CurrentOrganization organization;

    public ExtensionFiles(
            FileService files,
            ExtensionRegistry extensions,
            RegisteredResources resources,
            CurrentOrganization organization) {
        this.files = files;
        this.extensions = extensions;
        this.resources = resources;
        this.organization = organization;
    }

    @Override
    public StoredFile store(String extension, NewFile file, InputStream content) {
        Objects.requireNonNull(file, "file");
        Objects.requireNonNull(content, "content");
        active(extension);
        FileView stored = call(() -> files.store(
                extension,
                new FileService.Upload(file.name(), file.contentType(), file.team(), file.resource()),
                content,
                OptionalLong.empty()));
        return view(stored, file.resource());
    }

    @Override
    public Optional<StoredFile> find(String extension, UUID id) {
        Objects.requireNonNull(id, "id");
        active(extension);
        try {
            return Optional.of(
                    views(List.of(call(() -> files.metadata(extension, id)))).getFirst());
        } catch (NoSuchElementException e) {
            return Optional.empty();
        }
    }

    @Override
    public FileContent read(String extension, UUID id) {
        Objects.requireNonNull(id, "id");
        active(extension);
        FileService.Content content = call(() -> files.content(extension, id));
        StoredFile file = views(List.of(content.file())).getFirst();
        InputStream stream = file.size() == 0
                ? InputStream.nullInputStream()
                : call(() -> content.open(ByteRange.whole(file.size())));
        return new FileContent(file, stream);
    }

    @Override
    public List<StoredFile> list(String extension, UUID team, int offset, int limit) {
        active(extension);
        return views(call(() -> files.list(extension, team, offset, limit)));
    }

    @Override
    public void delete(String extension, UUID id) {
        Objects.requireNonNull(id, "id");
        active(extension);
        call(() -> {
            files.delete(extension, id);
            return null;
        });
    }

    /** The calling extension must be active, as for the other beans of the kernel. */
    private void active(String extension) {
        Objects.requireNonNull(extension, "extension");
        if (extensions.findActive(extension).isEmpty()) {
            throw new IllegalArgumentException(extension + " is not an active extension.");
        }
    }

    /** The views of the API, with the references of their registered resources. */
    private List<StoredFile> views(List<FileView> found) {
        List<UUID> ids = found.stream()
                .map(FileView::resource)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, ResourceRef> refs = ids.isEmpty()
                ? Map.of()
                : resources.findByIds(organization.require(), ids).stream()
                        .collect(Collectors.toMap(RegisteredResource::getId, RegisteredResource::ref));
        return found.stream()
                .map(file -> view(file, file.resource() == null ? null : refs.get(file.resource())))
                .toList();
    }

    private static StoredFile view(FileView file, ResourceRef resource) {
        return new StoredFile(
                file.id(),
                file.extension(),
                file.name(),
                file.contentType(),
                file.size(),
                file.checksum(),
                file.owner(),
                file.team(),
                resource,
                file.createdAt(),
                file.updatedAt());
    }

    /** Calls the service, and gives its failures as the exceptions of the Java API. */
    static <T> T call(Supplier<T> work) {
        try {
            return work.get();
        } catch (DomainException e) {
            throw translated(e);
        }
    }

    static RuntimeException translated(DomainException e) {
        return switch (e) {
            case ResourceNotFoundException notFound -> new NoSuchElementException(notFound.getMessage());
            case InvalidInputException invalid -> new IllegalArgumentException(invalid.getMessage(), invalid);
            case ContentTooLargeException tooLarge -> new IllegalArgumentException(tooLarge.getMessage(), tooLarge);
            case ForbiddenOperationException forbidden -> new SecurityException(forbidden.getMessage(), forbidden);
            case ServiceUnavailableException unavailable ->
                new UncheckedIOException(new IOException(unavailable.getMessage(), unavailable));
            case ConflictException conflict -> new IllegalStateException(conflict.getMessage(), conflict);
        };
    }
}

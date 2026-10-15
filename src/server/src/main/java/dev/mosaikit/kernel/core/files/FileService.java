// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.ContentTooLargeException;
import dev.mosaikit.kernel.core.error.DomainException;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import dev.mosaikit.kernel.core.events.PlatformEventLog;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.quotas.Measure;
import dev.mosaikit.kernel.core.quotas.QuotaService;
import dev.mosaikit.kernel.core.resources.RegisteredResource;
import dev.mosaikit.kernel.core.resources.RegisteredResources;
import dev.mosaikit.kernel.core.sharing.KernelSharing;
import dev.mosaikit.kernel.core.sharing.ResourceTypes;
import dev.mosaikit.kernel.core.teams.TeamMember;
import dev.mosaikit.kernel.core.teams.TeamRepository;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.narayana.jta.TransactionExceptionResult;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.data.Limit;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Status;
import jakarta.transaction.Synchronization;
import jakarta.transaction.TransactionSynchronizationRegistry;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileAttribute;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.DigestOutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.function.IntConsumer;
import java.util.function.Supplier;
import java.util.regex.Pattern;
import org.jboss.logging.Logger;

/**
 * The file service of the kernel (MK-041, ADR-0029): extensions store and read files through it,
 * never through the store, whose credentials only the kernel holds. Every call acts on the
 * organization of the request, and a person reads a file only when it is of their organization and
 * either not of a team, or of a team they are in (MK-032): a guest reads only the files of their
 * teams. A file that the person may not read does not exist for them: an identifier of another
 * organization, or of a team they are not in, answers not found. The REST API and the Java API apply
 * the same checks, here.
 *
 * <p>A file attached to a registered resource (MK-054) follows the sharing of that resource instead
 * (MK-055): the person reads it when they hold any level on the resource, and replaces or deletes it
 * with a level that edits; the person who stored it keeps both, and so do the owner of the resource
 * and the administrators of the organization, except on the kernel's types private to their subjects
 * (ADR-0037). A request without a person, the code of an extension acting alone, keeps the rules of the
 * organization and its teams. The row-level security says the same ({@code V29}).
 *
 * <p>An upload is first written to a temporary file of the server, which gives its size and its
 * checksum without holding it in memory and refuses it beyond {@code mosaikit.files.max-size}; only
 * then is it put in the store, and recorded. Reads are streamed from the store, by range.
 *
 * <p>Files count to the storage quota of the organization (MK-076): an upload that does not fit is
 * refused before it reaches the store, and checked again, under a lock, when it is recorded.
 */
@ApplicationScoped
public class FileService {

    private static final Logger LOG = Logger.getLogger(FileService.class);

    /*
     * The temporary file of an upload is readable and writable by the kernel only: owner-only
     * permissions where the file system has them; elsewhere (Windows) the temporary directory is
     * the account's own.
     */
    private static final FileAttribute<?>[] PRIVATE =
            FileSystems.getDefault().supportedFileAttributeViews().contains("posix")
                    ? new FileAttribute<?>[] {
                        PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------"))
                    }
                    : new FileAttribute<?>[0];

    /**
     * The extension under which the kernel records the files it keeps for itself, such as the
     * branding of an organization (MK-074). Not an extension identifier, which has a dot: no extension
     * reads, lists or removes them.
     */
    public static final String KERNEL = "kernel";

    /** Longest name of a file. */
    static final int MAX_NAME = 255;

    /** Longest media type. */
    static final int MAX_TYPE = 255;

    /** Most files of one page of a list. */
    static final int MAX_PAGE = 500;

    static final String DEFAULT_TYPE = "application/octet-stream";

    private static final Pattern MEDIA_TYPE =
            Pattern.compile("^[a-zA-Z0-9][\\w!#$&^.+-]{0,126}/[a-zA-Z0-9][\\w!#$&^.+-]{0,126}(\\s*;.*)?$");

    /** What a caller says of a file it stores. */
    public record Upload(String name, String contentType, UUID team, ResourceRef resource) {}

    /** A file that the person may read, with its content to open. */
    public final class Content {

        private final FileView file;
        private final String key;

        Content(StoredFile stored) {
            this(FileView.of(stored), stored.getStorageKey());
        }

        /** A file found without the person of the request, such as through a signed link (MK-093). */
        Content(FileView file, String key) {
            this.file = file;
            this.key = key;
        }

        public FileView file() {
            return file;
        }

        /**
         * Opens a part of the content, streamed from the store: the caller closes the stream.
         *
         * @throws ServiceUnavailableException when the store cannot give it
         */
        public InputStream open(ByteRange range) {
            if (range.last() >= file.size()) {
                throw new IllegalArgumentException("The file " + file.id() + " has " + file.size() + " bytes.");
            }
            try {
                return store.read(key, range.first(), range.length());
            } catch (IOException e) {
                LOG.errorf("Cannot read the file %s from %s: %s", file.id(), store.describe(), e.getMessage());
                throw new ServiceUnavailableException("The content of the file " + file.id() + " cannot be read now.");
            }
        }
    }

    private final StoredFiles files;
    private final FileStore store;
    private final ExtensionRegistry extensions;
    private final RequestOrganization organization;
    private final TeamRepository teamMembers;
    private final RegisteredResources resources;
    private final SecurityIdentity identity;
    private final AuditLog audit;
    private final TransactionSynchronizationRegistry transactions;
    private final QuotaService quotas;
    private final KernelSharing sharing;
    private final PlatformEventLog events;
    private final long maxSize;
    private final Clock clock = Clock.systemUTC();

    @SuppressWarnings("java:S107") // the beans it needs
    public FileService(
            StoredFiles files,
            FileStore store,
            ExtensionRegistry extensions,
            RequestOrganization organization,
            TeamRepository teamMembers,
            RegisteredResources resources,
            SecurityIdentity identity,
            AuditLog audit,
            TransactionSynchronizationRegistry transactions,
            QuotaService quotas,
            KernelSharing sharing,
            PlatformEventLog events,
            KernelConfig config) {
        this.files = files;
        this.store = store;
        this.extensions = extensions;
        this.organization = organization;
        this.teamMembers = teamMembers;
        this.resources = resources;
        this.identity = identity;
        this.audit = audit;
        this.transactions = transactions;
        this.quotas = quotas;
        this.sharing = sharing;
        this.events = events;
        this.maxSize = config.files().maxSize().asLongValue();
    }

    /** The largest file, in bytes ({@code mosaikit.files.max-size}). */
    public long maxSize() {
        return maxSize;
    }

    /**
     * Checks the content of a file of the kernel before it is stored, such as that it is an image of
     * a known format, and gives its media type.
     */
    @FunctionalInterface
    public interface ContentCheck {

        /**
         * @param content the whole content, in a temporary file of the server
         * @return the media type of the content
         * @throws InvalidInputException when the content is not what the caller accepts
         */
        String check(Path content) throws IOException;
    }

    /**
     * Stores a file that the kernel keeps for itself in the organization of the request, such as the
     * logo of its branding (MK-074): recorded as the files of extensions, under {@link #KERNEL}, so it
     * counts to the storage quota of the organization and its content leaves the store with the
     * organization; no extension reads it, since no extension has that identifier. The caller decides
     * who may store it and who reads it ({@link #kernelContent}).
     *
     * @param limit the largest content, in bytes, below {@code mosaikit.files.max-size}
     * @throws ContentTooLargeException beyond {@code limit}
     */
    public FileView storeForKernel(String name, InputStream content, long limit, ContentCheck check) {
        String fileName = name(name);
        long most = Math.min(limit, maxSize);
        notDoomed();
        UUID org = organization.require();
        Spooled spooled =
                spool(content, most, () -> new ContentTooLargeException("This file has at most " + most + " bytes."));
        String type;
        try {
            type = contentType(check.check(spooled.path()));
            fits(org, spooled.size());
        } catch (IOException e) {
            spooled.discard();
            throw new InvalidInputException(List.of("the content could not be read"));
        } catch (RuntimeException e) {
            spooled.discard();
            throw e;
        }
        UUID id = UUID.randomUUID();
        String key = FileStore.key(org, KERNEL, id);
        try {
            store.put(key, spooled.path(), spooled.size(), type);
        } catch (IOException e) {
            LOG.errorf("Cannot store a file in %s: %s", store.describe(), e.getMessage());
            throw new ServiceUnavailableException("The file cannot be stored now.");
        } finally {
            spooled.discard();
        }
        try {
            return transaction(() -> {
                deleteUnlessCommitted(key);
                quotas.reserveStorage(org, spooled.size());
                StoredFile file = new StoredFile(
                        id,
                        org,
                        KERNEL,
                        account().orElse(null),
                        null,
                        fileName,
                        type,
                        spooled.size(),
                        spooled.checksum(),
                        null,
                        Instant.now(clock).truncatedTo(ChronoUnit.MICROS));
                files.insert(file);
                audited("file.stored", file);
                return FileView.of(file);
            });
        } catch (RuntimeException e) {
            deleteQuietly(key);
            throw e;
        }
    }

    /**
     * Deletes a file of the kernel of the organization of the request (MK-074); its content leaves the
     * store when the transaction commits. A file that is not there is already gone.
     */
    public void deleteForKernel(UUID id) {
        transaction(() -> {
            UUID org = organization.require();
            files.findById(id)
                    .filter(file -> file.getOrganizationId().equals(org) && KERNEL.equals(file.getExtensionId()))
                    .ifPresent(file -> {
                        files.delete(file);
                        String key = file.getStorageKey();
                        if (transactions.getTransactionStatus() == Status.STATUS_ACTIVE) {
                            transactions.registerInterposedSynchronization(new AfterCompletion(status -> {
                                if (status == Status.STATUS_COMMITTED) {
                                    deleteQuietly(key);
                                }
                            }));
                        }
                        audited("file.deleted", file);
                    });
            return null;
        });
    }

    /**
     * The content of a file of the kernel that the caller found and may show (MK-074), as it recorded
     * it: read from the store without the checks of the request, which may have no person.
     */
    public Content kernelContent(
            UUID organization, UUID id, String name, String contentType, long size, String checksum, Instant updated) {
        FileView file = new FileView(id, KERNEL, name, contentType, size, checksum, null, null, null, updated, updated);
        return new Content(file, FileStore.key(organization, KERNEL, id));
    }

    /**
     * Stores a file of an extension in the organization of the request, owned by the person of the
     * request: for the whole organization, or shared with a team of the person.
     *
     * @param content the content, read to its end and not closed
     * @param declaredSize the size announced by the caller, such as {@code Content-Length}, to refuse
     *     a file too large before reading it
     */
    public FileView store(String extension, Upload upload, InputStream content, OptionalLong declaredSize) {
        String name = name(upload.name());
        String type = contentType(upload.contentType());
        if (declaredSize.isPresent() && declaredSize.getAsLong() > maxSize) {
            throw tooLarge();
        }
        notDoomed();
        UUID resource = transaction(() -> permitted(extension, upload));
        UUID org = organization.require();
        if (declaredSize.isPresent()) {
            fits(org, declaredSize.getAsLong());
        }
        Spooled spooled = spool(content, maxSize, this::tooLarge);
        try {
            fits(org, spooled.size());
        } catch (RuntimeException e) {
            spooled.discard();
            throw e;
        }
        UUID id = UUID.randomUUID();
        String key = FileStore.key(org, extension, id);
        try {
            store.put(key, spooled.path(), spooled.size(), type);
        } catch (IOException e) {
            LOG.errorf("Cannot store a file in %s: %s", store.describe(), e.getMessage());
            throw new ServiceUnavailableException("The file cannot be stored now.");
        } finally {
            spooled.discard();
        }
        try {
            return transaction(() -> {
                deleteUnlessCommitted(key);
                permitted(extension, upload);
                quotas.reserveStorage(org, spooled.size());
                StoredFile file = new StoredFile(
                        id,
                        org,
                        extension,
                        account().orElse(null),
                        upload.team(),
                        name,
                        type,
                        spooled.size(),
                        spooled.checksum(),
                        resource,
                        Instant.now(clock).truncatedTo(ChronoUnit.MICROS));
                files.insert(file);
                audited("file.stored", file);
                raise(PlatformEvents.FILE_STORED, file);
                return FileView.of(file);
            });
        } catch (RuntimeException e) {
            deleteQuietly(key);
            throw e;
        }
    }

    /**
     * A file of an extension that the person may read.
     *
     * @throws ResourceNotFoundException when there is no such file, or the person may not read it
     */
    public FileView metadata(String extension, UUID id) {
        return transaction(() -> FileView.of(readable(extension, id)));
    }

    /** A file of an extension that the person may read, with its content to open. */
    public Content content(String extension, UUID id) {
        return transaction(() -> new Content(readable(extension, id)));
    }

    /**
     * The files of an extension that the person reads, newest first: of the organization and of
     * their teams, or of one team of theirs.
     */
    public List<FileView> list(String extension, UUID team, int offset, int limit) {
        return transaction(() -> {
            UUID org = organization.require();
            active(extension);
            int size = Math.clamp(limit, 1, MAX_PAGE);
            int start = Math.max(offset, 0);
            Limit page = Limit.range(start + 1L, start + (long) size);
            List<StoredFile> found;
            if (team != null) {
                requireIn(team);
                found = files.listOfTeam(org, extension, team, account().orElseThrow(), page);
            } else {
                Optional<UUID> account = account();
                found = account.isPresent()
                        ? files.listReadable(org, extension, organization.guest(), account.get(), page)
                        : files.listOfOrganization(org, extension, page);
            }
            return found.stream().map(FileView::of).toList();
        });
    }

    /**
     * Deletes a file: its owner, an owner of its team or an administrator of the organization may;
     * so may the code of an extension that acts without a person. A file attached to a resource: its
     * owner, or a person with a level that edits the resource. The content leaves the store when
     * the transaction commits.
     */
    public void delete(String extension, UUID id) {
        transaction(() -> {
            StoredFile file = readable(extension, id);
            if (!mayDelete(file)) {
                throw new ForbiddenOperationException(
                        file.getResourceId() != null
                                ? "Only the owner of the file " + id + " or a person who edits its resource delete it."
                                : "Only the owner of the file " + id
                                        + ", an owner of its team or an administrator of the organization delete it.");
            }
            files.delete(file);
            String key = file.getStorageKey();
            // In a transaction already marked for rollback the row stays, and so does the content: the
            // transaction manager refuses a synchronization there (#93), and none is needed.
            if (transactions.getTransactionStatus() == Status.STATUS_ACTIVE) {
                transactions.registerInterposedSynchronization(new AfterCompletion(status -> {
                    if (status == Status.STATUS_COMMITTED) {
                        deleteQuietly(key);
                    }
                }));
            }
            audited("file.deleted", file);
            raise(PlatformEvents.FILE_DELETED, file);
            return null;
        });
    }

    /**
     * The content of a file found without the person of the request, through a signed link that the
     * caller verified (MK-093). Through this bean, so that the content reads its own store.
     */
    Content signed(FileView file, String key) {
        return new Content(file, key);
    }

    /**
     * Checks that the person may make a link to every file of an extension under a prefix (MK-093):
     * those of one of their teams, or, unless a guest, those of the organization.
     *
     * @throws ResourceNotFoundException when the extension is not active, or the team not theirs
     * @throws ForbiddenOperationException when a guest asks for the files of the organization
     */
    public void permitsPrefix(String extension, UUID team) {
        transaction(() -> {
            organization.require();
            active(extension);
            if (team != null) {
                requireIn(team);
            } else if (organization.guest()) {
                throw new ForbiddenOperationException("A guest makes links only to the files of their teams.");
            }
            return null;
        });
    }

    private StoredFile readable(String extension, UUID id) {
        UUID org = organization.require();
        active(extension);
        return files.findById(id)
                .filter(file -> file.getOrganizationId().equals(org)
                        && file.getExtensionId().equals(extension)
                        && readable(file))
                .orElseThrow(() -> new ResourceNotFoundException("No file " + id + "."));
    }

    /**
     * As the row-level security decides too: a file attached to a resource as its sharing (MK-055),
     * the others as the documents of extensions (MK-032).
     */
    private boolean readable(StoredFile file) {
        Optional<Access> attached = attached(file);
        if (attached.isPresent()) {
            return attached.get() != Access.NONE;
        }
        if (file.getTeamId() == null) {
            return !organization.guest();
        }
        return account()
                .flatMap(account -> teamMembers.member(file.getTeamId(), account))
                .isPresent();
    }

    /**
     * Refuses a team that the person is not in, as if it did not exist. Read here rather than with
     * the team service, whose refusal would roll back the transaction of the caller.
     */
    private void requireIn(UUID team) {
        UUID org = organization.require();
        boolean in = teamMembers
                        .findById(team)
                        .filter(found -> found.getOrganizationId().equals(org))
                        .isPresent()
                && account()
                        .flatMap(account -> teamMembers.member(team, account))
                        .isPresent();
        if (!in) {
            throw new ResourceNotFoundException("You are not in the team " + team + ".");
        }
    }

    private boolean mayDelete(StoredFile file) {
        Optional<UUID> account = account();
        if (account.isEmpty()) {
            return true;
        }
        Optional<Access> attached = attached(file);
        if (attached.isPresent()) {
            return attached.get() == Access.WRITE;
        }
        if (RequestOrganization.administrator(identity)) {
            return true;
        }
        if (account.get().equals(file.getOwnerId())) {
            return true;
        }
        return file.getTeamId() != null
                && teamMembers
                        .member(file.getTeamId(), account.get())
                        .filter(member -> TeamMember.OWNER.equals(member.getRole()))
                        .isPresent();
    }

    /** Checks that the person may store the file; the id of its registered resource, if any. */
    private UUID permitted(String extension, Upload upload) {
        UUID org = organization.require();
        active(extension);
        if (upload.team() != null) {
            requireIn(upload.team());
        } else if (organization.guest()) {
            throw new ForbiddenOperationException("A guest stores files only for their teams.");
        }
        ResourceRef ref = upload.resource();
        if (ref == null) {
            return null;
        }
        if (!ref.extension().equals(extension)) {
            throw new InvalidInputException(List.of("resource must be a resource of " + extension));
        }
        RegisteredResource entry = resources
                .find(org, ref.extension(), ref.type(), ref.id())
                .orElseThrow(() -> new InvalidInputException(List.of("resource " + ref + " is not registered")));
        if (account().isPresent()) {
            // Attaching a file to a resource changes it: a level that edits it (MK-055). A resource
            // the person does not reach answers as one that is not registered.
            Access access = access(entry);
            if (access == Access.NONE) {
                throw new InvalidInputException(List.of("resource " + ref + " is not registered"));
            }
            if (access == Access.READ) {
                throw new ForbiddenOperationException("You may read " + ref + ", not attach files to it.");
            }
        }
        return entry.getId();
    }

    /** What the person of the request may do with a file attached to a resource. */
    enum Access {
        NONE,
        READ,
        WRITE
    }

    /**
     * What the person of the request may do with a file attached to a resource: empty when the file
     * is attached to none, or when no person asks, so that the rules of the organization and its
     * teams apply.
     */
    private Optional<Access> attached(StoredFile file) {
        Optional<UUID> account = account();
        if (file.getResourceId() == null || account.isEmpty()) {
            return Optional.empty();
        }
        if (account.get().equals(file.getOwnerId())) {
            return Optional.of(Access.WRITE);
        }
        return resources.findById(file.getResourceId()).map(this::access);
    }

    /**
     * What the person of the request may do with the files of a resource, as its sharing says
     * (MK-055): read them with any level, change them with a level that edits. The owner of the
     * resource and the administrators of the organization change them too, as they hold every level
     * (not the administrators on the kernel's types private to their subjects, ADR-0037). A type that
     * the extension no longer declares leaves the files to the administrators only.
     */
    private Access access(RegisteredResource entry) {
        ResourceRef ref = entry.ref();
        Optional<ResourceTypeEntry> type = extensions
                .findActive(ref.extension())
                .flatMap(InstalledExtension::manifest)
                .flatMap(manifest -> ResourceTypes.of(manifest, ref.type()));
        boolean administrator = RequestOrganization.administrator(identity);
        if (type.isEmpty()) {
            return administrator ? Access.WRITE : Access.NONE;
        }
        Optional<String> held = sharing.level(ref);
        if (held.isEmpty()) {
            return Access.NONE;
        }
        boolean owner = account().filter(me -> me.equals(entry.getOwnerId())).isPresent();
        boolean edits =
                type.get().levels().stream().anyMatch(level -> level.name().equals(held.get()) && level.edits());
        if (edits || owner || (administrator && ResourceTypes.administratorsHoldEveryLevel(type.get()))) {
            return Access.WRITE;
        }
        return Access.READ;
    }

    /** Only an active extension has files; the files of another one do not exist. */
    private void active(String extension) {
        if (extension == null || extensions.findActive(extension).isEmpty()) {
            throw new ResourceNotFoundException("No active extension " + extension + ".");
        }
    }

    private Optional<UUID> account() {
        return RequestOrganization.account(identity);
    }

    /**
     * A name of a file: a few words, or a path such as {@code tiles/3/4/2.png} whose segments are
     * neither empty, nor {@code .} or {@code ..}.
     */
    static String name(String value) {
        String name = value == null ? "" : value.strip();
        if (name.isEmpty() || name.length() > MAX_NAME) {
            throw new InvalidInputException(List.of("name must have 1 to " + MAX_NAME + " characters"));
        }
        if (name.chars().anyMatch(c -> Character.isISOControl(c) || c == '\\')) {
            throw new InvalidInputException(List.of("name must not contain control characters nor backslashes"));
        }
        for (String segment : name.split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) {
                throw new InvalidInputException(
                        List.of("name must not start or end with /, nor contain //, /./ or /../"));
            }
        }
        return name;
    }

    /**
     * A prefix of names of files (MK-093): empty for every file, or the start of a name, such as
     * {@code tiles/} or {@code report-2026}, whose complete segments are neither empty, nor {@code .}
     * or {@code ..}.
     */
    static String prefix(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        if (value.length() > MAX_NAME) {
            throw new InvalidInputException(List.of("prefix must have at most " + MAX_NAME + " characters"));
        }
        if (value.chars().anyMatch(c -> Character.isISOControl(c) || c == '\\')) {
            throw new InvalidInputException(List.of("prefix must not contain control characters nor backslashes"));
        }
        String[] segments = value.split("/", -1);
        for (int index = 0; index < segments.length; index++) {
            String segment = segments[index];
            boolean last = index == segments.length - 1;
            if ((segment.isEmpty() && !last) || segment.equals(".") || segment.equals("..")) {
                throw new InvalidInputException(List.of("prefix must not start with /, nor contain //, /./ or /../"));
            }
        }
        return value;
    }

    /** A media type such as {@code image/png}; {@code application/octet-stream} when absent. */
    static String contentType(String value) {
        if (value == null || value.isBlank()) {
            return DEFAULT_TYPE;
        }
        String type = value.strip();
        if (type.length() > MAX_TYPE || !MEDIA_TYPE.matcher(type).matches()) {
            throw new InvalidInputException(List.of("the content type must be a media type such as image/png"));
        }
        int parameters = type.indexOf(';');
        return parameters < 0
                ? type.toLowerCase(Locale.ROOT)
                : type.substring(0, parameters).strip().toLowerCase(Locale.ROOT) + type.substring(parameters);
    }

    /** A content written to a temporary file, with its size and checksum. */
    record Spooled(Path path, long size, String checksum) {

        void discard() {
            try {
                Files.deleteIfExists(path);
            } catch (IOException e) {
                LOG.warnf("Cannot delete the temporary file %s: %s", path, e.getMessage());
            }
        }
    }

    private Spooled spool(InputStream content, long limit, Supplier<DomainException> tooLarge) {
        Path path;
        try {
            path = Files.createTempFile("mosaikit-file-", ".upload", PRIVATE);
        } catch (IOException e) {
            throw new IllegalStateException("Cannot create a temporary file for an upload", e);
        }
        MessageDigest digest = sha256();
        long size = 0;
        try (OutputStream out = new DigestOutputStream(Files.newOutputStream(path), digest)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = content.read(buffer)) >= 0) {
                size += read;
                if (size > limit) {
                    throw tooLarge.get();
                }
                out.write(buffer, 0, read);
            }
        } catch (IOException | RuntimeException e) {
            new Spooled(path, size, "").discard();
            if (e instanceof RuntimeException runtime) {
                throw runtime;
            }
            throw new InvalidInputException(List.of("the content could not be read to its end"));
        }
        return new Spooled(path, size, HexFormat.of().formatHex(digest.digest()));
    }

    /** Refuses a file that the storage quota of the organization has no room for (MK-076). */
    private void fits(UUID org, long size) {
        var check = quotas.check(org, Measure.STORAGE, size);
        if (!check.fits()) {
            throw check.refusal();
        }
    }

    private ContentTooLargeException tooLarge() {
        return new ContentTooLargeException("A file has at most " + maxSize + " bytes (mosaikit.files.max-size).");
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }

    /**
     * Refuses to store a file in a transaction of the caller that can no longer commit: marked for
     * rollback after an earlier failure of the caller, or ended by its timeout. Nothing recorded now
     * would be kept, and the transaction manager refuses the synchronization that removes the content
     * if the record does not commit (#93). A conflict, which leaves the transaction of the caller as
     * it was.
     */
    private void notDoomed() {
        int status = transactions.getTransactionStatus();
        if (status != Status.STATUS_ACTIVE && status != Status.STATUS_NO_TRANSACTION) {
            throw new ConflictException("The transaction of the caller can no longer commit (an earlier step"
                    + " failed, or it timed out): the file is not stored.");
        }
    }

    private void deleteUnlessCommitted(String key) {
        notDoomed();
        transactions.registerInterposedSynchronization(new AfterCompletion(status -> {
            if (status != Status.STATUS_COMMITTED) {
                deleteQuietly(key);
            }
        }));
    }

    private void deleteQuietly(String key) {
        try {
            store.delete(key);
        } catch (IOException | RuntimeException e) {
            LOG.warnf("Cannot delete %s from %s, which keeps it: %s", key, store.describe(), e.getMessage());
        }
    }

    private void audited(String action, StoredFile file) {
        Map<String, String> detail = new LinkedHashMap<>();
        detail.put("extension", file.getExtensionId());
        detail.put("name", file.getName());
        detail.put("size", String.valueOf(file.getSize()));
        if (file.getTeamId() != null) {
            detail.put("team", file.getTeamId().toString());
        }
        audit.append(
                identity.isAnonymous()
                        ? file.getExtensionId()
                        : identity.getPrincipal().getName(),
                Optional.of(file.getOrganizationId()),
                action,
                file.getId().toString(),
                AuditEvent.Outcome.SUCCEEDED,
                detail);
    }

    /** Raises an event of a file for the subscribers of extensions (MK-085), in the transaction of the change. */
    private void raise(String type, StoredFile file) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("extension", file.getExtensionId());
        payload.put("file", file.getId().toString());
        payload.put("name", file.getName());
        payload.put("contentType", file.getContentType());
        payload.put("size", file.getSize());
        if (file.getTeamId() != null) {
            payload.put("team", file.getTeamId().toString());
        }
        if (file.getResourceId() != null) {
            resources
                    .findById(file.getResourceId())
                    .ifPresent(entry -> payload.put("resource", entry.ref().toString()));
        }
        events.raise(file.getOrganizationId(), type, payload);
    }

    /**
     * In the transaction of the caller, or in one of its own. A refusal, which happens before any
     * write, leaves the transaction of the caller as it was.
     */
    private static <T> T transaction(Callable<T> work) {
        return QuarkusTransaction.joiningExisting()
                .exceptionHandler(e -> e instanceof DomainException
                        ? TransactionExceptionResult.COMMIT
                        : TransactionExceptionResult.ROLLBACK)
                .call(work);
    }

    /** Runs after the transaction ends, with its status. */
    private record AfterCompletion(IntConsumer then) implements Synchronization {

        @Override
        public void beforeCompletion() {
            // Nothing before.
        }

        @Override
        public void afterCompletion(int status) {
            then.accept(status);
        }
    }
}

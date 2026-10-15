// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.live.Notifications.Notification;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.sharing.Subject;
import dev.mosaikit.kernel.core.account.AccountDirectory;
import dev.mosaikit.kernel.core.account.UserAccount;
import dev.mosaikit.kernel.core.account.UserAccounts;
import dev.mosaikit.kernel.core.activity.ActivityService;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.organization.OrganizationMember;
import dev.mosaikit.kernel.core.organization.OrganizationMembers;
import dev.mosaikit.kernel.core.resources.RegisteredResource;
import dev.mosaikit.kernel.core.resources.RegisteredResources;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.data.Limit;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Requests for access (MK-058): a person refused a resource asks for a level on it with a message, the
 * people who may share it (its owner, the administrators of the organization, whoever holds its
 * highest level) are notified and approve or reject it from one list, an approved request grants the
 * level with the sharing model (MK-055, MK-136), and the requester is notified of the outcome.
 *
 * <p>Sending a request tells the requester nothing about the resource: the answer is the same whether
 * it exists or not, whatever its owner, and holds only what the requester gave. Every request and
 * decision is in the audit log (MK-059).
 */
@ApplicationScoped
@Transactional
public class AccessRequestService {

    static final String REQUESTED = "access.requested";
    static final String APPROVED = "access.request.approved";
    static final String REJECTED = "access.request.rejected";
    static final String WITHDRAWN = "access.request.withdrawn";

    /** The kinds of the notifications, which people turn off as those of extensions. */
    static final String KIND_REQUEST = "access-request";

    static final String KIND_OUTCOME = "access-request-outcome";

    /** The page of the shell that lists the requests to decide. */
    static final String PAGE = "/access-requests";

    static final int MAX_MESSAGE = 1000;
    private static final int MAX_LISTED = 200;
    private static final int MAX_EXCERPT = 300;
    private static final Pattern SHELL_PATH = Pattern.compile("^/(?!/)[A-Za-z0-9/_.~?=&%-]{0,499}$");

    /**
     * A request as its requester sees it: only what they gave, and the outcome.
     *
     * @param id the request
     * @param resource the resource, as the refused page named it
     * @param level the level asked
     * @param message the message
     * @param status {@code pending}, {@code approved} or {@code rejected}
     * @param created when it was sent, or sent again
     * @param decided when it was decided, or {@code null}
     * @param grantedLevel the level granted, for an approved request
     * @param reason the reason given with a rejection, or {@code null}
     */
    public record OwnRequest(
            UUID id,
            ResourceRef resource,
            String level,
            String message,
            String status,
            Instant created,
            Instant decided,
            String grantedLevel,
            String reason) {}

    /**
     * A pending request, as the people who may decide it see it.
     *
     * @param id the request
     * @param requester the account of the requester
     * @param requesterName their name
     * @param requesterEmail their email address
     * @param resource the resource
     * @param title its title in the registry
     * @param link where it opens
     * @param extensionName the name of its extension
     * @param typeTitle the title of its type
     * @param level the level asked
     * @param levels the levels of the type, from the lowest, among which the decider may grant another
     * @param message the message of the requester
     * @param created when it was sent
     */
    public record PendingRequest(
            UUID id,
            UUID requester,
            String requesterName,
            String requesterEmail,
            ResourceRef resource,
            String title,
            String link,
            String extensionName,
            String typeTitle,
            String level,
            List<SharingDialog.LevelView> levels,
            String message,
            Instant created) {}

    private final AccessRequests requests;
    private final KernelSharing sharing;
    private final RegisteredResources entries;
    private final ExtensionRegistry extensions;
    private final OrganizationMembers members;
    private final UserAccounts accounts;
    private final AccountDirectory directory;
    private final ActivityService activity;
    private final AuditLog audit;
    private final SecurityIdentity identity;
    private final RequestOrganization organization;
    private final Clock clock;

    public AccessRequestService(
            AccessRequests requests,
            KernelSharing sharing,
            RegisteredResources entries,
            ExtensionRegistry extensions,
            OrganizationMembers members,
            UserAccounts accounts,
            AccountDirectory directory,
            ActivityService activity,
            AuditLog audit,
            SecurityIdentity identity,
            RequestOrganization organization,
            Clock clock) {
        this.requests = requests;
        this.sharing = sharing;
        this.entries = entries;
        this.extensions = extensions;
        this.members = members;
        this.accounts = accounts;
        this.directory = directory;
        this.activity = activity;
        this.audit = audit;
        this.identity = identity;
        this.organization = organization;
        this.clock = clock;
    }

    /**
     * Sends a request for a level on a resource, or replaces the message of the pending one of the
     * person for it. The people who may decide it are notified the first time.
     *
     * @param level the level asked, or {@code null} for the lowest of the type
     * @throws InvalidInputException when the type is not one of an active extension, the level not one
     *     of the type or the message too long: what the manifests say, never what the resource is
     */
    public OwnRequest request(ResourceRef resource, String level, String message) {
        UUID org = organization.require();
        UUID me = me();
        ResourceTypeEntry type = type(resource);
        String asked = level == null || level.isBlank() ? type.levelNames().getFirst() : level.strip();
        List<String> problems = new ArrayList<>();
        if (!type.declares(asked)) {
            problems.add("level must be one of " + String.join(", ", type.levelNames()));
        }
        String text = message == null ? "" : message.strip();
        if (text.length() > MAX_MESSAGE) {
            problems.add("message must be at most " + MAX_MESSAGE + " characters");
        }
        if (!problems.isEmpty()) {
            throw new InvalidInputException(problems);
        }
        Instant now = Instant.now(clock);
        Optional<AccessRequest> pending =
                requests.pendingOf(org, me, resource.extension(), resource.type(), resource.id());
        AccessRequest saved;
        if (pending.isPresent()) {
            saved = pending.get();
            saved.askAgain(asked, text, now);
            requests.update(saved);
        } else {
            saved = new AccessRequest(org, me, resource, asked, text, now);
            requests.insert(saved);
            notifyDeciders(org, saved);
        }
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("request", saved.getId().toString());
        detail.put("level", asked);
        audited(org, REQUESTED, resource, detail);
        return own(saved);
    }

    /** The requests of the person of the request, newest first. */
    public List<OwnRequest> mine() {
        UUID org = organization.require();
        return requests.of(org, me(), Limit.of(MAX_LISTED)).stream()
                .map(AccessRequestService::own)
                .toList();
    }

    /** Withdraws a pending request of the person of the request. */
    public void withdraw(UUID id) {
        UUID org = organization.require();
        UUID me = me();
        AccessRequest found = requests.findById(id)
                .filter(request -> request.getOrganizationId().equals(org))
                .filter(request -> request.getRequesterId().equals(me))
                .filter(AccessRequest::pending)
                .orElseThrow(() -> new ResourceNotFoundException("No such pending request of yours."));
        requests.delete(found);
        audited(org, WITHDRAWN, found.ref(), Map.of("request", id.toString()));
    }

    /**
     * The pending requests that the person of the request may decide: those for the resources they
     * may share, oldest first.
     */
    public List<PendingRequest> toDecide() {
        UUID org = organization.require();
        me();
        List<PendingRequest> found = new ArrayList<>();
        for (AccessRequest request : requests.pending(org, Limit.of(MAX_LISTED))) {
            decidable(org, request).ifPresent(decidable -> found.add(pending(request, decidable)));
        }
        return found;
    }

    /**
     * Approves a pending request: grants the requester the level asked, or the one given, with the
     * sharing model, as the person of the request; a requester who already holds that level keeps the
     * one they have. The requester is notified.
     *
     * @param level the level to grant in place of the one asked, or {@code null}
     */
    public OwnRequest approve(UUID id, String level) {
        UUID org = organization.require();
        UUID me = me();
        AccessRequest request = toDecide(org, id);
        Decidable decidable = decidable(org, request).orElseThrow(AccessRequestService::notYours);
        String granted = level == null || level.isBlank() ? request.getLevel() : level.strip();
        if (!decidable.type().declares(granted)) {
            throw new InvalidInputException(List.of(
                    "level must be one of " + String.join(", ", decidable.type().levelNames())));
        }
        ResourceRef ref = request.ref();
        boolean holds = sharing.level(request.getRequesterId(), ref)
                .map(held -> decidable.type().includes(held, granted))
                .orElse(false);
        if (!holds) {
            try {
                sharing.grant(ref, Subject.person(request.getRequesterId()), granted);
            } catch (NoSuchElementException e) {
                throw new ResourceNotFoundException(e.getMessage());
            } catch (IllegalArgumentException e) {
                throw new InvalidInputException(List.of("input " + e.getMessage()));
            }
        }
        Instant now = Instant.now(clock);
        request.approve(me, granted, now);
        requests.update(request);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("request", id.toString());
        detail.put("requester", request.getRequesterId().toString());
        detail.put("level", granted);
        audited(org, APPROVED, ref, detail);
        RegisteredResource entry = decidable.entry();
        activity.sendFromKernel(
                List.of(request.getRequesterId()),
                new Notification(
                        KIND_OUTCOME,
                        clip("Your request for access to " + entry.getTitle() + " was approved", 200),
                        "You may now open it with the level " + granted + ".",
                        shellPath(entry.getLink())));
        return own(request);
    }

    /**
     * Rejects a pending request, with an optional reason that the requester reads. The requester is
     * notified; the notification does not name the resource, which they still may not open.
     */
    public OwnRequest reject(UUID id, String reason) {
        UUID org = organization.require();
        UUID me = me();
        AccessRequest request = toDecide(org, id);
        decidable(org, request).orElseThrow(AccessRequestService::notYours);
        String text = reason == null || reason.isBlank() ? null : reason.strip();
        if (text != null && text.length() > MAX_MESSAGE) {
            throw new InvalidInputException(List.of("reason must be at most " + MAX_MESSAGE + " characters"));
        }
        request.reject(me, text, Instant.now(clock));
        requests.update(request);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("request", id.toString());
        detail.put("requester", request.getRequesterId().toString());
        audited(org, REJECTED, request.ref(), detail);
        StringBuilder body = new StringBuilder();
        if (!request.getMessage().isEmpty()) {
            body.append("You wrote: ")
                    .append(clip(request.getMessage(), MAX_EXCERPT))
                    .append('\n');
        }
        if (text != null) {
            body.append("Reason: ").append(clip(text, MAX_EXCERPT));
        }
        activity.sendFromKernel(
                List.of(request.getRequesterId()),
                new Notification(
                        KIND_OUTCOME,
                        "Your request for access was declined",
                        clip(body.toString().strip(), 1000),
                        null));
        return own(request);
    }

    // --- Rules ---------------------------------------------------------------------------------

    /** A pending request whose resource exists and that the person of the request may share. */
    private record Decidable(RegisteredResource entry, ResourceTypeEntry type, ExtensionManifest manifest) {}

    private Optional<Decidable> decidable(UUID org, AccessRequest request) {
        ResourceRef ref = request.ref();
        Optional<ExtensionManifest> manifest =
                extensions.findActive(ref.extension()).flatMap(InstalledExtension::manifest);
        Optional<ResourceTypeEntry> type = manifest.flatMap(found -> ResourceTypes.of(found, ref.type()));
        if (type.isEmpty()) {
            return Optional.empty();
        }
        Optional<RegisteredResource> entry =
                entries.find(org, ref.extension(), ref.type(), ref.id()).filter(found -> !found.inTrash());
        if (entry.isEmpty() || !sharing.mayShare(ref)) {
            return Optional.empty();
        }
        return Optional.of(new Decidable(entry.get(), type.get(), manifest.get()));
    }

    private AccessRequest toDecide(UUID org, UUID id) {
        return requests.findById(id)
                .filter(request -> request.getOrganizationId().equals(org))
                .filter(AccessRequest::pending)
                .orElseThrow(() -> new ResourceNotFoundException("No such pending request."));
    }

    /** The same answer as an unknown request: who may not decide it learns nothing of it. */
    private static ResourceNotFoundException notYours() {
        return new ResourceNotFoundException("No such pending request.");
    }

    /**
     * Notifies the people who decide a new request: the owner of the resource; for a resource that the
     * organization owns, or whose owner left, the administrators who may share it. Nobody when no such
     * resource is registered: the request then waits, as one nobody answers.
     */
    private void notifyDeciders(UUID org, AccessRequest request) {
        ResourceRef ref = request.ref();
        Optional<RegisteredResource> entry =
                entries.find(org, ref.extension(), ref.type(), ref.id()).filter(found -> !found.inTrash());
        if (entry.isEmpty()) {
            return;
        }
        ResourceTypeEntry type = type(ref);
        String top = type.levelNames().getLast();
        Set<UUID> deciders = new LinkedHashSet<>();
        UUID owner = entry.get().getOwnerId();
        if (owner != null
                && members.findByAccountIdAndOrganizationId(owner, org).isPresent()) {
            deciders.add(owner);
        } else {
            for (OrganizationMember member : members.findByOrganizationId(org)) {
                if (member.getRoles().contains(Roles.ORGANIZATION_ADMIN)
                        && sharing.level(member.getAccountId(), ref)
                                .filter(top::equals)
                                .isPresent()) {
                    deciders.add(member.getAccountId());
                }
            }
        }
        deciders.remove(request.getRequesterId());
        if (deciders.isEmpty()) {
            return;
        }
        String name = accounts.findById(request.getRequesterId())
                .map(UserAccount::getDisplayName)
                .orElse("Someone");
        activity.sendFromKernel(
                deciders,
                new Notification(
                        KIND_REQUEST,
                        clip(name + " asks for access to " + entry.get().getTitle(), 200),
                        clip(request.getMessage(), 1000),
                        PAGE));
    }

    private PendingRequest pending(AccessRequest request, Decidable decidable) {
        Optional<UserAccount> requester = accounts.findById(request.getRequesterId());
        RegisteredResource entry = decidable.entry();
        return new PendingRequest(
                request.getId(),
                request.getRequesterId(),
                requester.map(UserAccount::getDisplayName).orElse(null),
                requester.map(UserAccount::getUsername).orElse(null),
                request.ref(),
                entry.getTitle(),
                entry.getLink(),
                decidable.manifest().name(),
                decidable.type().title(),
                request.getLevel(),
                SharingDialog.levels(decidable.type()),
                request.getMessage(),
                request.getCreatedAt());
    }

    private static OwnRequest own(AccessRequest request) {
        return new OwnRequest(
                request.getId(),
                request.ref(),
                request.getLevel(),
                request.getMessage(),
                request.getStatus(),
                request.getCreatedAt(),
                request.getDecidedAt(),
                request.getGrantedLevel(),
                request.getReason());
    }

    /** The type of a resource, refused as input when no active extension declares it. */
    private ResourceTypeEntry type(ResourceRef ref) {
        return extensions
                .findActive(ref.extension())
                .flatMap(InstalledExtension::manifest)
                .flatMap(manifest -> ResourceTypes.of(manifest, ref.type()))
                .orElseThrow(() -> new InvalidInputException(List.of(
                        "resource " + ref.extension() + "/" + ref.type() + " is not a type of an active extension")));
    }

    private UUID me() {
        if (identity == null || identity.isAnonymous()) {
            throw new ForbiddenOperationException("Sign in to ask for access.");
        }
        return RequestOrganization.account(identity)
                .or(() -> directory.idOf(identity.getPrincipal().getName()))
                .orElseThrow(
                        () -> new ForbiddenOperationException("Only a person of the organization asks for access."));
    }

    private void audited(UUID org, String action, ResourceRef ref, Map<String, ?> detail) {
        audit.append(
                identity.getPrincipal().getName(),
                Optional.of(org),
                action,
                ref.toString(),
                AuditEvent.Outcome.SUCCEEDED,
                detail);
    }

    /** A link of the registry, when it is a path of the shell that a notification may open. */
    static String shellPath(String link) {
        return link != null && SHELL_PATH.matcher(link).matches() ? link : null;
    }

    static String clip(String text, int max) {
        return text.length() <= max ? text : text.substring(0, max - 1) + "…";
    }
}

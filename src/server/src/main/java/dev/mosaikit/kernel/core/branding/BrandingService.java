// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.branding;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.files.FileService;
import dev.mosaikit.kernel.core.files.FileView;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.Organizations;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * The branding of organizations (MK-074): a display name, an accent color, the tokens of the theme
 * and the images (logos, icon, favicon) that the administrators of an organization set, and only
 * they. The shell shows them on the sign-in page of the organization and after sign-in, over the
 * theme of the installation; a theme chosen by the person wins over them.
 *
 * <p>The branding is public, as the theme of the installation is (MK-052): the sign-in page shows it
 * before anyone signs in. An organization that does not exist answers the same as one without a
 * branding, so the address tells nothing of which organizations exist.
 */
@ApplicationScoped
public class BrandingService {

    /** The largest image, in bytes. */
    public static final long MAX_IMAGE = 2L * 1024 * 1024;

    /** The tokens of a scheme of a theme that an organization may change (those of {@code Palette}). */
    static final Set<String> TOKENS = Set.of(
            "brand", "background", "surface", "foreground", "muted", "line", "danger", "success", "warning", "focus");

    private static final Pattern COLOR = Pattern.compile("^#[0-9a-f]{6}$");

    private static final TypeReference<Map<String, Map<String, String>>> TOKENS_TYPE = new TypeReference<>() {};

    private final Organizations organizations;
    private final OrganizationBrandings brandings;
    private final BrandImages images;
    private final FileService files;
    private final SecurityIdentity identity;
    private final AuditLog audit;
    private final ObjectMapper json;
    private final EntityManager entityManager;
    private final Clock clock = Clock.systemUTC();

    @SuppressWarnings("java:S107") // the beans it needs
    public BrandingService(
            Organizations organizations,
            OrganizationBrandings brandings,
            BrandImages images,
            FileService files,
            SecurityIdentity identity,
            AuditLog audit,
            ObjectMapper json,
            EntityManager entityManager) {
        this.organizations = organizations;
        this.brandings = brandings;
        this.images = images;
        this.files = files;
        this.identity = identity;
        this.audit = audit;
        this.json = json;
        this.entityManager = entityManager;
    }

    /**
     * The branding of an organization, or {@link BrandingView#NONE}. Public: read as the kernel, since
     * the request of the sign-in page has no organization, and row-level security shows it no row.
     */
    public BrandingView view(String slug) {
        return asKernel(() -> find(slug).map(this::view).orElse(BrandingView.NONE));
    }

    /** Sets the display name, the accent color and the tokens of the theme. */
    @Transactional
    public BrandingView change(String slug, BrandingRequest request) {
        Organization organization = managed(slug);
        String displayName = blankToNull(request.displayName());
        String accent = color("accent", request.accent());
        Map<String, Map<String, String>> tokens = new TreeMap<>();
        List<String> problems = new ArrayList<>();
        tokens.put("light", tokens("light", request.light(), problems));
        tokens.put("dark", tokens("dark", request.dark(), problems));
        if (!problems.isEmpty()) {
            throw new InvalidInputException(problems);
        }
        String text;
        try {
            text = json.writeValueAsString(tokens);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Cannot write the tokens of a theme", e);
        }
        Instant now = now();
        Optional<OrganizationBranding> found = brandings.findById(organization.getId());
        OrganizationBranding branding = found.orElseGet(() -> new OrganizationBranding(organization.getId()));
        branding.change(displayName, accent, text, now);
        if (found.isPresent()) {
            brandings.update(branding);
        } else {
            brandings.insert(branding);
        }
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("displayName", displayName == null ? "" : displayName);
        detail.put("accent", accent == null ? "" : accent);
        detail.put("tokens", text);
        audited(organization, "organization.branding.changed", detail);
        return view(organization);
    }

    /**
     * Stores an image of the branding, replacing the one before.
     *
     * @throws InvalidInputException when it is not a PNG, JPEG, WebP, ICO or SVG image
     * @throws dev.mosaikit.kernel.core.error.ContentTooLargeException beyond {@link #MAX_IMAGE}
     */
    @Transactional
    public BrandingView storeImage(String slug, String kindId, InputStream content) {
        Organization organization = managed(slug);
        ImageKind kind = ImageKind.of(kindId);
        FileView file = files.storeForKernel("branding-" + kind.id(), content, MAX_IMAGE, ImageFormats::of);
        images.findByOrganizationIdAndKind(organization.getId(), kind.id()).ifPresent(this::remove);
        images.insert(new BrandImage(
                file.id(),
                organization.getId(),
                kind,
                file.contentType(),
                file.size(),
                file.checksum(),
                file.createdAt()));
        audited(
                organization,
                "organization.branding.image.stored",
                Map.of("image", kind.id(), "contentType", file.contentType(), "size", file.size()));
        return view(organization);
    }

    /** Removes an image of the branding: the shell shows the one of the installation again. */
    @Transactional
    public BrandingView removeImage(String slug, String kindId) {
        Organization organization = managed(slug);
        ImageKind kind = ImageKind.of(kindId);
        BrandImage image = images.findByOrganizationIdAndKind(organization.getId(), kind.id())
                .orElseThrow(() -> new ResourceNotFoundException("The organization has no " + kind.id() + "."));
        remove(image);
        audited(organization, "organization.branding.image.removed", Map.of("image", kind.id()));
        return view(organization);
    }

    /** An image of the branding of an organization, with its content to open; public, as {@link #view}. */
    public FileService.Content image(String slug, String kindId) {
        ImageKind kind = ImageKind.of(kindId);
        return asKernel(() -> find(slug)
                .flatMap(organization -> images.findByOrganizationIdAndKind(organization.getId(), kind.id()))
                .map(image -> files.kernelContent(
                        image.getOrganizationId(),
                        image.getFileId(),
                        image.getKind() + extension(image.getContentType()),
                        image.getContentType(),
                        image.getSize(),
                        image.getChecksum(),
                        image.getUpdatedAt()))
                .orElseThrow(() -> new ResourceNotFoundException("No image " + kind.id() + ".")));
    }

    /**
     * Reads in a transaction of its own as the owner of the tables, which row-level security does not
     * limit: only for the public branding, by the organization named in the address.
     */
    private <T> T asKernel(Supplier<T> read) {
        return QuarkusTransaction.requiringNew().call(() -> {
            entityManager
                    .createNativeQuery("select set_config('role', 'none', true)")
                    .getSingleResult();
            return read.get();
        });
    }

    private void remove(BrandImage image) {
        images.delete(image);
        files.deleteForKernel(image.getFileId());
    }

    private Optional<Organization> find(String slug) {
        return slug == null ? Optional.empty() : organizations.findBySlug(slug.toLowerCase(Locale.ROOT));
    }

    /**
     * The organization, when the person administers it: an administrator of the organization acting
     * in it. Nobody else, platform administrators included, changes the mark of an organization.
     */
    private Organization managed(String slug) {
        Organization organization = find(slug)
                .orElseThrow(() -> new ResourceNotFoundException("No organization with slug '" + slug + "'."));
        boolean administrator = identity.hasRole(Roles.ORGANIZATION_ADMIN)
                && RequestOrganization.of(identity)
                        .filter(organization.getId()::equals)
                        .isPresent();
        if (!administrator) {
            throw new ForbiddenOperationException("Only the administrators of the organization change its branding.");
        }
        return organization;
    }

    private BrandingView view(Organization organization) {
        Optional<OrganizationBranding> branding = brandings.findById(organization.getId());
        Map<String, Map<String, String>> tokens = branding.map(OrganizationBranding::getTokens)
                .map(this::readTokens)
                .orElse(Map.of());
        Map<String, String> addresses = new LinkedHashMap<>();
        String base = "/api/v1/organizations/" + URLEncoder.encode(organization.getSlug(), StandardCharsets.UTF_8)
                + "/branding/images/";
        for (BrandImage image : images.findByOrganizationId(organization.getId())) {
            // The checksum in the address: a new image is a new address, which no cache holds.
            addresses.put(
                    image.getKind(),
                    base + image.getKind() + "?v=" + image.getChecksum().substring(0, 16));
        }
        return new BrandingView(
                branding.map(OrganizationBranding::getDisplayName).orElse(null),
                branding.map(OrganizationBranding::getAccent).orElse(null),
                tokens.getOrDefault("light", Map.of()),
                tokens.getOrDefault("dark", Map.of()),
                addresses.get(ImageKind.LOGO.id()),
                addresses.get(ImageKind.LOGO_DARK.id()),
                addresses.get(ImageKind.ICON.id()),
                addresses.get(ImageKind.FAVICON.id()));
    }

    private Map<String, Map<String, String>> readTokens(String text) {
        try {
            return json.readValue(text, TOKENS_TYPE);
        } catch (JsonProcessingException e) {
            return Map.of();
        }
    }

    private static Map<String, String> tokens(String scheme, Map<String, String> given, List<String> problems) {
        Map<String, String> result = new TreeMap<>();
        if (given == null) {
            return result;
        }
        for (Map.Entry<String, String> entry : given.entrySet()) {
            String value = entry.getValue() == null ? "" : entry.getValue().toLowerCase(Locale.ROOT);
            if (!TOKENS.contains(entry.getKey())) {
                problems.add(scheme + "." + entry.getKey() + " is not a token of the theme: one of "
                        + String.join(", ", sorted()));
            } else if (!COLOR.matcher(value).matches()) {
                problems.add(scheme + "." + entry.getKey() + " must be a color #rrggbb");
            } else {
                result.put(entry.getKey(), value);
            }
        }
        return result;
    }

    private static List<String> sorted() {
        return TOKENS.stream().sorted().toList();
    }

    private static String color(String field, String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String color = value.strip().toLowerCase(Locale.ROOT);
        if (!COLOR.matcher(color).matches()) {
            throw new InvalidInputException(List.of(field + " must be a color #rrggbb"));
        }
        return color;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private static String extension(String contentType) {
        return switch (contentType) {
            case ImageFormats.PNG -> ".png";
            case ImageFormats.JPEG -> ".jpg";
            case ImageFormats.WEBP -> ".webp";
            case ImageFormats.ICO -> ".ico";
            default -> ".svg";
        };
    }

    private Instant now() {
        return Instant.now(clock).truncatedTo(ChronoUnit.MICROS);
    }

    private void audited(Organization organization, String action, Map<String, ?> detail) {
        audit.append(
                identity.getPrincipal().getName(),
                Optional.of(organization.getId()),
                action,
                organization.getSlug(),
                AuditEvent.Outcome.SUCCEEDED,
                detail);
    }
}

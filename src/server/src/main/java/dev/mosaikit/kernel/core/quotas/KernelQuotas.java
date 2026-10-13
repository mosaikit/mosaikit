// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.quotas;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.quota.Quota;
import dev.mosaikit.kernel.api.quota.QuotaExceededException;
import dev.mosaikit.kernel.api.quota.Quotas;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.resources.RegisteredResource;
import dev.mosaikit.kernel.core.resources.RegisteredResources;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * The kernel's {@link Quotas} bean for the Java code of extensions (MK-076): checks that the calling
 * extension is active and declares the measure, then asks {@link QuotaService} for the organization
 * and the person of the request. A refusal of the kernel becomes the {@link QuotaExceededException}
 * of the API, which the kernel answers as {@code 403 Quota exceeded}.
 */
@ApplicationScoped
public class KernelQuotas implements Quotas {

    private final QuotaService quotas;
    private final ExtensionRegistry extensions;
    private final RegisteredResources resources;
    private final RequestOrganization organization;
    private final SecurityIdentity identity;

    public KernelQuotas(
            QuotaService quotas,
            ExtensionRegistry extensions,
            RegisteredResources resources,
            RequestOrganization organization,
            SecurityIdentity identity) {
        this.quotas = quotas;
        this.extensions = extensions;
        this.resources = resources;
        this.organization = organization;
        this.identity = identity;
    }

    @Override
    public Quota check(String extension, String measure, long amount) {
        Measure found = Measure.STORAGE_ID.equals(measure)
                ? requireActive(extension, Measure.STORAGE)
                : declared(extension, measure);
        return refused(() -> quota(quotas.check(organization.require(), found, amount)));
    }

    @Override
    public Quota consume(String extension, String measure, long amount) {
        Measure found = declared(extension, measure);
        if (found.kind() != Measure.Kind.COUNTER) {
            throw new IllegalArgumentException(found.id() + " is a gauge: set what is kept rather than consume it.");
        }
        UUID account = RequestOrganization.account(identity).orElse(null);
        return refused(() -> quota(quotas.consume(organization.require(), account, found, amount)));
    }

    @Override
    public Quota set(String extension, String measure, long amount) {
        Measure found = declared(extension, measure);
        if (found.kind() != Measure.Kind.GAUGE) {
            throw new IllegalArgumentException(found.id() + " is a counter: consume it rather than set it.");
        }
        return refused(() -> quota(quotas.set(organization.require(), found, amount)));
    }

    @Override
    public void reportSpace(ResourceRef resource, long bytes) {
        Objects.requireNonNull(resource, "resource");
        requireActive(resource.extension(), Measure.STORAGE);
        if (bytes < 0) {
            throw new IllegalArgumentException("The space of a resource is 0 bytes or more.");
        }
        UUID org = organization.require();
        RegisteredResource entry = QuarkusTransaction.joiningExisting()
                .call(() -> resources.find(org, resource.extension(), resource.type(), resource.id()))
                .orElseThrow(() -> new IllegalArgumentException(resource + " is not a registered resource."));
        refused(() -> {
            quotas.reportSpace(org, resource.extension(), entry.getId(), entry.getOwnerId(), bytes);
            return null;
        });
    }

    /** A measure that the active extension declares in its manifest. */
    private Measure declared(String extension, String measure) {
        ExtensionManifest manifest = manifest(extension);
        return manifest.measures().stream()
                .filter(entry -> entry.id().equals(measure))
                .findFirst()
                .map(entry -> Measures.of(manifest, entry))
                .orElseThrow(() -> new IllegalArgumentException(
                        extension + " declares no measure '" + measure + "' in its manifest."));
    }

    private Measure requireActive(String extension, Measure measure) {
        manifest(extension);
        return measure;
    }

    private ExtensionManifest manifest(String extension) {
        Objects.requireNonNull(extension, "extension");
        return extensions
                .findActive(extension)
                .flatMap(InstalledExtension::manifest)
                .orElseThrow(() -> new IllegalArgumentException(extension + " is not an active extension."));
    }

    private static Quota quota(QuotaService.Check check) {
        return new Quota(
                check.measure().id(),
                check.measure().unit(),
                check.period(),
                check.limit(),
                check.used(),
                check.requested());
    }

    /** The refusal of the kernel as the exception of the API, with the same quota. */
    static <T> T refused(Supplier<T> call) {
        try {
            return call.get();
        } catch (dev.mosaikit.kernel.core.error.QuotaExceededException e) {
            var quota = e.quota();
            throw new QuotaExceededException(
                    e.getMessage(),
                    new Quota(
                            quota.measure(),
                            quota.unit(),
                            quota.period(),
                            java.util.OptionalLong.of(quota.limit()),
                            quota.used(),
                            quota.requested()));
        }
    }
}

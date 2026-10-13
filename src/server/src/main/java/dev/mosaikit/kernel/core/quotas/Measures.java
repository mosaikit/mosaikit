// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.quotas;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.MeasureEntry;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * The measures that organizations consume (MK-076): the storage of the kernel, then those that the
 * active extensions declare in {@code measures} of their manifests, as {@code <extension>/<id>}.
 */
@ApplicationScoped
public class Measures {

    private final Supplier<List<Measure>> ofExtensions;

    @Inject
    public Measures(ExtensionRegistry extensions) {
        this(() -> extensions.active().stream()
                .flatMap(extension -> extension.manifest().stream())
                .flatMap(manifest -> manifest.measures().stream().map(entry -> of(manifest, entry)))
                .toList());
    }

    Measures(Supplier<List<Measure>> ofExtensions) {
        this.ofExtensions = ofExtensions;
    }

    /** Every measure: storage first, then those of extensions by identifier. */
    public List<Measure> all() {
        List<Measure> all = new ArrayList<>();
        all.add(Measure.STORAGE);
        ofExtensions.get().stream().sorted(Comparator.comparing(Measure::id)).forEach(all::add);
        return all;
    }

    /** The measure of the kernel for an entry of a manifest. */
    static Measure of(ExtensionManifest manifest, MeasureEntry entry) {
        return new Measure(
                Measure.of(manifest.id(), entry.id()),
                entry.label(),
                entry.unit(),
                entry.kind() == MeasureEntry.Kind.COUNTER ? Measure.Kind.COUNTER : Measure.Kind.GAUGE,
                manifest.id());
    }

    /** A measure by its identifier, when the kernel or an active extension declares it. */
    public Optional<Measure> find(String id) {
        return all().stream().filter(measure -> measure.id().equals(id)).findFirst();
    }
}

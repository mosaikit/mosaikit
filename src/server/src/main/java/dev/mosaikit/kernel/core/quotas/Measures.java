// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.quotas;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * The measures that organizations consume (MK-076): the storage of the kernel, then those of the
 * active extensions.
 */
@ApplicationScoped
public class Measures {

    private final Supplier<List<Measure>> ofExtensions;

    @Inject
    public Measures() {
        this(List::of);
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

    /** A measure by its identifier, when the kernel or an active extension declares it. */
    public Optional<Measure> find(String id) {
        return all().stream().filter(measure -> measure.id().equals(id)).findFirst();
    }
}

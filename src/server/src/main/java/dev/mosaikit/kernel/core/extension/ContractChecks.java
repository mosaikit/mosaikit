// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import dev.mosaikit.kernel.api.extension.Contribution;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ImplementedContract;
import dev.mosaikit.kernel.api.extension.ProvidedContract;
import dev.mosaikit.kernel.core.home.HomeWidgets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Checks the contracts between extensions when extensions are installed (MK-134): the contributions to
 * an extension point must match the JSON Schema of the version they target, and an implementation of a
 * contract on the server must target a version that its owner serves. Each check applies when both
 * extensions are there: an extension that contributes to, or implements, a contract of a missing
 * extension is installed, as extensions are independent (ADR-0041). An owner that retires a version is
 * not refused: what targets that version is no longer used. The points that the kernel owns, such as the
 * widgets of the home page (MK-101), are checked in the same way.
 */
public final class ContractChecks {

    private ContractChecks() {}

    /**
     * Why installing these extensions together breaks a contract, empty when it does not.
     *
     * @param operation the manifests to install or update together
     * @param installed the manifests of the installation now; those of the operation replace them
     */
    public static List<String> refuseInstallation(
            Collection<ExtensionManifest> operation, Collection<ExtensionManifest> installed) {
        Map<String, ExtensionManifest> after = new LinkedHashMap<>();
        installed.forEach(manifest -> after.put(manifest.id(), manifest));
        operation.forEach(manifest -> after.put(manifest.id(), manifest));
        Set<String> ids = operation.stream().map(ExtensionManifest::id).collect(Collectors.toSet());
        Set<String> problems = new LinkedHashSet<>();
        for (ExtensionManifest manifest : operation) {
            problems.addAll(kernelContributions(manifest));
        }
        for (ExtensionManifest contributor : after.values()) {
            for (ExtensionManifest owner : after.values()) {
                // What the operation brings, on either side of a point.
                if (ids.contains(contributor.id()) || ids.contains(owner.id())) {
                    problems.addAll(contributions(contributor, owner));
                }
                if (ids.contains(contributor.id())) {
                    problems.addAll(implementations(contributor, owner));
                }
            }
        }
        return List.copyOf(problems);
    }

    /** The contributions of an extension that do not match the schema of the points of another. */
    public static List<String> contributions(ExtensionManifest contributor, ExtensionManifest owner) {
        List<String> problems = new ArrayList<>();
        for (Contribution contribution : contributor.contributions()) {
            mismatch(contribution, owner)
                    .ifPresent(found -> problems.add("the contribution " + contribution.id() + " of "
                            + contributor.id() + " " + contributor.version() + " to " + contribution.point()
                            + " does not match the schema of " + owner.id() + " " + owner.version() + ": "
                            + found));
        }
        return problems;
    }

    /** The contributions of an extension that do not match the schema of a point of the kernel (MK-101). */
    public static List<String> kernelContributions(ExtensionManifest contributor) {
        List<String> problems = new ArrayList<>();
        for (Contribution contribution : contributor.contributions()) {
            kernelMismatch(contribution)
                    .ifPresent(found -> problems.add("the contribution " + contribution.id() + " of "
                            + contributor.id() + " " + contributor.version() + " to " + contribution.point()
                            + " does not match the schema of the kernel: " + found));
        }
        return problems;
    }

    /**
     * Whether a contribution matches every point it targets among these extensions and the points of
     * the kernel.
     */
    public static boolean matches(Contribution contribution, Collection<ExtensionManifest> owners) {
        return kernelMismatch(contribution).isEmpty()
                && owners.stream()
                        .allMatch(owner -> mismatch(contribution, owner).isEmpty());
    }

    private static Optional<String> kernelMismatch(Contribution contribution) {
        return HomeWidgets.kernelPoint(contribution.point())
                .map(point -> point.validate(contribution))
                .filter(problems -> !problems.isEmpty())
                .map(problems -> String.join(", ", problems));
    }

    private static Optional<String> mismatch(Contribution contribution, ExtensionManifest owner) {
        return owner.extensionPoint(contribution.point())
                .map(point -> point.validate(contribution))
                .filter(problems -> !problems.isEmpty())
                .map(problems -> String.join(", ", problems));
    }

    /** The contracts of an owner that an extension implements in a version the owner does not serve. */
    public static List<String> implementations(ExtensionManifest implementer, ExtensionManifest owner) {
        List<String> problems = new ArrayList<>();
        for (ImplementedContract contract : implementer.implementedContracts()) {
            if (!contract.extension().equals(owner.id())) {
                continue;
            }
            String what = implementer.id() + " " + implementer.version() + " implements " + contract.contract()
                    + " version " + contract.version() + ", which " + owner.id() + " " + owner.version();
            Optional<ProvidedContract> provided = owner.providedContract(contract.name());
            if (provided.isEmpty()) {
                problems.add(what + " does not provide");
            } else if (!provided.get().serves(contract.version())) {
                problems.add(what + " does not serve (it serves version "
                        + provided.get().versions().stream()
                                .map(String::valueOf)
                                .collect(Collectors.joining(", "))
                        + ")");
            }
        }
        return problems;
    }
}

// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import dev.mosaikit.kernel.api.extension.BackendEntry;
import dev.mosaikit.kernel.api.extension.Contribution;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.FrontendBridge;
import dev.mosaikit.kernel.api.extension.FrontendEntry;
import dev.mosaikit.kernel.api.extension.FrontendIsolation;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * What the shell needs to load the frontend of an active extension.
 *
 * @param id extension identifier
 * @param version extension version
 * @param entry URL of the ES module
 * @param isolation {@code module}, or {@code iframe} when the extension asks for it or its publisher is
 *     not verified and the installation isolates such extensions (MK-014)
 * @param bridge what an isolated frontend may do through the shell
 * @param contributions contributions to extension points
 * @param points extension points that the frontend offers to other extensions (MK-020)
 */
public record FrontendExtensionView(
        String id,
        String version,
        String entry,
        String isolation,
        BridgeView bridge,
        List<ContributionView> contributions,
        List<String> points) {

    /** A contribution as seen by the shell. */
    public record ContributionView(String point, String id, Map<String, Object> attributes) {}

    /**
     * The bridge of an isolated frontend.
     *
     * @param publishes topics it may publish
     * @param subscribes topics it may subscribe to
     * @param services services it may call
     * @param api path of the backend API of the extension, for the {@code api} service, when it has one
     * @param data path of the collections of documents of the extension, for the {@code data} service,
     *     when it declares some (ADR-0031)
     */
    public record BridgeView(
            List<String> publishes, List<String> subscribes, List<String> services, String api, String data) {}

    /** Whether a {@code mosaikit.extensions.unverified-frontends} setting isolates unverified extensions. */
    public static boolean isolatesUnverified(String setting) {
        String value = setting.strip().toLowerCase(Locale.ROOT);
        if (!value.equals("iframe") && !value.equals("module")) {
            throw new IllegalArgumentException(
                    "mosaikit.extensions.unverified-frontends must be 'iframe' or 'module', not '" + setting + "'");
        }
        return value.equals("iframe");
    }

    /**
     * @param isolate {@code true} to run the frontend in an iframe whatever its manifest says
     */
    static FrontendExtensionView of(ExtensionManifest manifest, FrontendEntry frontend, boolean isolate) {
        boolean iframe = isolate || frontend.isolation() == FrontendIsolation.IFRAME;
        FrontendBridge bridge = frontend.bridge();
        return new FrontendExtensionView(
                manifest.id(),
                manifest.version().toString(),
                ExtensionAssetResource.assetUrl(manifest.id(), frontend.entry()),
                iframe ? FrontendIsolation.IFRAME.value() : FrontendIsolation.MODULE.value(),
                new BridgeView(
                        bridge.publishes(),
                        bridge.subscribes(),
                        bridge.services(),
                        manifest.backend()
                                .map(BackendEntry::api)
                                .map(api -> "/api/v1/ext/" + api + "/")
                                .orElse(null),
                        manifest.data().map(data -> dataPath(manifest.id())).orElse(null)),
                manifest.contributions().stream()
                        .map(FrontendExtensionView::toView)
                        .toList(),
                frontend.points());
    }

    /** Where the collections of an extension are (DocumentResource). */
    public static String dataPath(String extensionId) {
        return "/api/v1/data/" + extensionId + "/";
    }

    private static ContributionView toView(Contribution contribution) {
        return new ContributionView(contribution.point(), contribution.id(), contribution.attributes());
    }
}

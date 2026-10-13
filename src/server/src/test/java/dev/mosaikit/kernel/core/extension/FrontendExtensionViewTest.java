// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ExtensionManifests;
import dev.mosaikit.kernel.api.extension.ManifestParseResult;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** How the shell is told to run a frontend: as a module or isolated in an iframe (MK-014). */
@Tag("MK-014")
class FrontendExtensionViewTest {

    private static ExtensionManifest manifest(String isolation, boolean backend) {
        var tree = new java.util.HashMap<String, Object>(Map.of(
                "id", "dev.example.boxed",
                "version", "1.0.0",
                "name", "Boxed",
                "kind", "app",
                "platform", ">=0.1 <1",
                "frontend",
                        Map.of(
                                "entry",
                                "web/index.js",
                                "isolation",
                                isolation,
                                "bridge",
                                Map.of("publishes", List.of("boxed.saved"), "services", List.of("api")))));
        if (backend) {
            tree.put("backend", Map.of("jar", "lib/boxed.jar", "api", "boxed"));
        }
        return ((ManifestParseResult.Valid) ExtensionManifests.parse(tree)).manifest();
    }

    @Test
    void runsAsAModuleWhenTheManifestAsksAndThePublisherIsTrusted() {
        ExtensionManifest manifest = manifest("module", true);

        FrontendExtensionView view =
                FrontendExtensionView.of(manifest, manifest.frontend().orElseThrow(), false);

        assertThat(view.isolation()).isEqualTo("module");
        assertThat(view.entry()).isEqualTo("/api/v1/extension-assets/dev.example.boxed/web/index.js");
        assertThat(view.bridge().publishes()).containsExactly("boxed.saved");
        assertThat(view.bridge().services()).containsExactly("api");
        assertThat(view.bridge().api()).isEqualTo("/api/v1/ext/boxed/");
    }

    @Test
    void isolatesAnUnverifiedPublisherOrAFrontendThatAsksForIt() {
        ExtensionManifest module = manifest("module", false);
        ExtensionManifest iframe = manifest("iframe", false);

        assertThat(FrontendExtensionView.of(module, module.frontend().orElseThrow(), true)
                        .isolation())
                .isEqualTo("iframe");
        assertThat(FrontendExtensionView.of(iframe, iframe.frontend().orElseThrow(), false)
                        .isolation())
                .isEqualTo("iframe");
        assertThat(FrontendExtensionView.of(iframe, iframe.frontend().orElseThrow(), false)
                        .bridge()
                        .api())
                .isNull();
    }

    @Test
    void readsThePolicyForUnverifiedPublishers() {
        assertThat(FrontendExtensionView.isolatesUnverified("iframe")).isTrue();
        assertThat(FrontendExtensionView.isolatesUnverified(" Module ")).isFalse();
        assertThatThrownBy(() -> FrontendExtensionView.isolatesUnverified("never"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("'iframe' or 'module'");
    }
}

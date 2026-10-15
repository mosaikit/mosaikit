// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import dev.mosaikit.kernel.api.version.Version;
import java.util.Optional;

/**
 * Whether another extension is present and active in the organization of the request (MK-133,
 * ADR-0041). The kernel provides this bean to extensions, so that one that can use another works
 * without it: it asks before offering what needs the other one, and subscribes to
 * {@link dev.mosaikit.kernel.api.events.PlatformEvents#EXTENSION_ACTIVATED} and
 * {@link dev.mosaikit.kernel.api.events.PlatformEvents#EXTENSION_DEACTIVATED} to react when it comes
 * or goes.
 *
 * <p>An extension is active in an organization when it is installed, compatible with the kernel and
 * with the extensions it requires, and the organization did not turn its apps off (MK-030). Any
 * extension may ask about any other, whether or not its manifest declares it: of an extension that is
 * not installed, or not active there, the answer says only that it is absent. In the handler of a
 * platform event the organization is the one of the event; in a request without organization, such as
 * one of the platform administrator, the answer is about the installation.
 *
 * <pre>{@code
 * @Inject ExtensionPresence presence;
 *
 * if (presence.isActive("org.example.ext.catalog")) {
 *     // offer to open the file in the catalog
 * }
 * }</pre>
 */
public interface ExtensionPresence {

    /**
     * Whether an extension is active in the organization of the request.
     *
     * @param extension the identifier of the extension, such as {@code org.example.ext.catalog}
     */
    boolean isActive(String extension);

    /**
     * The version of an extension active in the organization of the request, empty when it is not
     * active there.
     *
     * @param extension the identifier of the extension
     */
    Optional<Version> version(String extension);
}

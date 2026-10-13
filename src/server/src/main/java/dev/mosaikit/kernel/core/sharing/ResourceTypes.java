// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.extension.SharingLevelEntry;
import dev.mosaikit.kernel.api.extension.SubjectKind;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The resource types of an extension that sharing knows (MK-055): those its manifest declares in
 * {@code resources}, and, for an extension with collections of documents (ADR-0031), the type
 * {@value #DOCUMENT} that the kernel adds for the documents shared with a team (MK-032, ADR-0037). The
 * kernel registers those documents and shares them itself: the extension has no code for it. The name
 * is the kernel's for an extension with collections: a type of that name in its manifest is ignored.
 */
public final class ResourceTypes {

    /** The type of a document of a collection, which the kernel shares (MK-032). */
    public static final String DOCUMENT = "data-document";

    /** The level that reads a document. */
    public static final String VIEW = "view";

    /** The level that changes and deletes a document, which a team gets on the documents shared with it. */
    public static final String EDIT = "edit";

    /** Documents are shared with people, teams and the organization; never with links or the public. */
    static final ResourceTypeEntry DOCUMENT_TYPE = new ResourceTypeEntry(
            DOCUMENT,
            "Document",
            List.of(
                    new SharingLevelEntry(VIEW, "View", false, Map.of("it", Map.of("title", "Visualizzazione"))),
                    new SharingLevelEntry(EDIT, "Edit", true, Map.of("it", Map.of("title", "Modifica")))),
            Set.of(SubjectKind.PERSON, SubjectKind.GROUP, SubjectKind.ORGANIZATION),
            null,
            Map.of("it", Map.of("title", "Documento")));

    private ResourceTypes() {}

    /** A type of the extension: the type of its documents, or one its manifest declares. */
    public static Optional<ResourceTypeEntry> of(ExtensionManifest manifest, String type) {
        if (DOCUMENT.equals(type) && manifest.data().isPresent()) {
            return Optional.of(DOCUMENT_TYPE);
        }
        return manifest.resourceType(type);
    }

    /** Every type of the extension that sharing knows. */
    public static List<ResourceTypeEntry> all(ExtensionManifest manifest) {
        List<ResourceTypeEntry> types = new ArrayList<>();
        for (ResourceTypeEntry type : manifest.resourceTypes()) {
            of(manifest, type.type()).filter(type::equals).ifPresent(types::add);
        }
        if (manifest.data().isPresent()) {
            types.add(DOCUMENT_TYPE);
        }
        return List.copyOf(types);
    }
}
